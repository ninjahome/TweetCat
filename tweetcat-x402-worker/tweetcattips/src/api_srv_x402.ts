import {
	decodeBase64Json,
	encodeBase64Json,
	ExtCtx, getOrCreateTreasuryEOA,
	getPaymentHeader,
	isHexAddress,
	NetConfig,
	usdcToAtomicSafe
} from "./common";
import {PaymentRequirements} from "@x402/hono";
import {ResourceInfo, x402ResourceServer} from "@x402/core/server";
import {SettleResponse} from "@x402/core/types";
import {getKolBinding, usdcEscrowTips} from "./database";
import {x402Client} from "@x402/core/client";
import {registerExactEvmScheme} from "@x402/evm/exact/client";
import {toAccount} from "viem/accounts";

interface TipRequestParams {
	amount: string;
	tweetId?: string;
	xId: string;
	atomicAmount?: string;
}

interface TipObj {
	isEscrow: boolean;
	payTo: `0x${string}`;
	atomicAmount: string;
	xId: string;
	tweetId?: string;
}

interface TransferRequestParams {
	amount: string;          // "0.01"
	to: `0x${string}` | string;
}

async function parseTipParams(c: ExtCtx): Promise<TipObj> {
	const body = (await c.req.json()) as TipRequestParams;
	if (!body) throw new Error("Invalid tip parameters");

	const xId = String(body?.xId ?? "").trim();
	const tweetId = body?.tweetId != null ? String(body.tweetId).trim() : undefined;
	if (!xId) throw new Error("Missing xId");

	const amountStr = String(body?.amount ?? "").trim();
	if (!amountStr) throw new Error("Missing amount");
	const atomicAmount = usdcToAtomicSafe(amountStr);
	if (!/^\d+$/.test(atomicAmount) || atomicAmount === "0") {
		throw new Error("Invalid amount");
	}

	const boundAddress = await getKolBinding(c.env.DB, xId);
	const isEscrow = !boundAddress;

	const srvAddress = (await getOrCreateTreasuryEOA(c)).address
	const payTo = isEscrow ? srvAddress : (boundAddress as `0x${string}`);
	if (!isHexAddress(payTo)) {
		throw new Error("Invalid payTo address (config error)");
	}

	return {isEscrow, payTo, atomicAmount, xId, tweetId};
}

async function parseTransferParams(c: ExtCtx): Promise<{ payTo: `0x${string}`; atomicAmount: string }> {

	const body = (await c.req.json()) as TransferRequestParams;
	if (!body) throw new Error("Invalid transfer parameters");

	const to = String(body?.to ?? "").trim();
	if (!isHexAddress(to)) throw new Error("Invalid to address");

	const amountStr = String(body?.amount ?? "").trim();
	if (!amountStr) throw new Error("Missing amount");

	const atomicAmount = usdcToAtomicSafe(amountStr);
	if (!/^\d+$/.test(atomicAmount) || atomicAmount === "0") {
		throw new Error("Invalid amount");
	}

	return {payTo: to as `0x${string}`, atomicAmount};
}

class PaymentRequiredError extends Error {
	constructor() {
		super("402");
	}
}

async function x402Workflow(
	c: ExtCtx,
	requirements: PaymentRequirements,
	resource: ResourceInfo,
	resourceServer: x402ResourceServer,
): Promise<SettleResponse> {

	const paymentHeader = getPaymentHeader(c);
	if (!paymentHeader) {
		const pr = resourceServer.createPaymentRequiredResponse([requirements], resource);
		c.status(402);
		c.header("PAYMENT-REQUIRED", encodeBase64Json(pr));
		throw new PaymentRequiredError()
	}

	const paymentPayload = decodeBase64Json(paymentHeader);

	const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
	if (!verifyResult.isValid) throw new Error(verifyResult.invalidReason);

	const payerAddr = verifyResult.payer?.toLowerCase();
	const payeeAddr = requirements.payTo.toLowerCase();
	if (payerAddr === payeeAddr) {
		console.warn("------>>> payer:", payerAddr, " receiver:", payeeAddr)
		throw new Error("same payer and receiver")
	}

	const settleResult = (await resourceServer.settlePayment(paymentPayload, requirements)) as SettleResponse;
	if (!settleResult.success) throw new Error(settleResult.errorReason);

	c.header("PAYMENT-RESPONSE", encodeBase64Json(settleResult));
	return settleResult;
}

export async function apiHandleTip(c: ExtCtx): Promise<Response> {
	try {
		const cfg = c.get("cfg");
		const getResourceServer = c.get("getResourceServer");

		const tip = await parseTipParams(c);

		const requirements = {
			scheme: "exact" as const,
			network: cfg.NETWORK,
			asset: cfg.USDC,
			amount: tip.atomicAmount,
			payTo: tip.payTo,
			maxTimeoutSeconds: 300,
			extra: {
				name: cfg.USDC_EIP712_NAME,
				version: cfg.USDC_EIP712_VERSION,
				resourceUrl: c.req.url,
			},
		} as const;

		const resource: ResourceInfo = {
			url: c.req.url,
			description: "Tweet Tip Payment",
			mimeType: "application/json"
		};

		const rs = getResourceServer(c.env);
		const settleResult = await x402Workflow(c, requirements, resource, rs);

		if (tip.isEscrow) await usdcEscrowTips(c.env.DB, {xId: tip.xId, amountAtomic: tip.atomicAmount})

		return c.json({success: true, txHash: settleResult.transaction});

	} catch (e: any) {
		if (e instanceof PaymentRequiredError) return c.json({error: "Required"}, 402);

		return c.json({error: e.message}, 400);
	}
}

export async function apiX402UsdcTransfer(c: ExtCtx): Promise<Response> {
	try {
		const cfg = c.get("cfg");
		const getResourceServer = c.get("getResourceServer");

		const p = await parseTransferParams(c);

		const requirements = {
			scheme: "exact" as const,
			network: cfg.NETWORK,
			asset: cfg.USDC,
			amount: p.atomicAmount,
			payTo: p.payTo,
			maxTimeoutSeconds: 300,
			extra: {
				name: cfg.USDC_EIP712_NAME,
				version: cfg.USDC_EIP712_VERSION,
				resourceUrl: c.req.url,
			},
		} as const;

		const resource: ResourceInfo = {
			url: c.req.url,
			description: "USDC Transfer",
			mimeType: "application/json"
		};

		const rs = getResourceServer(c.env);
		const settleResult = await x402Workflow(c, requirements, resource, rs);
		return c.json({success: true, txHash: settleResult.transaction});
	} catch (e: any) {
		if (e instanceof PaymentRequiredError) return c.json({error: "Required"}, 402);
		return c.json({error: e?.message ?? "Bad Request"}, 400);
	}
}

export async function internalTreasurySettle(
	c: ExtCtx,
	cfg: NetConfig,
	rs: x402ResourceServer,
	payTo: `0x${string}`,
	atomicAmount: string,
	resourceUrl: string
): Promise<SettleResponse> {

	const treasuryAccount = await getOrCreateTreasuryEOA(c);
	const signer = toAccount(treasuryAccount);
	const client = new x402Client();
	registerExactEvmScheme(client, {signer, networks: [cfg.NETWORK]});

	const requirements = {
		scheme: "exact" as const,
		network: cfg.NETWORK,
		asset: cfg.USDC,
		amount: atomicAmount,
		payTo: payTo,
		maxTimeoutSeconds: 300,
		extra: {
			name: cfg.USDC_EIP712_NAME,
			version: cfg.USDC_EIP712_VERSION,
			resourceUrl,
		},
	} as const;

	const resource: ResourceInfo = {
		url: resourceUrl,
		description: "Server-side treasury payout",
		mimeType: "application/json",
	};

	const paymentRequired = rs.createPaymentRequiredResponse([requirements], resource);

	const paymentPayload = await client.createPaymentPayload(paymentRequired);

	const verifyResult = await rs.verifyPayment(paymentPayload, requirements);
	if (!verifyResult.isValid) {
		throw new Error(`Local verification failed: ${verifyResult.invalidReason}`);
	}

	return (await rs.settlePayment(paymentPayload, requirements));
}

import {
	decodeBase64Json,
	encodeBase64Json,
	ExtCtx,
	getPaymentHeader, isHexAddress,
	NetConfig,
	usdcToAtomic
} from "./common";
import {PaymentRequirements} from "@x402/hono";
import {ResourceInfo, x402ResourceServer} from "@x402/core/server";
import {SettleResponse} from "@x402/core/types";
import {getKolBinding, recordEscrowTips} from "./database";
import {privateKeyToAccount} from "viem/accounts";
import {x402Client} from "@x402/core/client";
import {registerExactEvmScheme} from "@x402/evm/exact/client";

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

interface claimRequest {
	userId: string;
	amount?: string;
	allClaim?: boolean;
}


async function parseTipParams(c: ExtCtx): Promise<TipObj> {
	const body = (await c.req.json()) as TipRequestParams;
	if (!body) throw new Error("Invalid tip parameters");

	const xId = String(body?.xId ?? "").trim();
	const tweetId = body?.tweetId != null ? String(body.tweetId).trim() : undefined;
	if (!xId) throw new Error("Missing xId");

	const amountStr = String(body?.amount ?? "").trim();
	if (!amountStr) throw new Error("Missing amount");
	const atomicAmount = usdcToAtomic(amountStr);
	if (!/^\d+$/.test(atomicAmount) || atomicAmount === "0") {
		throw new Error("Invalid amount");
	}

	const boundAddress = await getKolBinding(c.env.DB, xId);
	const isEscrow = !!boundAddress;

	const payTo = isEscrow ? (boundAddress as `0x${string}`) : (c.env.TREASURY_ADDRESS as `0x${string}`);
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

	const atomicAmount = usdcToAtomic(amountStr);
	if (!/^\d+$/.test(atomicAmount) || atomicAmount === "0") {
		throw new Error("Invalid amount");
	}

	return {payTo: to as `0x${string}`, atomicAmount};
}

async function x402Workflow(
	c: ExtCtx,
	requirements: PaymentRequirements,
	resource: ResourceInfo,
	resourceServer: x402ResourceServer,
): Promise<{ response: Response; settleResult?: SettleResponse }> {

	const paymentHeader = getPaymentHeader(c);

	if (!paymentHeader) {
		const pr = resourceServer.createPaymentRequiredResponse([requirements], resource);
		c.status(402);
		c.header("PAYMENT-REQUIRED", encodeBase64Json(pr));
		return {response: c.json({error: "Payment Required"})};
	}

	const paymentPayload = decodeBase64Json(paymentHeader);

	const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
	if (!verifyResult.isValid) {
		return {response: c.json({error: "Invalid Payment", reason: verifyResult.invalidReason}, 402)};
	}

	const settleResult = (await resourceServer.settlePayment(paymentPayload, requirements)) as SettleResponse;
	c.header("PAYMENT-RESPONSE", encodeBase64Json(settleResult));

	if (!settleResult.success) {
		return {
			response: c.json({success: false, error: settleResult.errorReason, raw: settleResult}, 500),
			settleResult
		};
	}

	return {
		response: c.json({
			success: true,
			txHash: settleResult.transaction,
			payer: settleResult.payer,
			raw: settleResult
		}),
		settleResult,
	};
}

export async function handleTip(c: ExtCtx): Promise<Response> {
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
		const {response, settleResult} = await x402Workflow(c, requirements, resource, rs);

		if (settleResult?.success && tip.isEscrow && settleResult.payer) {
			c.executionCtx.waitUntil(recordEscrowTips(c.env.DB, {
				xId: tip.xId,
				amountAtomic: tip.atomicAmount,
			}).catch(err=>{console.warn("tip record error:", err);}))
		}
		return response;
	} catch (e: any) {
		return c.json({error: e?.message ?? "Bad Request"}, 400);
	}
}

export async function handleUsdcTransfer(c: ExtCtx): Promise<Response> {
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
		const {response} = await x402Workflow(c, requirements, resource, rs);
		return response;
	} catch (e: any) {
		return c.json({error: e?.message ?? "Bad Request"}, 400);
	}
}

async function prepareKolClaim(userId: string): Promise<{ payTo: `0x${string}`; amount: string }> {
	console.log(`[DB] Querying data for userId: ${userId}`);
	return {
		payTo: "0xF588064b0c0D19fF225400748890220611d927F3" as `0x${string}`,
		amount: "0.01"
	};
}

export async function internalTreasurySettle(
	c: ExtCtx,
	cfg: NetConfig,
	rs: x402ResourceServer,
	payTo: `0x${string}`,
	atomicAmount: string
): Promise<SettleResponse> {
	const privateKey = c.env.TREASURY_PRIVATE_KEY;

	if (!privateKey) throw new Error("TREASURY_PRIVATE_KEY not set");

	const rawKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
	const account = privateKeyToAccount(rawKey as `0x${string}`);

	const client = new x402Client();
	registerExactEvmScheme(client, {signer: account, networks: [cfg.NETWORK]});

	const resourceUrl = `internal://auto-claim/${Date.now()}-${payTo}`;
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


export async function handleAutoClaim(c: ExtCtx): Promise<Response> {
	try {
		const cfg = c.get("cfg");
		const getResourceServer = c.get("getResourceServer");

		const body = (await c.req.json()) as claimRequest;
		const {userId} = body;
		if (!userId) return c.json({error: "Missing userId"}, 400);

		const {payTo, amount} = await prepareKolClaim(userId);
		const atomicAmount = usdcToAtomic(amount);

		const rs = getResourceServer(c.env);

		const settleResult = await internalTreasurySettle(c, cfg, rs, payTo, atomicAmount);

		if (settleResult.success) {
			console.log(`[Success] TxHash: ${settleResult.transaction}`);

			return c.json({
				success: true,
				txHash: settleResult.transaction,
				payer: settleResult.payer,
			});
		} else {
			console.error(`[Settle Failed] ${settleResult.errorReason}`);
			return c.json({
				success: false,
				error: settleResult.errorReason,
				raw: settleResult
			}, 500);
		}

	} catch (err: any) {
		return c.json({error: "Internal Error", detail: err.message}, 500);
	}
}

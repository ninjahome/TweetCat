import {Context, Hono} from "hono";
import {
	decodeBase64Json,
	encodeBase64Json,
	Env,
	getCdpAuthHeader,
	getPaymentHeader,
	isHexAddress,
	NetConfig,
	TipMode,
	usdcToAtomic
} from "./common";
import {ContentfulStatusCode} from "hono/utils/http-status";
import {SettleResponse} from "@x402/core/types";
import {getKolBinding, recordEscrowTips, TipRecord} from "./database";
import {PaymentRequirements} from "@x402/hono";
import {ResourceInfo, x402ResourceServer} from "@x402/core/server";
import {privateKeyToAccount} from "viem/accounts";
import {x402Client} from "@x402/core/client";
import {registerExactEvmScheme} from "@x402/evm/exact/client";

export interface TipRequestParams {
	amount: string;
	tweetId?: string;
	xId: string;
	atomicAmount?: string;
}

interface TipObj {
	mode: TipMode;
	payTo: `0x${string}`;
	atomicAmount: string;
	xId: string;
	tweetId?: string;
}

type Ctx = Context<{ Bindings: Env }>;

type Parsed = {
	payTo: `0x${string}`;
	atomicAmount: string;
	meta?: any;
};

export interface TransferRequestParams {
	amount: string;          // "0.01"
	to: `0x${string}` | string;
}

export function registerUserInfoRoute(app: Hono<{ Bindings: Env }>) {
	app.get("/user-info", async (c) => {
		const userId = c.req.query("userId"); // x:12345 或 uuid
		if (!userId) return c.json({error: "Missing userId"}, 400);

		const path = `/platform/v2/end-users/${userId}`;
		const url = `https://api.cdp.coinbase.com${path}`;

		try {
			const headers = await getCdpAuthHeader(c.env, "GET", path);

			const response = await fetch(url, {
				method: "GET",
				headers,
			});

			if (!response.ok) {
				const errorData = await response.text();
				console.error("[CDP Error]", errorData);
				return c.json(
					{
						error: "Failed to fetch user from CDP",
						status: response.status,
						detail: errorData,
					},
					response.status as ContentfulStatusCode
				);
			}

			const userData = await response.json();
			return c.json(userData);
		} catch (err: any) {
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
	});
}

export function registerValidateTokenRoute(app: Hono<{ Bindings: Env }>) {
	app.post("/validate-token", async (c) => {
		const body = await c.req.json().catch(() => ({}));
		const accessToken = body?.accessToken;
		
		if (!accessToken) {
			return c.json({error: "Missing accessToken"}, 400);
		}

		const path = `/platform/v2/end-users/auth/validate-token`;
		const url = `https://api.cdp.coinbase.com${path}`;

		try {
			const headers = await getCdpAuthHeader(c.env, "POST", path);

			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify({
					accessToken: accessToken
				}),
			});

			if (!response.ok) {
				const errorData = await response.text();
				console.error("[CDP Validate Token Error]", errorData);
				return c.json(
					{
						error: "Failed to validate token",
						status: response.status,
						detail: errorData,
					},
					response.status as ContentfulStatusCode
				);
			}

			const validationResult = await response.json();
			console.log("[CDP Validate Token Success]", validationResult);
			return c.json(validationResult);
		} catch (err: any) {
			console.error("[Validate Token Error]", err);
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
	});
}

export async function parseTipParams(c: Ctx): Promise<TipObj> {
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
	const isDirect = !!boundAddress;
	const mode = isDirect ? "direct" : "escrow";

	const payTo = isDirect ? (boundAddress as `0x${string}`) : (c.env.TREASURY_ADDRESS as `0x${string}`);
	if (!isHexAddress(payTo)) {
		throw new Error("Invalid payTo address (config error)");
	}

	return {mode, payTo, atomicAmount, xId, tweetId};
}

export async function parseTransferParams(
	c: Context<{ Bindings: Env }>
): Promise<{ payTo: `0x${string}`; atomicAmount: string }> {

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
	c: Ctx,
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

export function createX402Handler(opts: {
	cfg: NetConfig;
	getResourceServer: (env: Env) => x402ResourceServer;
	description: string;
	parse: (c: Ctx) => Promise<Parsed>;
	onSettled?: (c: Ctx, parsed: Parsed, settle: SettleResponse) => Promise<void>;
}) {
	const {cfg, getResourceServer, description, parse, onSettled} = opts;

	return async (c: Ctx): Promise<Response> => {
		try {
			const parsed = await parse(c);

			const requirements = {
				scheme: "exact" as const,
				network: cfg.NETWORK,
				asset: cfg.USDC,
				amount: parsed.atomicAmount,
				payTo: parsed.payTo,
				maxTimeoutSeconds: 300,
				extra: {
					name: cfg.USDC_EIP712_NAME,
					version: cfg.USDC_EIP712_VERSION,
					resourceUrl: c.req.url,
				},
			} as const;

			const resource: ResourceInfo = {url: c.req.url, description, mimeType: "application/json"};

			const rs = getResourceServer(c.env);
			const {response, settleResult} = await x402Workflow(c, requirements, resource, rs);

			if (settleResult?.success && onSettled) {
				await onSettled(c, parsed, settleResult);
			}

			return response;
		} catch (e: any) {
			return c.json({error: e?.message ?? "Bad Request"}, 400);
		}
	};
}

export function createTipHandler(opts: {
	cfg: NetConfig;
	getResourceServer: (env: Env) => x402ResourceServer;
	description?: string;
}) {
	const {cfg, getResourceServer} = opts;
	const description = opts.description ?? "Tweet Tip Payment";

	return createX402Handler({
		cfg,
		getResourceServer,
		description,

		parse: async (c) => {
			const tip = await parseTipParams(c);
			return {
				payTo: tip.payTo,
				atomicAmount: tip.atomicAmount,
				meta: tip,
			};
		},

		onSettled: async (c, parsed, settle) => {
			const tip = parsed.meta as TipObj;
			if (!tip || tip.mode !== "escrow") return;

			const payer = settle.payer;
			if (!payer) return;

			const record: TipRecord = {
				xId: tip.xId,
				mode: tip.mode,
				amountAtomic: tip.atomicAmount,
				payer,
				txHash: settle.transaction,
			};

			try {
				const id = await recordEscrowTips(c.env.DB, record);
				console.log("new tip record id=", id);
			} catch (e) {
				console.warn("tip record error:", e);
			}
		},
	});
}

export function createUsdcTransferHandler(opts: {
	cfg: NetConfig;
	getResourceServer: (env: Env) => x402ResourceServer;
	description?: string;
}) {
	const {cfg, getResourceServer} = opts;
	const description = opts.description ?? "USDC Transfer";

	return createX402Handler({
		cfg,
		getResourceServer,
		description,
		parse: async (c) => {
			const p = await parseTransferParams(c);
			return {payTo: p.payTo, atomicAmount: p.atomicAmount};
		},
	});
}


async function prepareKolClaim(userId: string): Promise<{ payTo: `0x${string}`; amount: string }> {
	console.log(`[DB] Querying data for userId: ${userId}`);
	return {
		payTo: "0xF588064b0c0D19fF225400748890220611d927F3" as `0x${string}`,
		amount: "0.01"
	};
}

export async function internalTreasurySettle(
	c: Ctx,
	cfg: NetConfig,
	getResourceServer: (env: Env) => x402ResourceServer,
	payTo: `0x${string}`,
	atomicAmount: string
): Promise<SettleResponse> {
	const rs = getResourceServer(c.env);
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

export interface claimRequest {
	userId: string;
	amount?: string;
	allClaim?: boolean;
}

export async function handleAutoClaim(c: Ctx, cfg: NetConfig, getResourceServer: (env: Env) => x402ResourceServer) {
	try {
		const body = (await c.req.json()) as claimRequest;
		const {userId} = body;
		if (!userId) return c.json({error: "Missing userId"}, 400);

		const {payTo, amount} = await prepareKolClaim(userId);
		const atomicAmount = usdcToAtomic(amount);

		const settleResult = await internalTreasurySettle(c, cfg, getResourceServer, payTo, atomicAmount);

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


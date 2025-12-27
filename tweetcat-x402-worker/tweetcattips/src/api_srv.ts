import {Context, Hono} from "hono";
import {
	decodeBase64Json,
	encodeBase64Json,
	Env,
	getCdpAuthHeader,
	getPaymentHeader,
	isHexAddress,
	NetConfig, TipMode,
	usdcToAtomic
} from "./common";
import {ContentfulStatusCode} from "hono/utils/http-status";
import {SettleResponse} from "@x402/core/types";
import {getKolBinding, recordEscrowTips, TipRecord} from "./database";
import {PaymentRequirements} from "@x402/hono";
import {ResourceInfo, x402ResourceServer} from "@x402/core/server";

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

	return { payTo: to as `0x${string}`, atomicAmount };
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
		return { response: c.json({ error: "Payment Required" }) };
	}

	const paymentPayload = decodeBase64Json(paymentHeader);

	const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
	if (!verifyResult.isValid) {
		return { response: c.json({ error: "Invalid Payment", reason: verifyResult.invalidReason }, 402) };
	}

	const settleResult = (await resourceServer.settlePayment(paymentPayload, requirements)) as SettleResponse;
	c.header("PAYMENT-RESPONSE", encodeBase64Json(settleResult));

	if (!settleResult.success) {
		return { response: c.json({ success: false, error: settleResult.errorReason, raw: settleResult }, 500), settleResult };
	}

	return {
		response: c.json({ success: true, txHash: settleResult.transaction, payer: settleResult.payer, raw: settleResult }),
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
	const { cfg, getResourceServer, description, parse, onSettled } = opts;

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

			const resource: ResourceInfo = { url: c.req.url, description, mimeType: "application/json" };

			const rs = getResourceServer(c.env);
			const { response, settleResult } = await x402Workflow(c, requirements, resource, rs);

			if (settleResult?.success && onSettled) {
				await onSettled(c, parsed, settleResult);
			}

			return response;
		} catch (e: any) {
			return c.json({ error: e?.message ?? "Bad Request" }, 400);
		}
	};
}

export function createTipHandler(opts: {
	cfg: NetConfig;
	getResourceServer: (env: Env) => x402ResourceServer;
	description?: string;
}) {
	const { cfg, getResourceServer } = opts;
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
	const { cfg, getResourceServer } = opts;
	const description = opts.description ?? "USDC Transfer";

	return createX402Handler({
		cfg,
		getResourceServer,
		description,
		parse: async (c) => {
			const p = await parseTransferParams(c);
			return { payTo: p.payTo, atomicAmount: p.atomicAmount };
		},
	});
}

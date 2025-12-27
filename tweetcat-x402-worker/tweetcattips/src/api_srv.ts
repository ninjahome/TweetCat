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


/** 两端通用路由：查询 end-user 信息 */
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


async function x402WorkFlow(
	c: Context<{ Bindings: Env }>,
	requirements: PaymentRequirements,
	resource: ResourceInfo,
	resourceServer: x402ResourceServer
): Promise<
	| { success: true; settleResult: SettleResponse }
	| { success: false; error: string; raw?: any }
> {

	const paymentHeader = getPaymentHeader(c);

	if (!paymentHeader) {
		const paymentRequired = resourceServer.createPaymentRequiredResponse([requirements], resource);
		c.status(402);
		c.header("PAYMENT-REQUIRED", encodeBase64Json(paymentRequired));
		return {success: false, error: "Payment Required"};
	}

	let paymentPayload;
	try {
		paymentPayload = decodeBase64Json(paymentHeader);
	} catch {
		return {success: false, error: "Invalid payment header encoding"};
	}
	console.log("[X402] Received payment payload:", JSON.stringify(paymentPayload));

	const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
	if (!verifyResult.isValid) {
		return {success: false, error: "Invalid Payment", raw: verifyResult.invalidReason};
	}
	console.log("[X402] verify Result Detail:", JSON.stringify(verifyResult));

	const settleResult = (await resourceServer.settlePayment(
		paymentPayload,
		requirements
	)) as SettleResponse;

	c.header("PAYMENT-RESPONSE", encodeBase64Json(settleResult));
	console.log("[X402] Settle Result Detail:", JSON.stringify(settleResult));

	if (!settleResult.success) {
		return {
			success: false,
			error: settleResult.errorReason || "Settle failed",
			raw: settleResult,
		};
	}
	return {success: true, settleResult};
}

export async function parseTipParams(c: any): Promise<TipObj> {
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

/**
 * 通用 tip handler 工厂：两端差异通过 cfg + getResourceServer(env) 注入
 * - 主网：getResourceServer 会带 createAuthHeaders
 * - 测试网：getResourceServer 不带 createAuthHeaders
 */
export function createTipHandler(opts: {
	cfg: NetConfig;
	getResourceServer: (env: Env) => any;
	description?: string;
}) {
	const {cfg, getResourceServer} = opts;
	const description = opts.description ?? "Tweet Tip Payment";

	return async (c: Context<{ Bindings: Env }>): Promise<Response> => {
		try {

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

			const resource = {
				url: c.req.url,
				description,
				mimeType: "application/json",
			};

			const resourceServer = getResourceServer(c.env);
			const x402Result = await x402WorkFlow(c, requirements, resource, resourceServer)

			if (!x402Result.success) {
				return c.json(
					{
						success: false,
						error: x402Result.error,
						raw: x402Result.raw,
					},
					x402Result.error === "Payment Required" ? 402 : 500
				);
			}

			const {settleResult} = x402Result;

			const record: TipRecord = {
				xId:tip.xId,
				mode:tip.mode,
				amountAtomic:tip.atomicAmount,
				payer:settleResult.payer!,
				txHash:settleResult.transaction,
			}

			await recordEscrowTips(c.env.DB, record)

			return c.json({
				success: true,
				txHash: settleResult.transaction,
				message: "Tip received and recorded!",
				raw: settleResult,
			});

		} catch (err: any) {
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
	};
}

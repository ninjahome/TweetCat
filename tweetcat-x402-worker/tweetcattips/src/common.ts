import type { Hono } from "hono";
import { cors } from "hono/cors";
import { generateJwt, generateWalletJwt } from "@coinbase/cdp-sdk/auth";
import { ContentfulStatusCode } from "hono/utils/http-status";
import type { SettleResponse } from "@x402/core/types";

/** 你当前 worker 的 Bindings */
export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
	CDP_WALLET_SECRET: string;
	DB: D1Database;
	TREASURY_ADDRESS: string;
}

/** CAIP-2 network id: e.g. "eip155:8453" */
export type Caip2Network = `${string}:${string}`;

export interface NetConfig {
	NETWORK: Caip2Network;
	FACILITATOR_URL: string;
	USDC: `0x${string}`;
	USDC_EIP712_NAME: string;
	USDC_EIP712_VERSION: string;
}

/** 统一挂载 CORS（两端环境共享） */
export function applyCors(app: Hono<{ Bindings: Env }>) {
	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"PAYMENT-SIGNATURE",
				"Payment-Signature",
				"PAYMENT",
				"Payment",
				"PAYMENT-REQUIRED",
				"Payment-Required",
				"PAYMENT-RESPONSE",
				"Payment-Response",
			],
			exposeHeaders: [
				"PAYMENT-REQUIRED",
				"Payment-Required",
				"PAYMENT-RESPONSE",
				"Payment-Response",
			],
		})
	);
}

/** 处理 wrangler secret 里 \n 转义 */
export function normalizeMultilineSecret(s: string): string {
	return (s ?? "").replace(/\\n/g, "\n");
}

/** UTF-8 安全的 base64(JSON) 编解码（避免 btoa/atob 遇到 unicode 报错） */
export function encodeBase64Json(obj: unknown): string {
	const json = JSON.stringify(obj);
	const bytes = new TextEncoder().encode(json);
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

export function decodeBase64Json<T = any>(b64: string): T {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	const json = new TextDecoder().decode(bytes);
	return JSON.parse(json) as T;
}

/** 0.01 -> 10000 (USDC 6 decimals) */
export function usdcToAtomic(amountStr: string): string {
	const s = (amountStr || "0").trim();
	const [intPartRaw, fracRaw = ""] = s.split(".");
	const intPart = intPartRaw === "" ? "0" : intPartRaw;
	const frac = (fracRaw + "000000").slice(0, 6);
	const i = intPart.replace(/^0+(?=\d)/, "");
	return `${i}${frac}`.replace(/^0+(?=\d)/, "") || "0";
}

export function getPaymentHeader(c: any): string | undefined {
	return (
		c.req.header("PAYMENT-SIGNATURE") ||
		c.req.header("Payment-Signature") ||
		c.req.header("PAYMENT") ||
		c.req.header("Payment")
	);
}

export function isHexAddress(addr: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

/** 生成 CDP 平台 JWT Authorization 头（通用） */
export async function createCdpJwtAuthHeader(params: {
	apiKeyId: string;
	apiKeySecret: string;
	requestMethod: string;
	requestHost: string;
	requestPath: string;
}): Promise<{ Authorization: string }> {
	const token = await generateJwt({
		apiKeyId: params.apiKeyId,
		apiKeySecret: normalizeMultilineSecret(params.apiKeySecret),
		requestMethod: params.requestMethod,
		requestHost: params.requestHost,
		requestPath: params.requestPath,
	});

	return { Authorization: `Bearer ${token}` };
}

/** x402 主网 facilitator（CDP hosted）专用：/platform/v2/x402 + endpoint */
export async function getX402AuthHeader(params: {
	apiKeyId: string;
	apiKeySecret: string;
	method: "GET" | "POST";
	endpoint: "/supported" | "/verify" | "/settle";
}): Promise<{ Authorization: string }> {
	const host = "api.cdp.coinbase.com";
	const basePath = "/platform/v2/x402";
	return createCdpJwtAuthHeader({
		apiKeyId: params.apiKeyId,
		apiKeySecret: params.apiKeySecret,
		requestMethod: params.method,
		requestHost: host,
		requestPath: `${basePath}${params.endpoint}`,
	});
}

/** CDP 平台 API 鉴权（可选 X-Wallet-Auth） */
export async function getCdpAuthHeader(
	env: Env,
	method: string,
	path: string,
	requestData?: Record<string, any>,
	requireWalletAuth: boolean = false
) {
	const host = "api.cdp.coinbase.com";

	const jwtHeader = await createCdpJwtAuthHeader({
		apiKeyId: env.CDP_API_KEY_ID,
		apiKeySecret: env.CDP_API_KEY_SECRET,
		requestMethod: method,
		requestHost: host,
		requestPath: path,
	});

	const headers: Record<string, string> = {
		...jwtHeader,
		"Content-Type": "application/json",
	};

	if (requireWalletAuth) {
		headers["X-Wallet-Auth"] = await generateWalletJwt({
			walletSecret: env.CDP_WALLET_SECRET,
			requestMethod: method,
			requestHost: host,
			requestPath: path,
			requestData: requestData ?? {},
		});
	}

	return headers;
}

/** 两端通用路由：查询 end-user 信息 */
export function registerUserInfoRoute(app: Hono<{ Bindings: Env }>) {
	app.get("/user-info", async (c) => {
		const userId = c.req.query("userId"); // x:12345 或 uuid
		if (!userId) return c.json({ error: "Missing userId" }, 400);

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
			return c.json({ error: "Internal Server Error", detail: err?.message }, 500);
		}
	});
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
	const { cfg, getResourceServer } = opts;
	const description = opts.description ?? "Tweet Tip Payment";

	return async (c: any): Promise<Response> => {
		const payTo = c.req.query("payTo");
		const amountStr = c.req.query("amount");

		if (!payTo) return c.json({ error: "Missing payTo" }, 400);
		if (!isHexAddress(payTo)) return c.json({ error: "Invalid payTo" }, 400);
		if (!amountStr) return c.json({ error: "Missing amount" }, 400);

		const atomicAmount = usdcToAtomic(amountStr);
		if (!/^\d+$/.test(atomicAmount) || atomicAmount === "0") {
			return c.json({ error: "Invalid amount" }, 400);
		}

		const resourceServer = getResourceServer(c.env);

		const requirements = {
			scheme: "exact" as const,
			network: cfg.NETWORK,
			asset: cfg.USDC,
			amount: atomicAmount,
			payTo: payTo as `0x${string}`,
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

		const paymentHeader = getPaymentHeader(c);

		if (!paymentHeader) {
			const paymentRequired = resourceServer.createPaymentRequiredResponse([requirements], resource);
			c.status(402);
			c.header("PAYMENT-REQUIRED", encodeBase64Json(paymentRequired));
			return c.json({ error: "Payment Required" });
		}

		try {
			const paymentPayload = decodeBase64Json(paymentHeader);
			console.log("[X402] Received payment payload:", JSON.stringify(paymentPayload));

			const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
			if (!verifyResult.isValid) {
				return c.json({ error: "Invalid Payment", reason: verifyResult.invalidReason }, 402);
			}

			console.log("[X402] verify Result Detail:", JSON.stringify(verifyResult));

			const settleResult = (await resourceServer.settlePayment(
				paymentPayload,
				requirements
			)) as SettleResponse;

			c.header("PAYMENT-RESPONSE", encodeBase64Json(settleResult));
			console.log("[X402] Settle Result Detail:", JSON.stringify(settleResult));

			if (!settleResult.success) {
				return c.json(
					{
						success: false,
						error: settleResult.errorReason,
						message: JSON.stringify(settleResult),
						raw: settleResult,
					},
					500
				);
			}

			return c.json({
				success: true,
				txHash: settleResult.transaction,
				payer: settleResult.payer,
				message: "Tip received!",
				raw: settleResult,
			});
		} catch (err: any) {
			return c.json({ error: "Internal Server Error", detail: err?.message }, 500);
		}
	};
}

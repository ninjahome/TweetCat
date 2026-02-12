import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { generateJwt, generateWalletJwt } from "@coinbase/cdp-sdk/auth";
import type { x402ResourceServer } from "@x402/core/server";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { CdpClient, EvmServerAccount } from "@coinbase/cdp-sdk";

export const CURRENCY_SYMBOL_USDC = 'USDC'

// API Paths
export const API_PATH_TIP = "/tip";
export const API_PATH_USDC_TRANSFER = "/usdc-transfer";
export const API_PATH_USER_INFO = "/user-info";
export const API_PATH_VALIDATE_TOKEN = "/validate-token";
export const API_PATH_REWARDS_QUERY_VALID = "/rewards/query_valid";
export const API_PATH_REWARDS_CLAIM_ITEM = "/rewards/claim_item";
export const API_PATH_REWARDS_QUERY_HISTORY = "/rewards/query_history";
export const API_PATH_FEES_QUERY_HISTORY = "/fees/query_history";
export const API_PATH_USER_TRANSFER_BY_TWITTER = "/user/transfer_by_twitter";
export const API_PATH_ONRAMP_CREATE_SESSION = "/onramp/create_session";
export const API_PATH_ONRAMP_WEBHOOK = "/onramp/webhook";

// Ads API Paths
export const API_PATH_ADS_EXECUTOR_DASHBOARD_INFO = "/ads/executor/dashboard_info";
export const API_PATH_ADS_BALANCE = "/ads/executor/balance";
export const API_PATH_ADS_CREATE = "/ads/publisher/create";
export const API_PATH_ADS_UPDATE = "/ads/publisher/update";
export const API_PATH_ADS_MY_ADS = "/ads/publisher/my_ads";
export const API_PATH_ADS_LIST = "/ads/executor/list";
export const API_PATH_ADS_VERSION = "/ads/executor/version";
export const API_PATH_ADS_CLAIM = "/ads/executor/claim";
export const API_PATH_ADS_MY_CLAIMS = "/ads/executor/my_claims";
export const API_PATH_ADS_MY_TASKS = "/ads/executor/my_tasks";
export const API_PATH_ADS_SUBMIT_PROOF = "/ads/executor/submit_proof";
export const API_PATH_ADS_PUBLISHER_RECHARGE = "/ads/publisher/recharge";
export const API_PATH_ADS_PUBLISHER_WITHDRAW = "/ads/publisher/withdraw";
export const API_PATH_ADS_PUBLISHER_LEDGER = "/ads/publisher/ledger";
export const API_PATH_ADS_TOGGLE_STATUS = "/ads/publisher/toggle_status";
export const API_PATH_ADS_TOP_UP_BUDGET = "/ads/publisher/top_up_budget";
export const API_PATH_ADS_PUBLISHER_DASHBOARD_INFO = "/ads/publisher/dashboard_info";
export const API_PATH_ADS_PUBLISHER_SPEND_HISTORY = "/ads/publisher/spend_history";

export const signedOperationPaths: string[] = [
	API_PATH_ADS_CREATE,
	API_PATH_ADS_UPDATE,
	API_PATH_ADS_CLAIM,
	API_PATH_ADS_PUBLISHER_WITHDRAW
];

export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
	CDP_WALLET_SECRET: string;
	DB: D1Database;
	REWARD_FOR_SIGNUP: number;
	FEE_FOR_WITHDRAW: number;
	CDP_TREASURY_ACCOUNT_NAME: string;
	CDP_TREASURY_ACCOUNT_POLICY_ID?: string;
	TREASURY_ADDRESS: string;
	TREASURY_PRIVATE_KEY: string;
	SETTLEMENT_DELAY_HOURS: number;
}

export type ExtendedEnv = {
	Bindings: Env;
	Variables: {
		cfg: NetConfig;
		getResourceServer: (env: Env) => x402ResourceServer;
	};
};
export type ExtCtx = Context<ExtendedEnv>;
/** CAIP-2 network id: e.g. "eip155:8453" */
export type Caip2Network = `${string}:${string}`;

export interface NetConfig {
	NETWORK: Caip2Network;
	FACILITATOR_URL: string;
	USDC: `0x${string}`;
	USDC_EIP712_NAME: string;
	USDC_EIP712_VERSION: string;
}

export const app = new Hono<ExtendedEnv>();
applyCors(app);

let _cdpInstance: CdpClient | null = null;

export function getCdpClient(env: Env): CdpClient {
	if (!_cdpInstance) {
		if (!env.CDP_API_KEY_ID || !env.CDP_WALLET_SECRET) {
			throw new Error("CRITICAL_CONFIG_MISSING: CDP credentials not found in environment.");
		}
		_cdpInstance = new CdpClient({
			apiKeyId: env.CDP_API_KEY_ID,
			apiKeySecret: env.CDP_API_KEY_SECRET,
			walletSecret: env.CDP_WALLET_SECRET,
		});
	}
	return _cdpInstance;
}

export function applyCors(app: Hono<ExtendedEnv>) {
	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"X-Device-Signature",
				"X-Device-Timestamp",
				"X-Device-Signature-Version",
				"X-Device-IAT",
				"X-Device-JTI",
				"X-Body-SHA256",
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

export function normalizeMultilineSecret(s: string): string {
	return (s ?? "").replace(/\\n/g, "\n");
}

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

export function usdcToAtomicSafe(amountStr: string): string {
	const s = (amountStr ?? "").trim();
	if (!/^\d+(\.\d{0,6})?$/.test(s)) throw new Error("invalid usdc string")

	const [intPart, frac = ""] = s.split(".");
	const fracPadded = (frac + "000000").slice(0, 6);
	const out = (intPart.replace(/^0+(?=\d)/, "") || "0") + fracPadded;
	return out.replace(/^0+(?=\d)/, "") || "0";
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

export interface cdpFetchResult {
	ok: boolean;
	status: ContentfulStatusCode;
	data: any;
	raw: string;
}

export async function cdpFetch(c: ExtCtx, path: string, method: string, body?: any, requireWalletAuth: boolean = false,): Promise<cdpFetchResult> {
	const url = `https://api.cdp.coinbase.com${path}`;
	const headers = await getCdpAuthHeader(c.env, method, path, body ?? {}, requireWalletAuth);
	const init: RequestInit = { method, headers: { ...headers, "Content-Type": "application/json" } };
	if (body && method !== "GET") init.body = JSON.stringify(body);

	const res = await fetch(url, init);
	const raw = await res.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : null;
	} catch {
		data = raw;
	}
	return { ok: res.ok, status: res.status as ContentfulStatusCode, data, raw };
}

let treasuryAccountP: Promise<EvmServerAccount> | null = null;

export async function getOrCreateTreasuryEOA2(c: ExtCtx): Promise<EvmServerAccount> {
	try {
		if (!!treasuryAccountP) return treasuryAccountP

		const cdp = getCdpClient(c.env)
		const name = c.env.CDP_TREASURY_ACCOUNT_NAME;
		const namedAccount = await cdp.evm.getOrCreateAccount({
			name: name
		});

		const policyId = c.env.CDP_TREASURY_ACCOUNT_POLICY_ID
		if (!policyId) return namedAccount

		return await cdp.evm.updateAccount({
			address: namedAccount.address,
			update: {
				accountPolicy: policyId,
			},
		})

	} catch (err: any) {
		console.error("------>>>[getOrCreateTreasuryEOA] failed:", err)
		throw new Error("failed to get server account:", err)
	}
}


export function toFiat2dp(amount: any): string {
	const s = (amount ?? "").toString().trim();
	const n = Number(s);
	if (!Number.isFinite(n) || n <= 0) return "";
	return n.toFixed(2);
}

/**
 * 返回 JSON 格式的错误响应
 * @param c - Hono 上下文
 * @param status - HTTP 状态码（200-599 的数字）
 * @param code - 错误代码
 * @param detail - 错误详情
 */
export function jsonError(c: ExtCtx, status: ContentfulStatusCode, code: string, detail: string) {
	return c.json({ error: code, detail }, status);
}

/**
 * 检查值是否为有效的非空字符串
 */
export function requireStringField(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * 解析正整数
 * @returns 如果有效返回正整数，否则返回 null
 */
export function parsePositiveInt(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value > 0 ? value : null;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isNaN(parsed) && parsed > 0) return parsed;
	}
	return null;
}

/**
 * 解析正原子单位数值（用于 Token 精度）
 * @returns 如果有效返回字符串格式的 BigInt，否则返回 null
 */
export function parsePositiveAtomic(value: unknown): string | null {
	if (!requireStringField(value)) return null;
	if (!/^\d+$/.test(value)) return null;
	try {
		const big = BigInt(value);
		if (big <= 0n) return null;
		return big.toString();
	} catch {
		return null;
	}
}

// ========= Crypto / Encoding helpers (DPoP-like) =========
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

export function base64UrlToArrayBuffer(b64u: string): ArrayBuffer {
	const padded = b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4);
	return base64ToArrayBuffer(padded);
}

export function decodeB64OrB64UrlToArrayBuffer(input: string): ArrayBuffer {
	if (input.includes("-") || input.includes("_")) return base64UrlToArrayBuffer(input);
	return base64ToArrayBuffer(input);
}

export function arrayBufferToBase64Url(ab: ArrayBuffer): string {
	const bytes = new Uint8Array(ab);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return arrayBufferToBase64Url(digest);
}

export function canonicalHtu(rawUrl: string): string {
	const u = new URL(rawUrl);
	return `${u.origin}${u.pathname}`;
}

export async function spkiB64ToJktB64Url(spkiB64: string): Promise<string> {
	const spkiBytes = new Uint8Array(base64ToArrayBuffer(spkiB64));
	const digest = await crypto.subtle.digest("SHA-256", spkiBytes);
	return arrayBufferToBase64Url(digest);
}

import {Context, Hono} from "hono";
import {cors} from "hono/cors";
import {generateJwt, generateWalletJwt} from "@coinbase/cdp-sdk/auth";
import type {x402ResourceServer} from "@x402/core/server";
import {ContentfulStatusCode} from "hono/utils/http-status";
import {CdpClient, EvmServerAccount} from "@coinbase/cdp-sdk";

export const CURRENCY_SYMBOL_USDC = 'USDC'

export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
	CDP_WALLET_SECRET: string;
	DB: D1Database;
	REWARD_FOR_SIGNUP: number;
	FEE_FOR_WITHDRAW: number;
	CDP_TREASURY_ACCOUNT_NAME: string;
	CDP_TREASURY_ACCOUNT_POLICY_ID?: string;
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
	return {Authorization: `Bearer ${token}`};
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
	const init: RequestInit = {method, headers: {...headers, "Content-Type": "application/json"}};
	if (body && method !== "GET") init.body = JSON.stringify(body);

	const res = await fetch(url, init);
	const raw = await res.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : null;
	} catch {
		data = raw;
	}
	return {ok: res.ok, status: res.status as ContentfulStatusCode, data, raw};
}

let treasuryAccountP: Promise<EvmServerAccount> | null = null;

export async function getOrCreateTreasuryEOA(c: ExtCtx): Promise<EvmServerAccount> {
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

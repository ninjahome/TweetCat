import { Hono } from "hono";
import { cors } from "hono/cors";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import {SettleResponse} from "@x402/core/types";

export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

/** CAIP-2 network id: e.g. "eip155:8453" */
export type Caip2Network = `${string}:${string}`;

/** 你要求的三个字段 +（建议）补充 domain 配置与是否需要鉴权 */
export interface NetConfig {
	NETWORK: Caip2Network;
	FACILITATOR_URL: string;
	USDC: `0x${string}`;

	/** ⭐ 关键：EIP-712 Domain（不同链可能不同） */
	USDC_EIP712_NAME: string;
	USDC_EIP712_VERSION: string;

	/** CDP hosted facilitator 才需要 */
	REQUIRE_FACILITATOR_AUTH: boolean;
}

function getNetConfig(isMainnet: boolean): NetConfig {
	if (isMainnet) {
		return {
			NETWORK: "eip155:8453",
			FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
			USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			// Base 主网：很多地方把它称为 USD Coin（但 explorer 也提示展示名和 name() 可能不同）
			USDC_EIP712_NAME: "USD Coin",
			USDC_EIP712_VERSION: "2",
			REQUIRE_FACILITATOR_AUTH: true,
		};
	}

	return {
		NETWORK: "eip155:84532",
		FACILITATOR_URL: "https://x402.org/facilitator",
		USDC: "0x036CbD53842c5426634e7929541eC2318F3dCF7e",
		// ⭐ Base Sepolia：CDP 示例里 domain name 用的是 "USDC"
		USDC_EIP712_NAME: "USDC",
		USDC_EIP712_VERSION: "2",
		REQUIRE_FACILITATOR_AUTH: false,
	};
}

app.use(
	"*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE", "Payment-Signature", "PAYMENT", "Payment"],
		exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
	})
);

async function getAuthHeader(env: Env, method: string, endpoint: string) {
	const basePath = "/platform/v2/x402";
	const host = "api.cdp.coinbase.com";

	const token = await generateJwt({
		apiKeyId: env.CDP_API_KEY_ID,
		apiKeySecret: env.CDP_API_KEY_SECRET.replace(/\\n/g, "\n"),
		requestMethod: method,
		requestPath: `${basePath}${endpoint}`,
		requestHost: host,
	});

	return { Authorization: `Bearer ${token}` };
}

/** Base64 编解码（保留你原来的逻辑） */
const encode = (obj: any) => btoa(JSON.stringify(obj));
const decode = (str: string) => JSON.parse(atob(str));

function usdcToAtomic(amountStr: string): string {
	const s = (amountStr || "0").trim();
	const [intPartRaw, fracRaw = ""] = s.split(".");
	const intPart = intPartRaw === "" ? "0" : intPartRaw;
	const frac = (fracRaw + "000000").slice(0, 6);
	const i = intPart.replace(/^0+(?=\d)/, "");
	return `${i}${frac}`.replace(/^0+(?=\d)/, "") || "0";
}

function getResourceServer(env: Env, cfg: NetConfig) {
	const client = new HTTPFacilitatorClient({
		url: cfg.FACILITATOR_URL,
		...(cfg.REQUIRE_FACILITATOR_AUTH
			? {
				createAuthHeaders: async () => {
					const [supported, verify, settle] = await Promise.all([
						getAuthHeader(env, "GET", "/supported"),
						getAuthHeader(env, "POST", "/verify"),
						getAuthHeader(env, "POST", "/settle"),
					]);
					return { supported, verify, settle };
				},
			}
			: {}),
	});

	return new x402ResourceServer(client).register("eip155:*", new ExactEvmScheme());
}


const tipHandler =
	(isMainnet: boolean) =>
		async (c: any): Promise<Response> => {
			const cfg = getNetConfig(isMainnet);

			const payTo = c.req.query("payTo");
			const amountStr = c.req.query("amount") || "0.01";
			if (!payTo) return c.json({ error: "Missing payTo" }, 400);

			const atomicAmount = usdcToAtomic(amountStr);
			const resourceServer = getResourceServer(c.env, cfg);

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
				description: "Tweet Tip Payment",
				mimeType: "application/json",
			};

			const paymentHeader =
				c.req.header("PAYMENT-SIGNATURE") ||
				c.req.header("Payment-Signature") ||
				c.req.header("PAYMENT") ||
				c.req.header("Payment");

			if (!paymentHeader) {
				const paymentRequired = resourceServer.createPaymentRequiredResponse([requirements], resource);
				const encodedReq = encode(paymentRequired);

				c.status(402);
				c.header("PAYMENT-REQUIRED", encodedReq);
				return c.json({ error: "Payment Required" });
			}

			try {
				const paymentPayload = decode(paymentHeader);
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

				c.header("PAYMENT-RESPONSE", encode(settleResult));

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

app.get("/tip", tipHandler(true)); // 主网
app.get("/tip-test", tipHandler(false)); // 测试网

export default app;

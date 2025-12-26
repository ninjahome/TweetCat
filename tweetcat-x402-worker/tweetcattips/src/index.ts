import {Hono} from "hono";
import {cors} from "hono/cors";
import {x402ResourceServer, HTTPFacilitatorClient} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";
import {generateJwt, generateWalletJwt} from "@coinbase/cdp-sdk/auth";
import {SettleResponse} from "@x402/core/types";
import {ContentfulStatusCode} from "hono/utils/http-status";
import {CdpClient} from "@coinbase/cdp-sdk";

export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
	CDP_WALLET_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

/** CAIP-2 network id: e.g. "eip155:8453" */
export type Caip2Network = `${string}:${string}`;

export interface NetConfig {
	NETWORK: Caip2Network;
	FACILITATOR_URL: string;
	USDC: `0x${string}`;
	USDC_EIP712_NAME: string;
	USDC_EIP712_VERSION: string;
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

	return {Authorization: `Bearer ${token}`};
}

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
					return {supported, verify, settle};
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
			const amountStr = c.req.query("amount");
			if (!payTo) return c.json({error: "Missing payTo"}, 400);
			if (!amountStr) return c.json({error: "Missing amount"}, 400);

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
				return c.json({error: "Payment Required"});
			}

			try {
				const paymentPayload = decode(paymentHeader);
				console.log("[X402] Received payment payload:", JSON.stringify(paymentPayload));

				const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
				if (!verifyResult.isValid) {
					return c.json({error: "Invalid Payment", reason: verifyResult.invalidReason}, 402);
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
				return c.json({error: "Internal Server Error", detail: err?.message}, 500);
			}
		};

app.get("/tip", tipHandler(true)); // 主网
app.get("/tip-test", tipHandler(false)); // 测试网


// 添加一个新的辅助函数，用于标准的 CDP 平台 API 鉴权
async function getCdpAuthHeader(env: Env, method: string, path: string, requestData?: Record<string, any>, requireWalletAuth: boolean = false) {

	const host = "api.cdp.coinbase.com";
	// 注意：这里的 path 必须包含 /platform 前缀，但不包含 host
	const token = await generateJwt({
		apiKeyId: env.CDP_API_KEY_ID,
		apiKeySecret: env.CDP_API_KEY_SECRET.replace(/\\n/g, "\n"),
		requestMethod: method,
		requestPath: path,
		requestHost: host,
	});
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};

	if (requireWalletAuth) {
		const walletJwt = await generateWalletJwt({
			walletSecret: env.CDP_WALLET_SECRET,
			requestMethod: method,
			requestHost: host,
			requestPath: path,
			requestData: requestData ?? {},
		});
		headers["X-Wallet-Auth"] = walletJwt;
	}

	return headers;
}

// 查询接口实现
app.get("/user-info", async (c) => {
	const userId = c.req.query("userId"); // 传入 x:12345 或 uuid
	if (!userId) return c.json({error: "Missing userId"}, 400);

	// 根据文档，URL 应该是 /platform/v2/end-users/{userId}
	const path = `/platform/v2/end-users/${userId}`;
	const url = `https://api.cdp.coinbase.com${path}`;

	try {
		const headers = await getCdpAuthHeader(c.env, "GET", path);

		const response = await fetch(url, {
			method: "GET",
			headers: headers,
		});

		if (!response.ok) {
			const errorData = await response.text();
			console.error("[CDP Error]", errorData);
			return c.json({
				error: "Failed to fetch user from CDP",
				status: response.status,
				detail: errorData
			}, response.status as ContentfulStatusCode);
		}

		const userData = await response.json();
		return c.json(userData);
	} catch (err: any) {
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
});


//根据推特/X 用户 id 预创建 End User（type=x，createSmartAccount=true）
app.get("/end-users/x", async (c) => {


	const xUserIdRaw = c.req.query("xId");
	const xUserId = (xUserIdRaw || "").trim();
	if (!xUserId) return c.json({error: "xId"}, 400);
	const userId = `x-${xUserId}`;

	try {

		const cdp = new CdpClient({
			apiKeyId: c.env.CDP_API_KEY_ID,
			apiKeySecret: c.env.CDP_API_KEY_SECRET,
			walletSecret: c.env.CDP_WALLET_SECRET,
		});

		const endUser = await cdp.endUser.createEndUser({
			userId,
			authenticationMethods: [
				{type: "jwt", kid: "tweetcat-x-jwt-key-v1", sub: userId}
			],
			evmAccount: {createSmartAccount: true}
		});

		console.log("Created end user:", endUser);
		return c.json(JSON.stringify(endUser), 200);
	} catch (err: any) {
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
});

export default app;

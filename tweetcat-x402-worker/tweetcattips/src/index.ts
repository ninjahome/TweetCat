import {Hono} from "hono";
import {cors} from "hono/cors";
import {x402ResourceServer, HTTPFacilitatorClient} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";
import {generateJwt} from "@coinbase/cdp-sdk/auth";

export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

/**
 * ✅ 主网切换点
 */
const IS_MAINNET = true;

const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";

// ✅ 文档建议：主网走 CDP hosted facilitator（Running on Mainnet）
// 测试：x402.org/facilitator（Base Sepolia / Solana Devnet）
const FACILITATOR_URL = IS_MAINNET
	? "https://api.cdp.coinbase.com/platform/v2/x402"
	: "https://x402.org/facilitator"; // 你现在测试网用它是对的 :contentReference[oaicite:3]{index=3}

const USDC = IS_MAINNET
	? ("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const) // Base 主网 USDC
	: ("0x036CbD53842c5426634e7929541eC2318F3dCF7e" as const); // Base Sepolia USDC :contentReference[oaicite:5]{index=5}

app.use("*", cors({
	origin: "*",
	allowMethods: ["GET", "POST", "OPTIONS"],
	allowHeaders: ["Content-Type", "Payment-Signature", "Payment"],
	exposeHeaders: ["Payment-Required", "Payment-Response"],
}));

async function getAuthHeader(env: Env, method: string, endpoint: string) {
	const basePath = '/platform/v2/x402';
	const host = 'api.cdp.coinbase.com';

	const token = await generateJwt({
		apiKeyId: env.CDP_API_KEY_ID,
		apiKeySecret: env.CDP_API_KEY_SECRET.replace(/\\n/g, '\n'),
		requestMethod: method,
		requestPath: `${basePath}${endpoint}`,
		requestHost: host,
	});
	return {Authorization: `Bearer ${token}`};
}

/**
 * ✅ Base64 编解码（你原来的逻辑保留）
 */
const encode = (obj: any) => btoa(JSON.stringify(obj));
const decode = (str: string) => JSON.parse(atob(str));

function usdcToAtomic(amountStr: string): string {
	const s = (amountStr || "0").trim();
	const [intPartRaw, fracRaw = ""] = s.split(".");
	const intPart = intPartRaw === "" ? "0" : intPartRaw;
	const frac = (fracRaw + "000000").slice(0, 6); // 补齐/截断到 6 位
	// 去掉前导 0，但保留至少一个 0
	const i = intPart.replace(/^0+(?=\d)/, "");
	return `${i}${frac}`.replace(/^0+(?=\d)/, "") || "0";
}

function getResourceServer(env: Env) {

	const createAuthHeaders = async () => {
		const [supported, verify, settle] = await Promise.all([
			getAuthHeader(env, 'GET', '/supported'),
			getAuthHeader(env, 'POST', '/verify'),
			getAuthHeader(env, 'POST', '/settle'),
		]);
		console.log('[X402] Dynamic auth headers generated for three endpoints');
		return {supported, verify, settle};
	};

	const client = new HTTPFacilitatorClient({
		url: FACILITATOR_URL,
		createAuthHeaders
	});

	return  new x402ResourceServer(client).register(
		"eip155:*",
		new ExactEvmScheme()
	);
}

interface UnifiedSettleResponse {
	// --- 200 业务层字段 ---
	success?: boolean;          // 是否支付成功
	payer?: string;            // 支付者地址
	transaction?: string;      // 交易哈希 (成功时非空，失败时可能是 "")
	network?: string;          // 所在网络
	errorReason?: string;      // 业务错误枚举 (insufficient_funds, failed_to_execute_transfer 等)

	// --- error 系统层字段 ---
	errorType?: string;        // 系统错误类型 (invalid_request, unauthorized 等)
	errorMessage?: string;     // 人类可读的报错信息
	correlationId?: string;    // 请求追踪 ID
	errorLink?: string;        // 错误文档链接
}

app.get("/tip", async (c) => {
	const payTo = c.req.query("payTo");
	const amountStr = c.req.query("amount") || "0.01";
	if (!payTo) return c.json({error: "Missing payTo"}, 400);

	const atomicAmount = usdcToAtomic(amountStr);
	const resourceServer = getResourceServer(c.env);

	const requirements = {
		scheme: "exact" as const,
		network: NETWORK,
		asset: USDC,
		amount: atomicAmount,
		payTo: payTo as `0x${string}`,
		maxTimeoutSeconds: 300,
		extra: {
			name: "USDC",
			version: "2",
			resourceUrl: c.req.url,
		},
	} as const;

	const resource = {
		url: c.req.url,
		description: "Tweet Tip Payment",
		mimeType: "application/json",
	};

	/**
	 * ✅ 兼容读取各种 payment header
	 */
	const paymentHeader =
		c.req.header("PAYMENT-SIGNATURE") ||
		c.req.header("Payment-Signature") ||
		c.req.header("Payment") ||
		c.req.header("PAYMENT")

	if (!paymentHeader) {
		const paymentRequired = resourceServer.createPaymentRequiredResponse(
			[requirements],
			resource
		);
		const encodedReq = encode(paymentRequired);

		c.status(402);
		c.header("Payment-Required", encodedReq);

		return c.json({error: "Payment Required"});
	}

	try {
		const paymentPayload = decode(paymentHeader);

		console.log('[X402] Received payment payload:', JSON.stringify(paymentPayload));

		const verifyResult = await resourceServer.verifyPayment(
			paymentPayload,
			requirements
		);
		if (!verifyResult.isValid) {
			return c.json(
				{error: "Invalid Payment", reason: verifyResult.invalidReason},
				402
			);
		}

		console.log('[X402] verify Result Detail:', JSON.stringify(verifyResult));

		const settleResult = await resourceServer.settlePayment(
			paymentPayload,
			requirements
		) as UnifiedSettleResponse;

		const encodedRes = encode(settleResult);
		c.header("Payment-Response", encodedRes);

		console.log('[X402] Settle Result Detail:', JSON.stringify(settleResult),
			"paymentPayload", paymentPayload, "requirements", requirements);

		if (!settleResult.success) {
			return c.json({
				success: false,
				error: settleResult.errorType,
				message: JSON.stringify(settleResult),
				raw: settleResult
			}, 500);
		}

		return c.json({
			success: true,
			txHash: settleResult.transaction,
			payer: settleResult.payer,
			message: "Tip received!",
			raw: settleResult
		});

	} catch (err: any) {
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
});

export default app;

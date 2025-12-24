import { Hono } from "hono";
import { cors } from 'hono/cors';
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

export interface Env {
	CDP_API_KEY_ID?: string;
	CDP_API_KEY_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

const IS_MAINNET = false;
const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";
const FACILITATOR_URL = IS_MAINNET
	? "https://facilitator.cdp.coinbase.com/v1/x402/settle"
	: "https://x402.org/facilitator";

// --- CORS 配置 (严格匹配文档) ---
app.use('*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Payment', 'Payment-Signature', 'X-Payment'],
	exposeHeaders: ['Payment-Required', 'Payment-Response', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
}));

// 1️⃣ 初始化 Resource Server
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
	.register("eip155:*", new ExactEvmScheme());

// --- 辅助函数：Base64 编解码 ---
const encode = (obj: any) => btoa(JSON.stringify(obj));
const decode = (str: string) => JSON.parse(atob(str));

// 2️⃣ 业务路由
app.get("/tip", async (c) => {
	const payTo = c.req.query('payTo');
	const amountStr = c.req.query('amount') || "0.01";
	if (!payTo) return c.json({ error: "Missing payTo" }, 400);
	const atomicAmount = (Math.round(parseFloat(amountStr) * 1_000_000)).toString();
	const requirements = {
		scheme: "exact" as const,
		network: NETWORK, // "eip155:84532"
		asset: IS_MAINNET
			? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  // 主网 USDC
			: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // 测试网 USDC
		amount: atomicAmount,
		payTo: payTo as `0x${string}`,
		maxTimeoutSeconds: 300,
		extra: {
			name: "USDC",
			version: "2",
			resourceUrl: c.req.url
		}
	}as const;

	const resource = {
		url: c.req.url,
		description: "Tweet Tip Payment",
		mimeType: "application/json",
	};
	// 3️⃣ 检查支付 Header (支持多种写法)
	const paymentHeader = c.req.header('Payment-Signature') ||
		c.req.header('PAYMENT-SIGNATURE') ||
		c.req.header('X-Payment');

	if (!paymentHeader) {
		console.log("--- [x402] No payment header, sending 402 ---");
		// 手动生成 402 响应头
		const paymentRequired = resourceServer.createPaymentRequiredResponse([requirements], resource);
		const encodedReq = encode(paymentRequired);

		c.status(402);
		c.header("Payment-Required", encodedReq);
		c.header("PAYMENT-REQUIRED", encodedReq); // 双重保障
		return c.json({ error: "Payment Required", message: "Please pay to continue" });
	}

	try {
		console.log("--- [x402] Payment header found, verifying... ---");
		const paymentPayload = decode(paymentHeader);

		// 4️⃣ 验证支付结果 (Verify)
		const verifyResult = await resourceServer.verifyPayment(paymentPayload, requirements);
		if (!verifyResult.isValid) {
			console.error("--- [x402] Verify failed:", verifyResult.invalidReason);
			return c.json({ error: "Invalid Payment", reason: verifyResult.invalidReason }, 402);
		}

		// 5️⃣ 结算支付 (Settle)
		console.log("--- [x402] Verifed, settling... ---");
		const settleResult = await resourceServer.settlePayment(paymentPayload, requirements);

		// 6️⃣ 构造成功响应
		const encodedRes = encode(settleResult);
		c.header("Payment-Response", encodedRes);
		c.header("PAYMENT-RESPONSE", encodedRes);

		return c.json({
			success: true,
			txHash: settleResult.transaction || (settleResult as any).transactionHash,
			message: "Tip received!"
		});

	} catch (err: any) {
		console.error("--- [x402] Processing error:", err);
		return c.json({ error: "Internal Server Error", detail: err.message }, 500);
	}
});

export default app;

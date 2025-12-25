import {Hono} from "hono";
import {cors} from "hono/cors";
import {x402ResourceServer, HTTPFacilitatorClient} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";

export interface Env {
	CDP_API_KEY_ID?: string;
	CDP_API_KEY_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

/**
 * ✅ 主网切换点
 */
const IS_MAINNET = false;

const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";

// ✅ 文档建议：主网走 CDP hosted facilitator（Running on Mainnet）
// 测试：x402.org/facilitator（Base Sepolia / Solana Devnet）
const FACILITATOR_URL = IS_MAINNET
	? "https://api.cdp.coinbase.com/platform/v2/x402"
	: "https://x402.org/facilitator"; // 你现在测试网用它是对的 :contentReference[oaicite:3]{index=3}

const USDC = IS_MAINNET
	? ("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const) // Base 主网 USDC
	: ("0x036CbD53842c5426634e7929541eC2318F3dCF7e" as const); // Base Sepolia USDC :contentReference[oaicite:5]{index=5}

/**
 * ✅ CORS：把 Payment / PAYMENT / PAYMENT-SIGNATURE 都放开
 */
app.use(
	"*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: [
			"Content-Type",
			"Payment",
			"PAYMENT",
			"Payment-Signature",
			"PAYMENT-SIGNATURE",
			"X-Payment",
			"X-PAYMENT",
		],
		exposeHeaders: [
			"Payment-Required",
			"PAYMENT-REQUIRED",
			"Payment-Response",
			"PAYMENT-RESPONSE",
		],
	})
);

/**
 * ✅ Base64 编解码（你原来的逻辑保留）
 */
const encode = (obj: any) => btoa(JSON.stringify(obj));
const decode = (str: string) => JSON.parse(atob(str));

/**
 * ✅ 金额转换：避免 parseFloat
 * 支持: "0.01" / "1" / "1.2" / "1.234567"（超过 6 位会截断）
 */
function usdcToAtomic(amountStr: string): string {
	const s = (amountStr || "0").trim();
	const [intPartRaw, fracRaw = ""] = s.split(".");
	const intPart = intPartRaw === "" ? "0" : intPartRaw;
	const frac = (fracRaw + "000000").slice(0, 6); // 补齐/截断到 6 位
	// 去掉前导 0，但保留至少一个 0
	const i = intPart.replace(/^0+(?=\d)/, "");
	return `${i}${frac}`.replace(/^0+(?=\d)/, "") || "0";
}

/**
 * ✅ Facilitator client + resource server
 */
const facilitatorClient = new HTTPFacilitatorClient({url: FACILITATOR_URL});
const resourceServer = new x402ResourceServer(facilitatorClient).register(
	"eip155:*",
	new ExactEvmScheme()
);

app.get("/tip", async (c) => {
	const payTo = c.req.query("payTo");
	const amountStr = c.req.query("amount") || "0.01";
	if (!payTo) return c.json({error: "Missing payTo"}, 400);

	const atomicAmount = usdcToAtomic(amountStr);

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
		c.req.header("PAYMENT") ||
		c.req.header("X-Payment") ||
		c.req.header("X-PAYMENT");

	if (!paymentHeader) {
		const paymentRequired = resourceServer.createPaymentRequiredResponse(
			[requirements],
			resource
		);
		const encodedReq = encode(paymentRequired);

		c.status(402);
		c.header("PAYMENT-REQUIRED", encodedReq);
		c.header("Payment-Required", encodedReq);

		return c.json({error: "Payment Required"});
	}

	try {
		const paymentPayload = decode(paymentHeader);

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

		const settleResult = await resourceServer.settlePayment(
			paymentPayload,
			requirements
		);

		const encodedRes = encode(settleResult);
		c.header("PAYMENT-RESPONSE", encodedRes);
		c.header("Payment-Response", encodedRes);

		return c.json({
			success: true,
			txHash:
				(settleResult as any).transaction ||
				(settleResult as any).transactionHash,
			message: "Tip received!",
		});
	} catch (err: any) {
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
});

export default app;

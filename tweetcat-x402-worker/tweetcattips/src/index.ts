import * as jose from 'jose';

export interface Env {
	CDP_API_KEY_ID?: string;
	CDP_API_KEY_SECRET?: string;
}

interface X402SettleResponse {
	success: boolean;
	transactionHash?: string;
	transaction?: string;
	payer?: string;
	network?: string;
	errorReason?: string;
}

// 配置网络：false 表示测试网（Base Sepolia），true 表示主网（Base 主网）
const IS_MAINNET = false;
const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";  // 使用 CAIP-2 网络标识:contentReference[oaicite:10]{index=10}

// 配置 Facilitator 接口 URL：测试网使用公共facilitator，主网使用CDP平台接口
const FACILITATOR_URL = IS_MAINNET
	? "https://api.cdp.coinbase.com/platform/v2/x402/settle"
	: "https://x402.org/facilitator";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, X-Requested-With",
	"Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE"
};

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		console.log("[ENTRY] New request", req.method, req.url);
		if (req.method === "OPTIONS") {
			// 处理预检请求
			return new Response(null, {headers: corsHeaders});
		}

		const url = new URL(req.url);
		if (url.pathname !== "/tip") {
			return new Response("Not Found", {status: 404, headers: corsHeaders});
		}

		// 提取支付参数
		const payTo = url.searchParams.get("payTo");      // 接收付款的合约地址
		const amountStr = url.searchParams.get("amount"); // 支付金额（USDC）
		console.log("[PARAMS]", {payTo, amountStr});
		if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo) || !amountStr || isNaN(Number(amountStr))) {
			// 基础校验未通过
			return new Response(JSON.stringify({error: "Invalid parameters"}), {
				status: 400,
				headers: {...corsHeaders, "Content-Type": "application/json"}
			});
		}

		// **阶段1**：返回支付要求 (402)
		const paymentSignature = req.headers.get("PAYMENT-SIGNATURE");  // 检查客户端是否已附带支付签名头:contentReference[oaicite:11]{index=11}
		if (!paymentSignature) {
			const price = `$${Number(amountStr).toFixed(2)}`;

			const paymentRequired = {
				x402Version: 2,
				accepts: [
					{
						scheme: "exact",
						network: NETWORK,
						payTo,
						price,
					},
				],
			};

			const encoded = btoa(JSON.stringify(paymentRequired));
			console.log("[402 Payment Required]", paymentRequired);
			return new Response(null, {
				status: 402,
				headers: {...corsHeaders, "PAYMENT-REQUIRED": encoded}
			});
		}

		// **阶段2**：收到 PAYMENT-SIGNATURE，向 facilitator 验证并结算交易
		console.log("[HAS PAYMENT-SIGNATURE]", paymentSignature);
		const requirements = [
			{scheme: "exact", price: `$${Number(amountStr).toFixed(2)}`, network: NETWORK, payTo}
		];
		const settlePayload = {paymentSignature, requirements};
		console.log("[SETTLE PAYLOAD]", settlePayload);

		// 配置请求头（如主网需要添加 JWT 授权）
		const headers: Record<string, string> = {"Content-Type": "application/json"};
		if (IS_MAINNET) {
			// 使用 CDP API 密钥生成 JWT，用于主网结算认证
			if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
				return new Response(JSON.stringify({error: "Missing credentials"}), {
					status: 500, headers: {...corsHeaders, "Content-Type": "application/json"}
				});
			}
			try {
				const secretPEM = env.CDP_API_KEY_SECRET.replace(/\\n/g, "\n");
				const privateKey = await jose.importPKCS8(secretPEM, "ES256");
				const jwt = await new jose.SignJWT({})
					.setProtectedHeader({alg: "ES256"})
					.setIssuer(env.CDP_API_KEY_ID)
					.setSubject(env.CDP_API_KEY_ID)
					.setIssuedAt()
					.setExpirationTime("2m")
					.sign(privateKey);
				headers["Authorization"] = `Bearer ${jwt}`;
			} catch (err) {
				console.error("[JWT ERROR]", err);
			}
		}

		// 调用 Facilitator 执行结算请求
		let facilitatorResp: Response;
		try {
			facilitatorResp = await fetch(FACILITATOR_URL, {
				method: "POST",
				headers,
				body: JSON.stringify(settlePayload)
			});
		} catch (err) {
			console.error("[FACILITATOR FETCH ERROR]", err);
			return new Response(JSON.stringify({error: "Facilitator request failed", detail: err}), {
				status: 502, headers: {...corsHeaders, "Content-Type": "application/json"}
			});
		}

		// 读取结算结果
		let result: X402SettleResponse;
		try {
			result = await facilitatorResp.json() as X402SettleResponse;
		} catch (err) {
			console.error("[SETTLEMENT PARSE ERROR]", err);
			return new Response(JSON.stringify({error: "Invalid facilitator response", detail: err}), {
				status: 502, headers: {...corsHeaders, "Content-Type": "application/json"}
			});
		}
		console.log("[FACILITATOR RESULT]", result);

		// 将结算结果编码返回给客户端，同时返回200内容（例如交易哈希等）
		const encodedResponse = btoa(JSON.stringify(result));
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: {
				...corsHeaders,
				"Content-Type": "application/json",
				"PAYMENT-RESPONSE": encodedResponse
			}
		});
	}
};

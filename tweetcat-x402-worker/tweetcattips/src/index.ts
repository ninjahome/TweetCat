import * as jose from 'jose';

export interface Env {
	CDP_API_KEY_ID?: string;
	CDP_API_KEY_SECRET?: string;
}

export interface X402SettleResponse {
	success: boolean;
	transactionHash?: string;
	transaction?: string;
	payer?: string;
	network?: string;
	errorReason?: string;
}

const IS_MAINNET = false;
const NETWORK = IS_MAINNET ? "eip155:8453" : "eip155:84532";

const FACILITATOR_URL = IS_MAINNET
	? "https://api.cdp.coinbase.com/platform/v2/x402/settle"
	: "https://x402.org/facilitator";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, X-Requested-With",
	"Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
};

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		// ----------- LOG: 入参 -----------
		console.log("[ENTRY] New request", {
			method: req.method,
			url: req.url,
			headers: Object.fromEntries(req.headers),
		});

		if (req.method === "OPTIONS") {
			console.log("[OPTIONS] CORS preflight");
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(req.url);
		const pathname = url.pathname;

		console.log("[REQUEST PATH]", pathname);

		// 仅支持 /tip
		if (pathname !== "/tip") {
			console.warn("[NOT FOUND] Unsupported path", { pathname });
			return new Response("Not Found", {
				status: 404,
				headers: corsHeaders,
			});
		}

		const payTo = url.searchParams.get("payTo");
		const amountStr = url.searchParams.get("amount");

		console.log("[PARSE PARAMS]", { payTo, amountStr });

		// 参数基础校验
		if (
			!payTo ||
			!/^0x[a-fA-F0-9]{40}$/.test(payTo) ||
			!amountStr ||
			isNaN(Number(amountStr))
		) {
			console.error("[INVALID PARAMS]", { payTo, amountStr });
			return new Response(
				JSON.stringify({ error: "Invalid parameters" }),
				{
					status: 400,
					headers: { ...corsHeaders, "Content-Type": "application/json" },
				}
			);
		}

		const amount = Number(amountStr);
		const paymentSignature = req.headers.get("PAYMENT-SIGNATURE");

		console.log("[PAYMENT SIGNATURE HEADER]", { paymentSignature });

		// 构造 x402 accepts
		const accepts = [
			{
				scheme: "exact",
				price: `$${amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`,
				network: NETWORK,
				payTo,
			},
		];

		console.log("[ACCEPTS ARRAY]", accepts);

		// ---- 阶段 1：尚未有 PAYMENT-SIGNATURE → 返回 402 ----
		if (!paymentSignature) {
			const encoded = btoa(JSON.stringify(accepts));
			console.log("[RETURN 402] No signature yet", {
				accepts,
				encodedPAYMENT: encoded,
			});
			return new Response(JSON.stringify({ error: "Payment Required" }), {
				status: 402,
				headers: {
					...corsHeaders,
					"Content-Type": "application/json",
					"PAYMENT-REQUIRED": encoded,
				},
			});
		}

		// ---- 阶段 2：有 PAYMENT-SIGNATURE → 发起 settlement ----
		console.log("[HAS PAYMENT SIG] Proceed to settle", {
			paymentSignature,
		});

		const settlePayload = {
			paymentSignature,
			requirements: accepts,
		};

		console.log("[SETTLE PAYLOAD]", settlePayload);

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// 主网需要 JWT auth
		if (IS_MAINNET) {
			if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
				console.error("[MISSING CREDENTIALS]", {
					CDP_API_KEY_ID: !!env.CDP_API_KEY_ID,
					CDP_API_KEY_SECRET: !!env.CDP_API_KEY_SECRET,
				});
				return new Response(
					JSON.stringify({ error: "Missing credentials" }),
					{
						status: 500,
						headers: { ...corsHeaders, "Content-Type": "application/json" },
					}
				);
			}
			try {
				const secretPEM = env.CDP_API_KEY_SECRET.replace(/\\n/g, "\n");
				const privateKey = await jose.importPKCS8(secretPEM, "ES256");
				const jwt = await new jose.SignJWT({})
					.setProtectedHeader({ alg: "ES256" })
					.setIssuer(env.CDP_API_KEY_ID)
					.setSubject(env.CDP_API_KEY_ID)
					.setIssuedAt()
					.setExpirationTime("2m")
					.sign(privateKey);

				headers["Authorization"] = `Bearer ${jwt}`;
				console.log("[JWT GENERATED]", { issuer: env.CDP_API_KEY_ID });
			} catch (err) {
				console.error("[JWT FAILURE]", err);
			}
		}

		// 发起实际结算请求
		let facilitatorResp: Response;
		try {
			facilitatorResp = await fetch(FACILITATOR_URL, {
				method: "POST",
				headers,
				body: JSON.stringify(settlePayload),
			});
			console.log("[FACILITATOR STATUS]", facilitatorResp.status);
		} catch (fetchErr) {
			console.error("[FACILITATOR FETCH ERROR]", fetchErr);
			return new Response(
				JSON.stringify({ error: "Facilitator request failed", detail: fetchErr }),
				{
					status: 502,
					headers: { ...corsHeaders, "Content-Type": "application/json" },
				}
			);
		}

		// 读取结果
		let result: X402SettleResponse;
		try {
			result = (await facilitatorResp.json()) as X402SettleResponse;
			console.log("[FACILITATOR RESULT]", result);
		} catch (parseErr) {
			console.error("[RESULT PARSE ERROR]", parseErr);
			return new Response(
				JSON.stringify({ error: "Invalid facilitator response", detail: parseErr }),
				{
					status: 502,
					headers: { ...corsHeaders, "Content-Type": "application/json" },
				}
			);
		}

		// Base64 encode the raw settlement response
		const encodedResponse = btoa(JSON.stringify(result));
		console.log("[RETURN 200 RESULT]", {
			result,
			encodedResponsePreview: encodedResponse.substring(0, 80) + "...",
		});

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: {
				...corsHeaders,
				"Content-Type": "application/json",
				"PAYMENT-RESPONSE": encodedResponse,
			},
		});
	},
};

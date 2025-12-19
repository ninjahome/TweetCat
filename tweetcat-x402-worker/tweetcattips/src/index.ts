export interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
}

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318F3dCF7e';
const FACILITATOR_SETTLE_URL =
	'https://facilitator.cdp.coinbase.com/v1/x402/settle';

// 添加 CORS 头部
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, PAYMENT-SIGNATURE',
};

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		// 处理 CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, {headers: corsHeaders});
		}
		const url = new URL(req.url);
		if (url.pathname !== '/tip') {
			return new Response('Not Found', {
				status: 404,
				headers: corsHeaders,
			});
		}

		const payTo = url.searchParams.get('payTo');
		const amount = url.searchParams.get('amount');

		if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
			return new Response('Invalid address', {
				status: 400,
				headers: corsHeaders,
			});
		}
		if (!amount || isNaN(Number(amount))) {
			return new Response('Invalid amount', {
				status: 400,
				headers: corsHeaders,
			});
		}

		const paymentSignature = req.headers.get('PAYMENT-SIGNATURE');

		/**
		 * ===============================
		 * 第一次请求：返回 402
		 * ===============================
		 */
		if (!paymentSignature) {
			const requirements = {
				x402Version: 2,
				accepts: [
					{
						scheme: 'exact',
						network: 'eip155:84532', // Base Sepolia
						asset: BASE_SEPOLIA_USDC,
						payTo,
						price: `$${Number(amount).toFixed(2)}`,
					},
				],
			};

			return new Response(
				JSON.stringify({error: 'Payment Required'}),
				{
					status: 402,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json',
						'PAYMENT-REQUIRED': btoa(JSON.stringify(requirements)),
					},
				},
			);
		}

		/**
		 * ===============================
		 * 第二次请求：调用 CDP settle
		 * ===============================
		 */
		const settlePayload = {
			paymentSignature,
			requirements: {
				x402Version: 2,
				accepts: [
					{
						scheme: 'exact',
						network: 'eip155:84532',
						asset: BASE_SEPOLIA_USDC,
						payTo,
						price: `$${Number(amount).toFixed(2)}`,
					},
				],
			},
		};

		const auth = btoa(
			`${env.CDP_API_KEY_ID}:${env.CDP_API_KEY_SECRET}`,
		);

		const resp = await fetch(FACILITATOR_SETTLE_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${auth}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(settlePayload),
		});

		if (!resp.ok) {
			const err = await resp.text();
			console.error('CDP settle failed:', err);
			return new Response(
				JSON.stringify({error: 'CDP settle failed', detail: err}),
				{
					status: 502,
					headers: {...corsHeaders, 'Content-Type': 'application/json'},
				},
			);
		}

		const result = await resp.json();

		return new Response(
			JSON.stringify({
				ok: true,
				network: 'base-sepolia',
				txHash: result.transactionHash,
				raw: result,
			}),
			{
				status: 200,
				headers: {...corsHeaders, 'Content-Type': 'application/json'},
			},
		);
	},
};

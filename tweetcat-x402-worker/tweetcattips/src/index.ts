import { Hono } from 'hono';
import { paymentMiddleware } from '@x402/hono';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm';

interface Env {
	CDP_API_KEY_ID: string;
	CDP_API_KEY_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.post('/tip', async (c) => {
	const amount = c.req.query('amount') || '5.00';
	const payTo = c.req.query('payTo');

	if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
		return c.text('Invalid address', 400);
	}

	// 在 handler 中初始化（访问 c.env）
	const facilitator = new HTTPFacilitatorClient({
		url: '[https://facilitator.cdp.coinbase.com](https://facilitator.cdp.coinbase.com)',
		// 这里需要实现 JWT 认证逻辑
	});

	const server = new x402ResourceServer(facilitator)
		.register('eip155:8453', new ExactEvmScheme());

	const middleware = paymentMiddleware({
		'POST /tip': {
			accepts: [{
				scheme: 'exact',
				network: 'eip155:8453',
				asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
				price: `$${parseFloat(amount).toFixed(2)}`,
				payTo: payTo,
			}]
		}
	}, server);

	await middleware(c, async () => {
		const receipt = c.get('x402Receipt');
		return c.json({ success: true, txHash: receipt.transaction });
	});
});

export default app;

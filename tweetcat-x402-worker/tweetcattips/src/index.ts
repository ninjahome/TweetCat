import { Hono } from "hono";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import {
	applyCors,
	createTipHandler,
	getX402AuthHeader,
	normalizeMultilineSecret,
	registerUserInfoRoute,
	type Env,
	type NetConfig,
} from "./common";

const app = new Hono<{ Bindings: Env }>();

applyCors(app);

/** ✅ 主网固定配置（不再用 isMainnet 分支） */
const MAINNET_CFG: NetConfig = {
	NETWORK: "eip155:8453",
	FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
	USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	USDC_EIP712_NAME: "USD Coin",
	USDC_EIP712_VERSION: "2",
};

const evmScheme = new ExactEvmScheme();

/** isolate 内缓存（同一实例可跨请求复用） */
let cachedMainnetResourceServer: any | null = null;

function getMainnetResourceServer(env: Env) {
	if (cachedMainnetResourceServer) return cachedMainnetResourceServer;

	// 只把需要的字符串取出来，避免把整个 env 捕获进闭包
	const apiKeyId = env.CDP_API_KEY_ID;
	const apiKeySecret = normalizeMultilineSecret(env.CDP_API_KEY_SECRET);

	const client = new HTTPFacilitatorClient({
		url: MAINNET_CFG.FACILITATOR_URL,
		createAuthHeaders: async () => {
			const [supported, verify, settle] = await Promise.all([
				getX402AuthHeader({ apiKeyId, apiKeySecret, method: "GET", endpoint: "/supported" }),
				getX402AuthHeader({ apiKeyId, apiKeySecret, method: "POST", endpoint: "/verify" }),
				getX402AuthHeader({ apiKeyId, apiKeySecret, method: "POST", endpoint: "/settle" }),
			]);
			return { supported, verify, settle };
		},
	});

	cachedMainnetResourceServer = new x402ResourceServer(client).register("eip155:*", evmScheme);
	return cachedMainnetResourceServer;
}

/** ✅ 主网：只挂 /tip */
app.get(
	"/tip",
	createTipHandler({
		cfg: MAINNET_CFG,
		getResourceServer: getMainnetResourceServer,
	})
);

/** 两端通用：/user-info */
registerUserInfoRoute(app);

/** 可选：健康检查 */
app.get("/health", (c) => c.json({ ok: true, env: "mainnet" }));

export default app;

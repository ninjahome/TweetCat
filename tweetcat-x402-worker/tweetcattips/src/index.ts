import {Hono} from "hono";
import {HTTPFacilitatorClient, x402ResourceServer} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";

import {
	applyCors,
	ExtendedEnv,
	getX402AuthHeader,
	normalizeMultilineSecret,
	type Env,
	type NetConfig,
} from "./common";
import {
	handleTip,
	handleUsdcTransfer,
	handleAutoClaim,
	registerUserInfoRoute,
	registerValidateTokenRoute
} from "./api_srv";

const app = new Hono<ExtendedEnv>();

applyCors(app);

const MAINNET_CFG: NetConfig = {
	NETWORK: "eip155:8453",
	FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
	USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	USDC_EIP712_NAME: "USD Coin",
	USDC_EIP712_VERSION: "2",
};

const evmScheme = new ExactEvmScheme();
let cachedMainnetResourceServer: any | null = null;

function getMainnetResourceServer(env: Env) {
	if (cachedMainnetResourceServer) return cachedMainnetResourceServer;

	const apiKeyId = env.CDP_API_KEY_ID;
	const apiKeySecret = normalizeMultilineSecret(env.CDP_API_KEY_SECRET);

	const client = new HTTPFacilitatorClient({
		url: MAINNET_CFG.FACILITATOR_URL,
		createAuthHeaders: async () => {
			const [supported, verify, settle] = await Promise.all([
				getX402AuthHeader({apiKeyId, apiKeySecret, method: "GET", endpoint: "/supported"}),
				getX402AuthHeader({apiKeyId, apiKeySecret, method: "POST", endpoint: "/verify"}),
				getX402AuthHeader({apiKeyId, apiKeySecret, method: "POST", endpoint: "/settle"}),
			]);
			return {supported, verify, settle};
		},
	});

	cachedMainnetResourceServer = new x402ResourceServer(client).register("eip155:*", evmScheme);
	return cachedMainnetResourceServer;
}

// ============================================
// 依赖注入中间件（方案 4）
// 为所有路由注入 cfg 和 getResourceServer
// ============================================
app.use("*", async (c, next) => {
	c.set("cfg", MAINNET_CFG);
	c.set("getResourceServer", getMainnetResourceServer);
	await next();
});

// ============================================
// 注册路由 - 现在非常简洁！
// ============================================
app.post("/tip", handleTip);
app.post("/usdc-transfer", handleUsdcTransfer);
app.post("/auto-claim", handleAutoClaim);

// 注册不需要依赖注入的路由
registerUserInfoRoute(app);
registerValidateTokenRoute(app);

app.get("/health", (c) => c.json({ok: true, env: "mainnet"}));

export default app;

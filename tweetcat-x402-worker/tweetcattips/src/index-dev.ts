import {Hono} from "hono";
import {HTTPFacilitatorClient, x402ResourceServer} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";

import {
	applyCors,
	ExtendedEnv,
	type Env,
	type NetConfig,
} from "./common";
import {
	registerUserInfoRoute,
	handleTip,
	handleUsdcTransfer,
	handleAutoClaim,
	registerValidateTokenRoute
} from "./api_srv";

const app = new Hono<ExtendedEnv>();

applyCors(app);

const TESTNET_CFG: NetConfig = {
	NETWORK: "eip155:84532",
	FACILITATOR_URL: "https://x402.org/facilitator",
	USDC: "0x036CbD53842c5426634e7929541eC2318F3dCF7e",
	USDC_EIP712_NAME: "USDC",
	USDC_EIP712_VERSION: "2",
};

const evmScheme = new ExactEvmScheme();
let cachedTestnetResourceServer: any | null = null;
function getTestnetResourceServer(_env: Env) {
	if (cachedTestnetResourceServer) return cachedTestnetResourceServer;

	const client = new HTTPFacilitatorClient({
		url: TESTNET_CFG.FACILITATOR_URL,
	});

	cachedTestnetResourceServer = new x402ResourceServer(client).register("eip155:*", evmScheme);
	return cachedTestnetResourceServer;
}

// ============================================
// 依赖注入中间件（方案 4）
// 为所有路由注入 cfg 和 getResourceServer
// ============================================
app.use("*", async (c, next) => {
	c.set("cfg", TESTNET_CFG);
	c.set("getResourceServer", getTestnetResourceServer);
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

app.get("/health", (c) => c.json({ok: true, env: "testnet"}));

export default app;

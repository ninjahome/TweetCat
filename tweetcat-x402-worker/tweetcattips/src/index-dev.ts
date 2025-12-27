import { Hono } from "hono";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import {
	applyCors,
	createTipHandler,
	registerUserInfoRoute,
	type Env,
	type NetConfig,
} from "./common";

const app = new Hono<{ Bindings: Env }>();

applyCors(app);

/** ✅ 测试网固定配置（不再用 isMainnet 分支） */
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

	// ✅ 测试网 facilitator 不需要 createAuthHeaders
	const client = new HTTPFacilitatorClient({
		url: TESTNET_CFG.FACILITATOR_URL,
	});

	cachedTestnetResourceServer = new x402ResourceServer(client).register("eip155:*", evmScheme);
	return cachedTestnetResourceServer;
}

/** ✅ 测试网：只挂 /tip */
app.get(
	"/tip",
	createTipHandler({
		cfg: TESTNET_CFG,
		getResourceServer: getTestnetResourceServer,
	})
);

/** 两端通用：/user-info */
registerUserInfoRoute(app);

/** 可选：健康检查 */
app.get("/health", (c) => c.json({ ok: true, env: "testnet" }));

export default app;

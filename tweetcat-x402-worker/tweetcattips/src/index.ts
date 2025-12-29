import {Hono} from "hono";
import {HTTPFacilitatorClient, x402ResourceServer} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";

import {
	applyCors,
	getX402AuthHeader,
	normalizeMultilineSecret,
	type Env,
	type NetConfig,
} from "./common";
import {createTipHandler, createUsdcTransferHandler, handleAutoClaim, registerUserInfoRoute, registerValidateTokenRoute} from "./api_srv";

const app = new Hono<{ Bindings: Env }>();

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

app.post("/tip", createTipHandler({cfg: MAINNET_CFG, getResourceServer: getMainnetResourceServer}));

registerUserInfoRoute(app);
registerValidateTokenRoute(app);

app.get("/health", (c) => c.json({ok: true, env: "mainnet"}));

app.post("/usdc-transfer", createUsdcTransferHandler({cfg: MAINNET_CFG, getResourceServer: getMainnetResourceServer}));

app.post("/auto-claim", (c) => handleAutoClaim(c, MAINNET_CFG, getMainnetResourceServer));

export default app;

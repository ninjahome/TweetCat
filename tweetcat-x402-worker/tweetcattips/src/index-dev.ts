import {Hono} from "hono";
import {HTTPFacilitatorClient, x402ResourceServer} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";

import {
	applyCors,
	type Env,
	type NetConfig,
} from "./common";
import {registerUserInfoRoute, createTipHandler, createUsdcTransferHandler, handleAutoClaim} from "./api_srv";

const app = new Hono<{ Bindings: Env }>();

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

app.post("/tip", createTipHandler({cfg: TESTNET_CFG, getResourceServer: getTestnetResourceServer}));

registerUserInfoRoute(app);

app.get("/health", (c) => c.json({ok: true, env: "testnet"}));

app.post("/usdc-transfer", createUsdcTransferHandler({cfg: TESTNET_CFG, getResourceServer: getTestnetResourceServer}));

app.post("/auto-claim", (c) => handleAutoClaim(c, TESTNET_CFG, getTestnetResourceServer));

export default app;

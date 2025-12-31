import {HTTPFacilitatorClient, x402ResourceServer} from "@x402/core/server";
import {ExactEvmScheme} from "@x402/evm/exact/server";

import {
	type Env,
	type NetConfig, app,
} from "./common";
import {registerSrv} from "./api_srv";

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

app.use("*", async (c, next) => {
	c.set("cfg", TESTNET_CFG);
	c.set("getResourceServer", getTestnetResourceServer);
	await next();
});

app.get("/health", (c) => c.json({ok: true, env: "testnet"}));

registerSrv(app)

export default app;

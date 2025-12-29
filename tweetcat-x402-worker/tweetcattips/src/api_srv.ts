import {Hono} from "hono";
import {ExtendedEnv} from "./common";
import {handleAutoClaim, handleTip, handleUsdcTransfer} from "./api_srv_x402";
import {registerUserInfoRoute, registerValidateTokenRoute} from "./api_srv_usr";

export  function registerSrv(app:Hono<ExtendedEnv>){
	app.post("/tip", handleTip);
	app.post("/usdc-transfer", handleUsdcTransfer);
	app.post("/auto-claim", handleAutoClaim);

	registerUserInfoRoute(app);
	registerValidateTokenRoute(app);
}

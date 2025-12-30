import {Hono} from "hono";
import {ExtendedEnv} from "./common";
import {adminClaimForUsr, apiHandleTip, apiX402UsdcTransfer} from "./api_srv_x402";
import {
	testQueryUserDetails, apiValidateUser,
	apiQueryValidRewards, apiClaimReward,
	apiQueryRewardHistory
} from "./api_srv_usr";

export function registerSrv(app: Hono<ExtendedEnv>) {
	app.post("/tip", apiHandleTip);
	app.post("/usdc-transfer", apiX402UsdcTransfer);
	app.post("/auto-claim", adminClaimForUsr);
	app.get("/user-info", testQueryUserDetails);
	app.post("/validate-token", apiValidateUser);
	app.get("/rewards/query_valid", apiQueryValidRewards);
	app.post("/rewards/claim_item", apiClaimReward)
	app.get("/rewards/query_history", apiQueryRewardHistory)
}

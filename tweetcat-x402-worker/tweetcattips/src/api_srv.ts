import {Hono} from "hono";
import {ExtendedEnv} from "./common";
import {apiHandleTip, apiTransferByTid, apiX402UsdcTransfer} from "./api_srv_x402";
import {
	testQueryUserDetails, apiValidateUser,
	apiQueryValidRewards, apiClaimReward,
	apiQueryRewardHistory, apiQueryPlatformFees,
	apiCreateOnrampSession, apiOnrampWebhook
} from "./api_srv_usr";
import {apiAdsBalance, apiAdsCreate, apiAdsMyAds, apiAdsList, apiAdsClaim, apiAdsMyClaims} from "./api_srv_ads";

export function registerSrv(app: Hono<ExtendedEnv>) {
	// X402 相关 API
	app.post("/tip", apiHandleTip);
	app.post("/usdc-transfer", apiX402UsdcTransfer);

	// 用户相关 API
	app.get("/user-info", testQueryUserDetails);
	app.post("/validate-token", apiValidateUser);

	// 奖励相关 API
	app.get("/rewards/query_valid", apiQueryValidRewards);
	app.post("/rewards/claim_item", apiClaimReward);
	app.get("/rewards/query_history", apiQueryRewardHistory);

	// 费用相关 API
	app.get("/fees/query_history", apiQueryPlatformFees);

	// 转账相关 API
	app.post("/user/transfer_by_twitter", apiTransferByTid);

	// 链上交易相关 API
	app.post("/onramp/create_session", apiCreateOnrampSession);
	app.post("/onramp/webhook", apiOnrampWebhook);

	// 广告相关 API
	app.get("/ads/balance", apiAdsBalance);
	app.post("/ads/create", apiAdsCreate);
	app.get("/ads/my_ads", apiAdsMyAds);
	app.get("/ads/list", apiAdsList);
	app.post("/ads/claim", apiAdsClaim);
	app.get("/ads/my_claims", apiAdsMyClaims);
}

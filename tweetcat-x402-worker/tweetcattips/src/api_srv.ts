import {Hono} from "hono";
import {
	ExtendedEnv,
	API_PATH_TIP,
	API_PATH_USDC_TRANSFER,
	API_PATH_USER_INFO,
	API_PATH_VALIDATE_TOKEN,
	API_PATH_REWARDS_QUERY_VALID,
	API_PATH_REWARDS_CLAIM_ITEM,
	API_PATH_REWARDS_QUERY_HISTORY,
	API_PATH_FEES_QUERY_HISTORY,
	API_PATH_USER_TRANSFER_BY_TWITTER,
	API_PATH_ONRAMP_CREATE_SESSION,
	API_PATH_ONRAMP_WEBHOOK
} from "./common";
import {apiHandleTip, apiTransferByTid, apiX402UsdcTransfer} from "./api_srv_x402";
import {
	testQueryUserDetails, apiValidateUser,
	apiQueryValidRewards, apiClaimReward,
	apiQueryRewardHistory, apiQueryPlatformFees,
	apiCreateOnrampSession, apiOnrampWebhook
} from "./api_srv_usr";
import {registerAdsRoutes} from "./api_srv_ads";

export function registerSrv(app: Hono<ExtendedEnv>) {
	// X402 相关 API
	app.post(API_PATH_TIP, apiHandleTip);
	app.post(API_PATH_USDC_TRANSFER, apiX402UsdcTransfer);

	// 用户相关 API
	app.get(API_PATH_USER_INFO, testQueryUserDetails);
	app.post(API_PATH_VALIDATE_TOKEN, apiValidateUser);

	// 奖励相关 API
	app.get(API_PATH_REWARDS_QUERY_VALID, apiQueryValidRewards);
	app.post(API_PATH_REWARDS_CLAIM_ITEM, apiClaimReward);
	app.get(API_PATH_REWARDS_QUERY_HISTORY, apiQueryRewardHistory);

	// 费用相关 API
	app.get(API_PATH_FEES_QUERY_HISTORY, apiQueryPlatformFees);

	// 转账相关 API
	app.post(API_PATH_USER_TRANSFER_BY_TWITTER, apiTransferByTid);

	// 链上交易相关 API
	app.post(API_PATH_ONRAMP_CREATE_SESSION, apiCreateOnrampSession);
	app.post(API_PATH_ONRAMP_WEBHOOK, apiOnrampWebhook);

	// 广告相关 API
	registerAdsRoutes(app);
}

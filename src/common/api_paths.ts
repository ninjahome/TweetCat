/**
 * TweetCat API 路径统一定义
 * 这里的命名和路径请与后端 (tweetcat-x402-worker) 保持严格同步
 */

// --- 核心业务 API ---
export const API_PATH_TIP = "/tip";
export const API_PATH_USDC_TRANSFER = "/usdc-transfer";
export const API_PATH_USER_INFO = "/user-info";
export const API_PATH_VALIDATE_TOKEN = "/validate-token";
export const API_PATH_REWARDS_QUERY_VALID = "/rewards/query_valid";
export const API_PATH_REWARDS_CLAIM_ITEM = "/rewards/claim_item";
export const API_PATH_REWARDS_QUERY_HISTORY = "/rewards/query_history";
export const API_PATH_FEES_QUERY_HISTORY = "/fees/query_history";
export const API_PATH_USER_TRANSFER_BY_TWITTER = "/user/transfer_by_twitter";
export const API_PATH_ONRAMP_CREATE_SESSION = "/onramp/create_session";
export const API_PATH_ONRAMP_WEBHOOK = "/onramp/webhook";

// --- 广告系统 API ---
export const API_PATH_ADS_BALANCE = "/ads/executor/balance";
export const API_PATH_ADS_CREATE = "/ads/publisher/create";
export const API_PATH_ADS_UPDATE = "/ads/publisher/update";
export const API_PATH_ADS_MY_ADS = "/ads/publisher/my_ads";
export const API_PATH_ADS_LIST = "/ads/executor/list";
export const API_PATH_ADS_VERSION = "/ads/executor/version";
export const API_PATH_ADS_CLAIM = "/ads/executor/claim";
export const API_PATH_ADS_MY_CLAIMS = "/ads/executor/my_claims";
export const API_PATH_ADS_SUBMIT_PROOF = "/ads/executor/submit_proof";
export const API_PATH_ADS_PUBLISHER_RECHARGE = "/ads/publisher/recharge";
export const API_PATH_ADS_PUBLISHER_WITHDRAW = "/ads/publisher/withdraw";
export const API_PATH_ADS_PUBLISHER_LEDGER = "/ads/publisher/ledger";
export const API_PATH_ADS_TOGGLE_STATUS = "/ads/publisher/toggle_status";
export const API_PATH_ADS_TOP_UP_BUDGET = "/ads/publisher/top_up_budget";
export const API_PATH_ADS_PUBLISHER_DASHBOARD_INFO = "/ads/publisher/dashboard_info";
export const API_PATH_ADS_PUBLISHER_SPEND_HISTORY = "/ads/publisher/spend_history";
export const API_PATH_ADS_PUBLISHER_AD_CLAIMS = "/ads/publisher/ad_claims";

export const API_PATH_ADS_EXECUTOR_DASHBOARD_INFO = "/ads/executor/dashboard_info";
export const API_PATH_ADS_EXECUTOR_WITHDRAW = "/ads/executor/withdraw";

/**
 * 需要执行设备私钥签名的操作 (X-Device-Signature V2)
 */
export const signedOperationPaths: string[] = [
    API_PATH_ADS_CREATE,
    API_PATH_ADS_UPDATE,
    API_PATH_ADS_CLAIM,
    API_PATH_ADS_PUBLISHER_WITHDRAW,
    API_PATH_ADS_EXECUTOR_WITHDRAW
];

import {Hono} from "hono";
import {verifyMessage} from 'viem';
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
	API_PATH_ONRAMP_WEBHOOK,
	signedOperationPaths,
	jsonError
} from "./common";
import {apiHandleTip, apiTransferByTid, apiX402UsdcTransfer} from "./api_srv_x402";
import {
	testQueryUserDetails, apiValidateUser,
	apiQueryValidRewards, apiClaimReward,
	apiQueryRewardHistory, apiQueryPlatformFees,
	apiCreateOnrampSession, apiOnrampWebhook
} from "./api_srv_usr";
import {registerAdsRoutes} from "./api_srv_ads";
import {getKolBindingByUserId} from "./database_402";

const SIGNATURE_TIME_THRESHOLD = 5 * 60 * 1000; // 5 minutes

export async function verifySignatureMiddleware(c: any, next: any) {
	if (c.req.method !== 'POST') {
		return await next();
	}

	const url = new URL(c.req.url);
	if (!signedOperationPaths.includes(url.pathname)) {
		return await next();
	}

	let body;
	try {
		body = await c.req.json();
	} catch (e) {
		return jsonError(c, 400, "INVALID_JSON", "Invalid JSON body");
	}

	const {signature, x402TimeStamp, userId} = body;

	if (!signature || !x402TimeStamp || !userId) {
		return jsonError(c, 400, "MISSING_SIGNATURE_FIELDS", "Missing signature, x402TimeStamp, or userId");
	}

	const now = Date.now();
	if (now - x402TimeStamp > SIGNATURE_TIME_THRESHOLD || now - x402TimeStamp < -60000) { // Allow 1 min future drift
		return jsonError(c, 400, "INVALID_TIMESTAMP", "Request timestamp expired or invalid");
	}

	const kolBinding = await getKolBindingByUserId(c.env.DB, userId);
	if (!kolBinding || !kolBinding.wallet_address) {
		return jsonError(c, 400, "WALLET_NOT_FOUND", "No linked wallet address found for this user");
	}

	// Reconstruct the message that was signed.
	// We remove the signature from the body to get the original payload.
	const {signature: sigToRemove, ...payload} = body;
	const messageToVerify = JSON.stringify(payload);

	try {
		const valid = await verifyMessage({
			address: kolBinding.wallet_address as `0x${string}`,
			message: messageToVerify,
			signature: signature as `0x${string}`,
		});

		if (!valid) {
			return jsonError(c, 401, "INVALID_SIGNATURE", "Signature verification failed");
		}
	} catch (err) {
		console.error("Signature verification error:", err);
		return jsonError(c, 401, "INVALID_SIGNATURE", "Signature verification error");
	}

	console.log("signed message verified success!", kolBinding.wallet_address)
	await next();
}

export function registerSrv(app: Hono<ExtendedEnv>) {
	// Apply signature verification middleware
	app.use('*', verifySignatureMiddleware);

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

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

function base64ToArrayBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

export async function verifySignatureMiddleware(c: any, next: any) {
	if (c.req.method !== 'POST') {
		return await next();
	}

	const url = new URL(c.req.url);
	if (!signedOperationPaths.includes(url.pathname)) {
		return await next();
	}

	const signatureB64 =
		c.req.header("X-Device-Signature") ||
		c.req.header("x-device-signature") ||
		c.req.header("X-DEVICE-SIGNATURE");
	const timestampStr =
		c.req.header("X-Device-Timestamp") ||
		c.req.header("x-device-timestamp") ||
		c.req.header("X-DEVICE-TIMESTAMP");

	if (!signatureB64 || !timestampStr) {
		console.warn("[device-sign] missing headers", {path: url.pathname, hasSig: !!signatureB64, hasTs: !!timestampStr});
		return jsonError(c, 400, "MISSING_DEVICE_SIGNATURE", "Missing X-Device-Signature or X-Device-Timestamp");
	}

	const ts = Number(timestampStr);
	if (!Number.isFinite(ts) || ts <= 0) {
		console.warn("[device-sign] invalid timestamp", {path: url.pathname, timestampStr});
		return jsonError(c, 400, "INVALID_TIMESTAMP", "Invalid X-Device-Timestamp");
	}

	let bodyText = "";
	let body: any = {};
	try {
		const clone = c.req.raw.clone();
		bodyText = await clone.text();
		body = bodyText ? JSON.parse(bodyText) : {};
	} catch (e) {
		console.warn("[device-sign] invalid json body", {path: url.pathname});
		return jsonError(c, 400, "INVALID_JSON", "Invalid JSON body");
	}

	const userId = body?.userId;
	if (!userId) {
		console.warn("[device-sign] missing userId", {path: url.pathname});
		return jsonError(c, 400, "MISSING_USER_ID", "Missing userId");
	}

	const now = Date.now();
	if (now - ts > SIGNATURE_TIME_THRESHOLD || now - ts < -60000) { // Allow 1 min future drift
		console.warn("[device-sign] expired timestamp", {path: url.pathname, userId, ts, now});
		return jsonError(c, 400, "INVALID_TIMESTAMP", "Request timestamp expired or invalid");
	}

	const kolBinding = await getKolBindingByUserId(c.env.DB, userId);
	if (!kolBinding) {
		console.warn("[device-sign] user not found", {path: url.pathname, userId});
		return jsonError(c, 400, "USER_NOT_FOUND", "No linked user found for this userId");
	}
	if (!kolBinding.device_pubkey_spki) {
		console.warn("[device-sign] device key not found", {path: url.pathname, userId});
		return jsonError(c, 400, "DEVICE_KEY_NOT_FOUND", "No linked device key found for this user");
	}

	const dataToSign = `${c.req.method.toUpperCase()}\n${url.pathname}\n${timestampStr}\n${bodyText}`;
	const data = new TextEncoder().encode(dataToSign);

	try {
		const publicKey = await crypto.subtle.importKey(
			"spki",
			base64ToArrayBuffer(kolBinding.device_pubkey_spki),
			{name: "ECDSA", namedCurve: "P-256"},
			false,
			["verify"]
		);

		const valid = await crypto.subtle.verify(
			{name: "ECDSA", hash: "SHA-256"},
			publicKey,
			base64ToArrayBuffer(signatureB64),
			data
		);

		if (!valid) {
			console.warn("[device-sign] invalid signature", {
				path: url.pathname,
				userId,
				sigLen: signatureB64.length,
				bodyLen: bodyText.length
			});
			return jsonError(c, 401, "INVALID_SIGNATURE", "Signature verification failed");
		}
	} catch (err) {
		console.error("Signature verification error:", err);
		return jsonError(c, 401, "INVALID_SIGNATURE", "Signature verification error");
	}

	console.log("device signature verified success!", kolBinding.cdp_user_id)
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

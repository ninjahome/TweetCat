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
	canonicalHtu,
	decodeB64OrB64UrlToArrayBuffer,
	jsonError,
	sha256Base64Url,
	spkiB64ToJktB64Url,
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
import {insertReplayGuardOrError} from "./database_replay_guard";

const SIGNATURE_TIME_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const REPLAY_TTL_SECONDS = 300;
const IAT_PAST_WINDOW_SECONDS = 300;
const IAT_FUTURE_SKEW_SECONDS = 60;

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
	const sigVersion =
		c.req.header("X-Device-Signature-Version") ||
		c.req.header("x-device-signature-version") ||
		c.req.header("X-DEVICE-SIGNATURE-VERSION") ||
		"v1";

	if (!signatureB64) {
		console.warn("[device-sign] missing signature header", {path: url.pathname});
		return jsonError(c, 400, "MISSING_DEVICE_SIGNATURE", "Missing X-Device-Signature");
	}

	let bodyText = "";
	let bodyBytes = new Uint8Array();
	let body: any = {};
	try {
		const clone = c.req.raw.clone();
		const ab = await clone.arrayBuffer();
		bodyBytes = new Uint8Array(ab);
		bodyText = new TextDecoder().decode(bodyBytes);
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

	const kolBinding = await getKolBindingByUserId(c.env.DB, userId);
	if (!kolBinding) {
		console.warn("[device-sign] user not found", {path: url.pathname, userId});
		return jsonError(c, 400, "USER_NOT_FOUND", "No linked user found for this userId");
	}
	if (!kolBinding.device_pubkey_spki) {
		console.warn("[device-sign] device key not found", {path: url.pathname, userId});
		return jsonError(c, 400, "DEVICE_KEY_NOT_FOUND", "No linked device key found for this user");
	}

	if (sigVersion === "v2") {
		const iatStr =
			c.req.header("X-Device-IAT") ||
			c.req.header("x-device-iat") ||
			c.req.header("X-DEVICE-IAT");
		const jti =
			c.req.header("X-Device-JTI") ||
			c.req.header("x-device-jti") ||
			c.req.header("X-DEVICE-JTI");
		const bodyShaHeader =
			c.req.header("X-Body-SHA256") ||
			c.req.header("x-body-sha256") ||
			c.req.header("X-BODY-SHA256");

		if (!iatStr || !jti || !bodyShaHeader) {
			console.warn("[device-sign:v2] missing headers", {path: url.pathname, hasIat: !!iatStr, hasJti: !!jti, hasBodySha: !!bodyShaHeader});
			return jsonError(c, 400, "MISSING_DEVICE_SIGNATURE_FIELDS", "Missing X-Device-IAT, X-Device-JTI, or X-Body-SHA256");
		}

		const iat = Number(iatStr);
		if (!Number.isFinite(iat) || iat <= 0) {
			console.warn("[device-sign:v2] invalid iat", {path: url.pathname, iatStr});
			return jsonError(c, 400, "INVALID_IAT", "Invalid X-Device-IAT");
		}

		const nowSec = Math.floor(Date.now() / 1000);
		if (iat < nowSec - IAT_PAST_WINDOW_SECONDS || iat > nowSec + IAT_FUTURE_SKEW_SECONDS) {
			console.warn("[device-sign:v2] iat out of window", {path: url.pathname, userId, iat, nowSec});
			return jsonError(c, 400, "INVALID_IAT", "IAT out of allowed window");
		}

		const computedBodySha = await sha256Base64Url(bodyBytes);
		if (computedBodySha !== bodyShaHeader) {
			console.warn("[device-sign:v2] body hash mismatch", {path: url.pathname, userId, computedPrefix: computedBodySha.slice(0, 12), headerPrefix: bodyShaHeader.slice(0, 12)});
			return jsonError(c, 401, "BODY_HASH_MISMATCH", "Body hash mismatch");
		}

		const htu = canonicalHtu(c.req.url);
		const signingInput = `${c.req.method.toUpperCase()}\n${htu}\n${iat}\n${jti}\n${bodyShaHeader}`;
		const data = new TextEncoder().encode(signingInput);

		const spkiBytes = new Uint8Array(decodeB64OrB64UrlToArrayBuffer(kolBinding.device_pubkey_spki));

		try {
			const publicKey = await crypto.subtle.importKey(
				"spki",
				spkiBytes,
				{name: "ECDSA", namedCurve: "P-256"},
				false,
				["verify"]
			);

			const valid = await crypto.subtle.verify(
				{name: "ECDSA", hash: "SHA-256"},
				publicKey,
				decodeB64OrB64UrlToArrayBuffer(signatureB64),
				data
			);

			if (!valid) {
				console.warn("[device-sign:v2] invalid signature", {path: url.pathname, userId, jtiPrefix: String(jti).slice(0, 10)});
				return jsonError(c, 401, "INVALID_SIGNATURE", "Signature verification failed");
			}

			// Replay guard (only after signature + iat checks)
			const expiresAt = nowSec + REPLAY_TTL_SECONDS;
			const jkt = await spkiB64ToJktB64Url(kolBinding.device_pubkey_spki);
			const replayRes = await insertReplayGuardOrError(c.env.DB, {jkt, jti, iat, expiresAt});
			if (!replayRes.ok) return jsonError(c, replayRes.status, replayRes.code, replayRes.detail);

		} catch (err) {
			console.error("Signature verification error:", err);
			return jsonError(c, 401, "INVALID_SIGNATURE", "Signature verification error");
		}

		console.log("device signature verified (v2) success!", kolBinding.cdp_user_id)
		await next();
		return;
	}

	// v1 fallback (legacy)
	const timestampStr =
		c.req.header("X-Device-Timestamp") ||
		c.req.header("x-device-timestamp") ||
		c.req.header("X-DEVICE-TIMESTAMP");

	if (!timestampStr) {
		console.warn("[device-sign:v1] missing timestamp header", {path: url.pathname});
		return jsonError(c, 400, "MISSING_DEVICE_SIGNATURE", "Missing X-Device-Timestamp");
	}

	const ts = Number(timestampStr);
	if (!Number.isFinite(ts) || ts <= 0) {
		console.warn("[device-sign:v1] invalid timestamp", {path: url.pathname, timestampStr});
		return jsonError(c, 400, "INVALID_TIMESTAMP", "Invalid X-Device-Timestamp");
	}

	const now = Date.now();
	if (now - ts > SIGNATURE_TIME_THRESHOLD || now - ts < -60000) { // Allow 1 min future drift
		console.warn("[device-sign:v1] expired timestamp", {path: url.pathname, userId, ts, now});
		return jsonError(c, 400, "INVALID_TIMESTAMP", "Request timestamp expired or invalid");
	}

	const dataToSign = `${c.req.method.toUpperCase()}\n${url.pathname}\n${timestampStr}\n${bodyText}`;
	const data = new TextEncoder().encode(dataToSign);

	try {
		const publicKey = await crypto.subtle.importKey(
			"spki",
			decodeB64OrB64UrlToArrayBuffer(kolBinding.device_pubkey_spki),
			{name: "ECDSA", namedCurve: "P-256"},
			false,
			["verify"]
		);

		const valid = await crypto.subtle.verify(
			{name: "ECDSA", hash: "SHA-256"},
			publicKey,
			decodeB64OrB64UrlToArrayBuffer(signatureB64),
			data
		);

		if (!valid) {
			console.warn("[device-sign:v1] invalid signature", {
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

	console.log("device signature verified (v1) success!", kolBinding.cdp_user_id)
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

import {Hono} from "hono";
import {cdpFetch, ExtendedEnv, ExtCtx} from "./common";
import {
	createKolBinding,
	getKolBindingByUserId,
	updateUserSigninTime,
	ValidatedUserInfo,
	queryValidRewards,
	queryRewardHistory,
	lockAndGetReward,
	updateRewardStatus,
	REWARD_STATUS_SUCCESS,
	REWARD_STATUS_FAILED
} from "./database";
import {internalTreasurySettle} from "./api_srv_x402";

export async function testQueryUserDetails(c: ExtCtx) {
	try {
		const userId = c.req.query("userId"); // x:12345 或 uuid
		if (!userId) return c.json({error: "Missing userId"}, 400);

		const path = `/platform/v2/end-users/${userId}`;
		const userData = await cdpFetch(c, path, "GET")
		return c.json(userData);

	} catch (err: any) {
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
}

function parseXAuthEndUserSnapshot(validationResult: any): ValidatedUserInfo {
	const authMethods = validationResult.authenticationMethods || [];
	const xAuth = authMethods.find((m: any) => m.type === "x");
	if (!xAuth) {
		throw new Error("Only X/Twitter authentication is supported")
	}

	const evmAccounts = validationResult.evmAccountObjects || [];
	if (evmAccounts.length === 0) {
		throw new Error("No EVM account found")
	}

	return {
		userId: validationResult.userId,
		walletAddress: evmAccounts[0].address,
		walletCreatedAt: evmAccounts[0].createdAt,
		email: xAuth.email || "",
		xSub: xAuth.sub,
		username: xAuth.username
	}
}

export async function apiValidateUser(c: ExtCtx) {

	const body = await c.req.json().catch(() => ({}));
	const accessToken = body?.accessToken;
	if (!accessToken) {
		return c.json({error: "Missing accessToken"}, 400);
	}

	const path = `/platform/v2/end-users/auth/validate-token`;
	try {
		const validationResult = await cdpFetch(c, path, "POST", {accessToken: accessToken})
		if (!!validationResult?.error) {
			return c.json(validationResult)
		}

		const userInfo = parseXAuthEndUserSnapshot(validationResult)

		const existingUser = await getKolBindingByUserId(c.env.DB, userInfo.userId);
		if (existingUser) {
			await updateUserSigninTime(c.env.DB, userInfo.xSub);
			return c.json({success: true, isNewUser: false});
		}

		await createKolBinding(c.env.DB, userInfo);

		return c.json({success: true, isNewUser: true});
	} catch (err: any) {
		console.error("[Validate Token Error]", err);
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
}

/**
 * 接口 1: 查询待领取的奖励
 * GET /rewards/query_valid?cdp_user_id=xxx
 */
export async function apiQueryValidRewards(c: ExtCtx) {
	try {
		const cdpUserId = c.req.query("cdp_user_id");
		if (!cdpUserId) {
			return c.json({error: "Missing cdp_user_id"}, 400);
		}
		return c.json({success: true, data: await queryValidRewards(c.env.DB, cdpUserId)});
	} catch (err: any) {
		console.error("[Query Valid Rewards Error]", err);
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
}

async function processRewardClaim(c: ExtCtx, rewardId: number, address: `0x${string}`, amount: string) {
	try {
		const cfg = c.get("cfg");
		const getResourceServer = c.get("getResourceServer");
		const rs = getResourceServer(c.env);

		const settleResult = await internalTreasurySettle(
			c as ExtCtx,
			cfg,
			rs,
			address,
			amount
		);
		if (!settleResult.success) {
			await updateRewardStatus(c.env.DB, rewardId, REWARD_STATUS_FAILED);
			return c.json({
				success: false,
				error: settleResult.errorReason || "Transfer failed"
			}, 500);
		}

		await updateRewardStatus(
			c.env.DB,
			rewardId,
			REWARD_STATUS_SUCCESS,
			settleResult.transaction
		);

		return c.json({
			success: true,
			data: {
				txHash: settleResult.transaction,
				payer: settleResult.payer,
				rewardId: rewardId
			}
		});

	} catch (err: any) {
		await updateRewardStatus(c.env.DB, rewardId, REWARD_STATUS_FAILED);
		console.error("[Claim Reward Transfer Error]", err);
		return c.json({error: "Transfer failed", detail: err?.message}, 500);
	}
}

export async function apiClaimReward(c: ExtCtx) {

		try {
			const body = await c.req.json().catch(() => ({}));
			const cdpUserId = body?.cdp_user_id;
			const rewardId = body?.id;

			if (!cdpUserId || !rewardId) {
				return c.json({error: "Missing cdp_user_id or id"}, 400);
			}

			const kolBinding = await getKolBindingByUserId(c.env.DB, cdpUserId);
			if (!kolBinding || !kolBinding.wallet_address) {
				return c.json({error: "Wallet address not found"}, 404);
			}

			const reward = await lockAndGetReward(c.env.DB, rewardId, cdpUserId);
			if (!reward) {
				return c.json({error: "Reward not found"}, 404);
			}

			await processRewardClaim(c, rewardId, kolBinding.wallet_address as `0x${string}`, reward.amount_atomic)
		} catch (err: any) {
			console.error("[Claim Reward Error]", err);
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
}

/**
 * 接口 3: 查询奖励历史
 * GET /rewards/query_history?cdp_user_id=xxx&status=-1&page_start=0
 */
export async function apiQueryRewardHistory(c: ExtCtx) {
		try {
			const cdpUserId = c.req.query("cdp_user_id");
			if (!cdpUserId) {
				return c.json({error: "Missing cdp_user_id"}, 400);
			}

			const status = parseInt(c.req.query("status") || "-1");
			const pageStart = parseInt(c.req.query("page_start") || "0");

			if (isNaN(pageStart) || pageStart < 0) {
				return c.json({error: "Invalid page_start"}, 400);
			}

			const result = await queryRewardHistory(c.env.DB, cdpUserId, status, pageStart);

			return c.json({
				success: true,
				data: {
					rewards: result.rewards,
					hasMore: result.hasMore,
					pageStart: pageStart,
					pageSize: result.rewards.length
				}
			});

		} catch (err: any) {
			console.error("[Query Reward History Error]", err);
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
}

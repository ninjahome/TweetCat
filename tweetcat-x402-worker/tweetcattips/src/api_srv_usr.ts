import {cdpFetch, ExtCtx, getOrCreateTreasuryEOA, isHexAddress, toFiat2dp} from "./common";
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
	REWARD_STATUS_FAILED,
	calculateWithdrawFee,
	createPlatformFee,
	queryPlatformFees
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
		if (!validationResult.ok) {
			return c.json(validationResult, validationResult.status)
		}

		const userInfo = parseXAuthEndUserSnapshot(validationResult.data)

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

async function processRewardClaim(
	c: ExtCtx,
	rewardId: number,
	cdpUserId: string,
	userWalletAddress: `0x${string}`,
	grossAmount: string
) {

	try {
		const feeRate = c.env.FEE_FOR_WITHDRAW || 0;
		const feeCalc = calculateWithdrawFee(grossAmount, feeRate);

		console.log(`[Claim] Reward ${rewardId}: gross=${feeCalc.grossAmount}, fee=${feeCalc.feeAmount} (${feeRate}%), net=${feeCalc.netAmount}`);

		const treasuryAccount = await getOrCreateTreasuryEOA(c);
		const platformWalletAddress = treasuryAccount.address as `0x${string}`;

		const cfg = c.get("cfg");
		const getResourceServer = c.get("getResourceServer");
		const rs = getResourceServer(c.env);
		const resourceUrl = `user://claim/${rewardId}`;

		const settleResult = await internalTreasurySettle(
			c as ExtCtx,
			cfg,
			rs,
			userWalletAddress,
			feeCalc.netAmount,  // 使用 net_amount 而不是 gross_amount
			resourceUrl
		);

		if (!settleResult.success) {
			await updateRewardStatus(c.env.DB, rewardId, REWARD_STATUS_FAILED, "", settleResult.errorReason);
			return c.json({
				success: false,
				error: settleResult.errorReason || "Transfer failed"
			}, 500);
		}

		await updateRewardStatus(c.env.DB, rewardId, REWARD_STATUS_SUCCESS, settleResult.transaction);

		await createPlatformFee(c.env.DB, {
			rewardId,
			cdpUserId,
			grossAmount: feeCalc.grossAmount,
			feeRate: feeCalc.feeRate,
			feeAmount: feeCalc.feeAmount,
			netAmount: feeCalc.netAmount,
			userWalletAddress,
			platformWalletAddress,
			tx_hash: settleResult.transaction
		});

		return c.json({
			success: true,
			data: {
				txHash: settleResult.transaction,
				payer: settleResult.payer,
				rewardId: rewardId,
			}
		});

	} catch (err: any) {
		await updateRewardStatus(c.env.DB, rewardId, REWARD_STATUS_FAILED, "", err?.message);
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

		return await processRewardClaim(
			c,
			rewardId,
			cdpUserId,
			kolBinding.wallet_address as `0x${string}`,
			reward.amount_atomic
		)
	} catch (err: any) {
		console.error("[Claim Reward Error]", err);
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
}

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

export async function apiQueryPlatformFees(c: ExtCtx) {
	try {
		const cdpUserId = c.req.query("cdp_user_id");
		if (!cdpUserId) {
			return c.json({error: "Missing cdp_user_id"}, 400);
		}

		const pageStart = parseInt(c.req.query("page_start") || "0");

		if (isNaN(pageStart) || pageStart < 0) {
			return c.json({error: "Invalid page_start"}, 400);
		}

		const result = await queryPlatformFees(c.env.DB, cdpUserId, pageStart);

		return c.json({
			success: true,
			data: {
				fees: result.fees,
				hasMore: result.hasMore,
				pageStart: pageStart,
				pageSize: result.fees.length
			}
		});

	} catch (err: any) {
		console.error("[Query Platform Fees Error]", err);
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
}

export async function apiCreateOnrampSession(c: ExtCtx) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const { destination_address, amount } = body;

		if (!destination_address) return c.json({ error: "Missing destination_address" }, 400);
		if (!isHexAddress(destination_address)) return c.json({ error: "Invalid EVM address" }, 400);
		const paymentAmount = toFiat2dp(amount);
		if(!paymentAmount){
			return c.json({ error: "Invalid amount" }, 400);
		}

		// Cloudflare 上尽量用 cf-connecting-ip
		const clientIp =
			c.req.header("cf-connecting-ip") ||
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
			undefined;

		// ✅ 正确的 CDP v2 Onramp Session API
		// Required: destinationAddress, purchaseCurrency, destinationNetwork
		// One-click: + paymentAmount, paymentCurrency
		const payload: any = {
			destinationAddress: destination_address,
			purchaseCurrency: "USDC",
			destinationNetwork: "base",
			paymentAmount,
			paymentCurrency: "USD",
			clientIp,
			// 可选：你想关联用户就加一个引用（不强制）
			// partnerUserRef: body.cdp_user_id ?? undefined,
			// redirectUrl: body.redirect_url ?? undefined,
		};

		const resp = await cdpFetch(c, "/platform/v2/onramp/sessions", "POST", payload, false);

		if (!resp.ok) {
			console.error("[Onramp Session Error]", resp.data);
			return c.json({ error: "Failed to create onramp session", detail: resp.data }, 500);
		}

		const onrampUrl = resp.data?.session?.onrampUrl;
		if (!onrampUrl) {
			return c.json({ error: "No onrampUrl returned", detail: resp.data }, 500);
		}

		return c.json({
			success: true,
			data: { onrampUrl },
		});
	} catch (err: any) {
		console.error("[Create Onramp Session Error]", err);
		return c.json({ error: "Internal Server Error", detail: err?.message }, 500);
	}
}

export async function apiOnrampWebhook(c: ExtCtx) {
	try {
		const body = await c.req.json().catch(() => ({}));
		console.log("[Onramp Webhook] Received:", JSON.stringify(body, null, 2));

		// Coinbase Webhook 格式：
		// {
		//   "event_type": "onramp_transaction_completed",
		//   "data": {
		//     "transaction_id": "...",
		//     "status": "completed",
		//     "destination_address": "...",
		//     "amount": { "value": "...", "currency": "USDC" },
		//     "blockchain_tx_hash": "...",
		//     "payment_method": "CARD_DEBIT"
		//   }
		// }

		const eventType = body.event_type;
		const data = body.data;

		if (!data || !data.transaction_id) {
			console.error("[Onramp Webhook] Invalid payload");
			return c.json({error: "Invalid payload"}, 400);
		}

		// 更新购买记录
		const {updateOnrampPurchaseStatus} = await import('./database');

		const updates: any = {};

		if (eventType === "onramp_transaction_completed") {
			updates.status = "completed";
		} else if (eventType === "onramp_transaction_failed") {
			updates.status = "failed";
			updates.errorMessage = data.error_message || "Transaction failed";
		}

		if (data.amount?.value) {
			// 将 crypto 金额转为 atomic units
			const cryptoAmount = parseFloat(data.amount.value);
			updates.amountCrypto = Math.floor(cryptoAmount * 1e6).toString();
		}

		if (data.blockchain_tx_hash) {
			updates.txHash = data.blockchain_tx_hash;
		}

		if (data.payment_method) {
			updates.paymentMethod = data.payment_method;
		}

		await updateOnrampPurchaseStatus(c.env.DB, data.transaction_id, updates);

		console.log(`[Onramp Webhook] Updated transaction ${data.transaction_id}`);

		return c.json({success: true});

	} catch (err: any) {
		console.error("[Onramp Webhook Error]", err);
		return c.json({error: "Internal Server Error", detail: err?.message}, 500);
	}
}

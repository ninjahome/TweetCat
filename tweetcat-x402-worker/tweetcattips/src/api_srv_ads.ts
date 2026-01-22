import {Hono} from "hono";
import {ContentfulStatusCode} from "hono/utils/http-status";
import {
	ExtCtx,
	ExtendedEnv,
	jsonError,
	requireStringField,
	parsePositiveInt,
	parsePositiveAtomic,
	usdcToAtomicSafe,
	API_PATH_ADS_BALANCE,
	API_PATH_ADS_CREATE,
	API_PATH_ADS_UPDATE,
	API_PATH_ADS_MY_ADS,
	API_PATH_ADS_LIST,
	API_PATH_ADS_CLAIM,
	API_PATH_ADS_MY_CLAIMS,
	API_PATH_ADS_PUBLISHER_RECHARGE,
	API_PATH_ADS_PUBLISHER_WITHDRAW,
	API_PATH_ADS_PUBLISHER_LEDGER
} from "./common";
import {
	AdCategory,
	CATEGORY_DURATION,
	CATEGORY_TAGS,
	formatDeadlineText,
	getRewardRange,
	computePopularityScore,
	toSqliteDate,
	getAdAccountBalance,
	getAccountBalanceAtomic,
	reserveAdBudget,
	createAd,
	updateAdSettings,
	getMyAds,
	getActiveAdsList,
	getAdById,
	incrementAdQuota,
	ensureEscrowAccount,
	getEscrowLedgerByRequestId,
	getEscrowLedgerByTxHash,
	insertDepositLedger,
	creditEscrowBalance,
	insertWithdrawLedger,
	debitEscrowBalance,
	settleWithdrawLedger,
	failWithdrawLedger,
	refundEscrowBalance,
	listAdEscrowLedger,
	createDetailedClaim,
	getDetailedClaim,
	getPerformerHistory,
	type AdCreatePayload,
	type CreateDetailedClaimParams,
} from "./database_ad";
import {internalTreasurySettle, PaymentRequiredError, x402Workflow} from "./api_srv_x402";
import {getKolBindingByXId} from "./database_402";

// ========= Types =========

/**
 * 提现/充值请求参数解析结果
 * 用于统一处理来自请求体的 a_x_id 和 amount 参数
 */
export interface ParsedEscrowRequest {
	/** 用户的 X ID (Twitter/X sub) */
	aXId: string;
	/** 转换为原子单位的金额 */
	amountAtomic: string;
}

/**
 * 提现/充值请求参数解析的自定义错误类
 * 用于在 throw 中传递 HTTP 状态码和错误信息
 */
export class EscrowRequestError extends Error {
	constructor(
		public readonly code: string,
		public readonly detail: string,
		public readonly statusCode: number = 400
	) {
		super(detail);
		this.name = "EscrowRequestError";
	}
}

// ========= Helpers =========

/**
 * 从请求体解析托管账户操作的参数（a_x_id 和 amount）
 *
 * @param c - Hono 请求上下文
 * @returns ParsedEscrowRequest 包含 aXId 和 amountAtomic
 * @throws EscrowRequestError 当参数无效时抛出
 *
 * @example
 * try {
 *   const params = await parseEscrowRequestParams(c);
 *   console.log(params.aXId, params.amountAtomic);
 * } catch (err) {
 *   if (err instanceof EscrowRequestError) {
 *     return jsonError(c, err.statusCode as ContentfulStatusCode, err.code, err.detail);
 *   }
 * }
 */
export async function parseEscrowRequestParams(c: ExtCtx): Promise<ParsedEscrowRequest> {
	const body = await c.req.json().catch(() => ({}));
	const aXId = body?.a_x_id;
	const amountStr = body?.amount;

	// 验证 a_x_id
	if (!requireStringField(aXId)) {
		throw new EscrowRequestError(
			"INVALID_REQUEST",
			"Missing a_x_id",
			400
		);
	}

	// 验证 amount
	if (!requireStringField(amountStr)) {
		throw new EscrowRequestError(
			"INVALID_REQUEST",
			"Missing amount",
			400
		);
	}

	// 将十进制金额转换为原子单位
	let amountAtomic: string;
	try {
		amountAtomic = usdcToAtomicSafe(amountStr);
	} catch (e) {
		throw new EscrowRequestError(
			"INVALID_REQUEST",
			"Invalid amount format",
			400
		);
	}

	return {
		aXId,
		amountAtomic
	};
}

/**
 * 验证 custom_data 格式
 * @param customData - 待验证的数据
 * @returns 错误信息字符串，如果验证通过则返回 null
 */
function validateCustomData(customData: any): string | null {
	if (!customData) return null;

	try {
		if (typeof customData === "string") {
			JSON.parse(customData);
		} else if (typeof customData !== "object") {
			return "Invalid custom_data format";
		}
		if (JSON.stringify(customData).length > 8192) {
			return "custom_data exceeds maximum size (8KB)";
		}
	} catch (e) {
		return "Invalid custom_data: must be valid JSON";
	}
	return null;
}

// ========= API Endpoints =========

export async function apiAdsBalance(c: ExtCtx) {
	try {
		const aXId = c.req.query("a_x_id");
		if (!aXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		const row = await getAdAccountBalance(c.env.DB, aXId);
		if (!row) {
			return c.json({
				a_x_id: aXId,
				asset_symbol: "USDC",
				balance_atomic: "0",
				frozen_atomic: "0"
			});
		}
		return c.json({
			a_x_id: row.a_x_id,
			asset_symbol: row.asset_symbol,
			balance_atomic: row.available_atomic,
			frozen_atomic: row.frozen_atomic
		});
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsCreate(c: ExtCtx) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const aXId = body?.a_x_id;
		const category = body?.category;
		const name = body?.name;
		const title = body?.title;
		const description = body?.description;
		const detailUrl = body?.detail_url;
		const imageUrl = body?.image_url || null;
		const callbackUrl = body?.callback_url || null;
		const customData = body?.custom_data || null;
		const unitPriceAtomic = parsePositiveAtomic(body?.unit_price_atomic);
		const quotaTotal = parsePositiveInt(body?.quota_total);
		const durationDays = parsePositiveInt(body?.duration_days) ?? 0;

		if (!requireStringField(aXId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");
		if (!requireStringField(category)) return jsonError(c, 400, "INVALID_REQUEST", "Missing category");
		if (!requireStringField(name)) return jsonError(c, 400, "INVALID_REQUEST", "Missing name");
		if (!requireStringField(title)) return jsonError(c, 400, "INVALID_REQUEST", "Missing title");
		if (!requireStringField(description)) return jsonError(c, 400, "INVALID_REQUEST", "Missing description");
		if (!requireStringField(detailUrl)) return jsonError(c, 400, "INVALID_REQUEST", "Missing detail_url");
		if (!unitPriceAtomic) return jsonError(c, 400, "INVALID_REQUEST", "Invalid unit_price_atomic");
		if (!quotaTotal) return jsonError(c, 400, "INVALID_REQUEST", "Invalid quota_total");

		// Validate category
		const validCategories: AdCategory[] = ["follow", "visit", "register", "share"];
		if (!validCategories.includes(category as AdCategory)) {
			return jsonError(c, 400, "INVALID_REQUEST", "Invalid category. Must be: follow, visit, register, or share");
		}

		// Validate custom_data
		const customDataError = validateCustomData(customData);
		if (customDataError) {
			return jsonError(c, 400, "INVALID_REQUEST", customDataError);
		}

		const requiredAtomic = (BigInt(unitPriceAtomic) * BigInt(quotaTotal)).toString();

		// Try to reserve budget (move from available to frozen)
		const reserved = await reserveAdBudget(c.env.DB, aXId, requiredAtomic);
		if (!reserved) {
			const accountInfo = await getAccountBalanceAtomic(c.env.DB, aXId);
			return jsonError(
				c,
				400,
				"INSUFFICIENT_BALANCE",
				`Required ${requiredAtomic}, available ${accountInfo.balanceAtomic}.`
			);
		}

		// Create ad
		const adId = crypto.randomUUID();
		const payload: AdCreatePayload = {
			adId,
			aXId,
			category: category as AdCategory,
			name,
			title,
			description,
			detailUrl,
			imageUrl,
			callbackUrl,
			customData: typeof customData === 'string' ? customData : (customData ? JSON.stringify(customData) : null),
			unitPriceAtomic,
			quotaTotal,
			durationDays,
		};

		const created = await createAd(c.env.DB, payload);
		if (!created) {
			return jsonError(c, 500, "INTERNAL_ERROR", "Failed to create ad");
		}

		return c.json({ok: true, ad_id: adId, required_atomic: requiredAtomic});
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsUpdate(c: ExtCtx) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const adId = body?.ad_id;
		const aXId = body?.a_x_id;
		const callbackUrl = body?.callback_url;
		const customData = body?.custom_data;

		if (!requireStringField(adId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing ad_id");
		if (!requireStringField(aXId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		// Validate custom_data
		const customDataError = validateCustomData(customData);
		if (customDataError) {
			return jsonError(c, 400, "INVALID_REQUEST", customDataError);
		}

		// Validate callback_url if provided
		if (callbackUrl && typeof callbackUrl !== "string") {
			return jsonError(c, 400, "INVALID_REQUEST", "Invalid callback_url format");
		}

		const updated = await updateAdSettings(
			c.env.DB,
			adId,
			aXId,
			callbackUrl || null,
			typeof customData === 'string' ? customData : (customData ? JSON.stringify(customData) : null)
		);

		if (!updated) {
			// Check if ad exists to give better error
			const ad = await getAdById(c.env.DB, adId);
			if (!ad) return jsonError(c, 404, "NOT_FOUND", "Ad not found");
			if (ad.a_x_id !== aXId) return jsonError(c, 403, "FORBIDDEN", "You do not own this ad");

			return jsonError(c, 500, "INTERNAL_ERROR", "Failed to update ad");
		}

		return c.json({ok: true, ad_id: adId});
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsMyAds(c: ExtCtx) {
	try {
		const aXId = c.req.query("a_x_id");
		if (!aXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		const ads = await getMyAds(c.env.DB, aXId);
		return c.json(ads);
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsList(c: ExtCtx) {
	try {
		const rows = await getActiveAdsList(c.env.DB);

		const ads = rows.map((row) => {
			const rewardUSDC = Number(row.unit_price_atomic || 0) / 1_000_000;
			const createdAt = row.created_at ? Date.parse(row.created_at) : Date.now();
			const category = (row.category as AdCategory) || "visit";
			return {
				id: row.ad_id,
				title: row.title,
				brand: `@${row.a_x_id}`,
				description: row.description,
				category,
				rewardUSDC,
				durationMinutes: CATEGORY_DURATION[category] ?? 3,
				completed: row.quota_used,
				totalQuota: row.quota_total,
				deadlineText: formatDeadlineText(row.duration_days, row.created_at),
				tags: CATEGORY_TAGS[category] ?? [],
				rewardRange: getRewardRange(rewardUSDC),
				popularityScore: computePopularityScore(row.quota_used, row.quota_total),
				createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
				detailUrl: row.detail_url,
			};
		});

		return c.json(ads);
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsClaim(c: ExtCtx) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const adId = body?.ad_id;
		const bXId = body?.b_x_id;
		const signature = body?.signature;

		if (!requireStringField(adId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing ad_id");
		if (!requireStringField(bXId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing b_x_id");
		if (!requireStringField(signature)) return jsonError(c, 400, "INVALID_REQUEST", "Missing signature");

		// Get ad info
		const adRow = await getAdById(c.env.DB, adId);
		if (!adRow) return jsonError(c, 404, "NOT_FOUND", "Ad not found");
		if (adRow.status !== "ACTIVE") {
			return jsonError(c, 400, "AD_NOT_ACTIVE", "Ad is not active");
		}
		if (adRow.quota_used >= adRow.quota_total) {
			return jsonError(c, 400, "QUOTA_FULL", "Ad quota is full");
		}

		// Check if already claimed (using new table)
		const existingClaim = await getDetailedClaim(c.env.DB, adId, bXId);
		if (existingClaim) return c.json(existingClaim);

		// Increment quota
		const quotaIncremented = await incrementAdQuota(c.env.DB, adId);
		if (!quotaIncremented) {
			return jsonError(c, 400, "QUOTA_FULL", "Ad quota is full or inactive");
		}

		// Create claim record
		const claimId = crypto.randomUUID();

		const claimParams: CreateDetailedClaimParams = {
			claimId,
			adId: adRow.ad_id,
			bXId,
			signature
		};

		const claimCreated = await createDetailedClaim(c.env.DB, claimParams);
		if (!claimCreated) {
			return jsonError(c, 500, "INTERNAL_ERROR", "Failed to create claim");
		}

		return c.json({
			claim_id: claimId,
			ad_id: adRow.ad_id,
			b_x_id: bXId,
			status: "CLAIMED",
			signature: signature,
			created_at: toSqliteDate(new Date())
		});
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsMyClaims(c: ExtCtx) {
	try {
		const bXId = c.req.query("b_x_id");
		if (!bXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing b_x_id");

		const claims = await getPerformerHistory(c.env.DB, bXId);
		return c.json(claims);
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

/**
 * 充值到广告托管账户
 * 用户通过 x402 支付将 USDC 转账到平台库账户
 */
export async function apiRechargeToAdEscrowAccount(c: ExtCtx) {
	try {
		// ✅ 使用新的解析函数
		const { aXId, amountAtomic } = await parseEscrowRequestParams(c);

		const payTo = (c.env.TREASURY_ADDRESS as `0x${string}`)
		const settleResult = await x402Workflow(c, payTo, amountAtomic, "USDC Transfer To Ad Escrow Account");

		const txHash = settleResult.transaction;
		const payer = settleResult.payer?.toLowerCase();

		// Check if already processed
		const existingLedger = await getEscrowLedgerByTxHash(c.env.DB, txHash);
		if (existingLedger) {
			return c.json({
				success: true,
				txHash,
				payer,
				a_x_id: aXId,
				amount_atomic: amountAtomic,
				alreadyProcessed: true
			});
		}

		// Ensure account exists and insert ledger + credit balance atomically
		await ensureEscrowAccount(c.env.DB, aXId);

		const ledgerId = crypto.randomUUID();
		const ledgerInserted = await insertDepositLedger(
			c.env.DB,
			ledgerId,
			aXId,
			amountAtomic,
			txHash,
			payer || "",
			c.env.TREASURY_ADDRESS
		);

		// Only credit if ledger was actually inserted
		if (ledgerInserted) {
			await creditEscrowBalance(c.env.DB, aXId, amountAtomic);
		}

		return c.json({ success: true, txHash});
	} catch (err: any) {
		// ✅ 处理自定义的 EscrowRequestError
		if (err instanceof EscrowRequestError) {
			return jsonError(c, err.statusCode as ContentfulStatusCode, err.code, err.detail);
		}
		if (err instanceof PaymentRequiredError) return c.json({error: "PAYMENT_REQUIRED"}, 402);
		console.error("[apiRechargeToAdEscrowAccount Error]", err);

		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

/**
 * 从广告托管账户提现资金
 * 资金原路返回到用户的绑定钱包地址
 * 防止重复提现：每个用户每月只能提现一次
 */
export async function apiWithdrawFromAdsEscrowAccount(c: ExtCtx) {
	try {
		console.log("[apiWithdrawFromAdsEscrowAccount] 开始处理提现请求");

		// ✅ 使用新的解析函数
		const { aXId, amountAtomic } = await parseEscrowRequestParams(c);
		console.log(`[apiWithdrawFromAdsEscrowAccount] 参数验证成功: aXId=${aXId}, amountAtomic=${amountAtomic}`);

		// 从 kol_binding 表查询用户的绑定钱包地址（原路返回）
		console.log(`[apiWithdrawFromAdsEscrowAccount] 查询用户绑定的钱包地址...`);
		const kolBinding = await getKolBindingByXId(c.env.DB, aXId);
		console.log(`[apiWithdrawFromAdsEscrowAccount] kolBinding 结果:`, kolBinding);

		if (!kolBinding || !kolBinding.wallet_address) {
			console.log(`[apiWithdrawFromAdsEscrowAccount] 错误：未找到钱包地址`);
			return jsonError(c, 400, "INVALID_REQUEST", "User wallet address not found. Please bind your wallet first.");
		}

		const toAddress = kolBinding.wallet_address;
		console.log(`[apiWithdrawFromAdsEscrowAccount] 目标钱包: ${toAddress}`);

		// 使用确定性的幂等性密钥来防止重复提现
		// 格式：aXId_yearMonth (e.g., "user_123_202601") - 每月最多提现一次
		const now = new Date();
		const yearMonth = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
		const idempotencyKey = `${aXId}_${yearMonth}`; // "user_123_202601"
		console.log(`[apiWithdrawFromAdsEscrowAccount] 幂等性密钥: ${idempotencyKey}`);

		// 检查该用户是否已经在本月提现过
		console.log(`[apiWithdrawFromAdsEscrowAccount] 检查本月是否已提现过...`);
		const existingLedger = await getEscrowLedgerByRequestId(c.env.DB, aXId, 'WITHDRAW', idempotencyKey);
		console.log(`[apiWithdrawFromAdsEscrowAccount] 重复提现检查结果:`, existingLedger);

		if (existingLedger) {
			if (existingLedger.status === 'SETTLED' && existingLedger.tx_hash) {
				console.log(`[apiWithdrawFromAdsEscrowAccount] 本月已提现过`);

				// 计算下个月第一天
				const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
				const nextAvailableDate = nextMonth.toISOString().split('T')[0]; // YYYY-MM-DD

				return c.json({
					success: false,  // 本次请求未执行新操作
					alreadyWithdrawn: true,  // 标识已提现过
					reason: "MONTHLY_LIMIT_REACHED",
					message: "You have already withdrawn this month. Each account can only withdraw once per month.",
					previousTxHash: existingLedger.tx_hash,  // 历史交易哈希
					withdrawnAt: existingLedger.created_at,  // 提现时间
					nextAvailableDate  // 下次可提现日期
				});
			} else if (existingLedger.status === 'PENDING') {
				console.log(`[apiWithdrawFromAdsEscrowAccount] 前次提现仍在进行中`);
				return jsonError(c, 400, "PENDING", "Withdrawal is still pending from previous attempt");
			} else if (existingLedger.status === 'FAILED') {
				console.log(`[apiWithdrawFromAdsEscrowAccount] 前次提现失败: ${existingLedger.error_reason}`);
				return jsonError(c, 400, "FAILED", existingLedger.error_reason || "Previous withdrawal failed, please try later");
			}
		}

		// 原子性地锁定资金：插入账本记录并扣除余额
		const ledgerId = crypto.randomUUID();
		console.log(`[apiWithdrawFromAdsEscrowAccount] 插入账本记录: ledgerId=${ledgerId}`);
		const ledgerInserted = await insertWithdrawLedger(
			c.env.DB,
			ledgerId,
			aXId,
			amountAtomic,
			toAddress as `0x${string}`,
			idempotencyKey
		);
		console.log(`[apiWithdrawFromAdsEscrowAccount] 账本插入结果: ${ledgerInserted}`);

		if (!ledgerInserted) {
			console.log(`[apiWithdrawFromAdsEscrowAccount] 错误：账本记录插入失败`);
			return jsonError(c, 400, "INVALID_REQUEST", "Withdrawal already processing. Please check again later.");
		}

		// 扣除余额
		console.log(`[apiWithdrawFromAdsEscrowAccount] 扣减余额...`);
		const debited = await debitEscrowBalance(c.env.DB, aXId, amountAtomic);
		console.log(`[apiWithdrawFromAdsEscrowAccount] 扣减结果: ${debited}`);

		if (!debited) {
			console.log(`[apiWithdrawFromAdsEscrowAccount] 错误：余额不足或扣减失败`);
			// 标记账本记录为失败
			await failWithdrawLedger(c.env.DB, ledgerId, "Insufficient available balance");
			return jsonError(c, 400, "INSUFFICIENT_BALANCE", `Required ${amountAtomic}, insufficient available balance`);
		}

		// 执行 x402 支付：从库账户转账到用户的绑定钱包
		try {
			const resourceUrl = `ads://withdraw/${aXId}`;
			console.log(`[apiWithdrawFromAdsEscrowAccount] 开始调用 internalTreasurySettle...`);
			console.log(`[apiWithdrawFromAdsEscrowAccount] 参数: toAddress=${toAddress}, amountAtomic=${amountAtomic}, resourceUrl=${resourceUrl}`);

			const settleResult = await internalTreasurySettle(
				c,
				toAddress as `0x${string}`,
				amountAtomic,
				resourceUrl
			);

			console.log(`[apiWithdrawFromAdsEscrowAccount] internalTreasurySettle 返回:`, settleResult);

			if (!settleResult.success) {
				console.log(`[apiWithdrawFromAdsEscrowAccount] 错误：支付失败，原因: ${settleResult.errorReason}`);
				return jsonError(c, 500, "WITHDRAW_FAILED", settleResult.errorReason || "Settlement failed");
			}

			// 更新账本记录为已结算
			const txHash = settleResult.transaction;
			const payer = settleResult.payer?.toLowerCase();
			console.log(`[apiWithdrawFromAdsEscrowAccount] 更新账本为已结算: txHash=${txHash}, payer=${payer}`);
			await settleWithdrawLedger(c.env.DB, ledgerId, txHash, payer || "");

			console.log(`[apiWithdrawFromAdsEscrowAccount] 提现成功完成`);
			return c.json({
				success: true,
				txHash,
				to_address: toAddress,
				amount_atomic: amountAtomic
			});
		} catch (err: any) {
			// 支付失败：标记账本为失败并退款
			const errorMsg = err?.message || "Payout failed";
			console.error(`[apiWithdrawFromAdsEscrowAccount] internalTreasurySettle 异常:`, {
				message: err?.message,
				stack: err?.stack,
				code: err?.code,
				name: err?.name
			});
			console.log(`[apiWithdrawFromAdsEscrowAccount] 标记账本为失败并退款...`);
			await failWithdrawLedger(c.env.DB, ledgerId, errorMsg);
			await refundEscrowBalance(c.env.DB, aXId, amountAtomic);

			return jsonError(c, 500, "WITHDRAW_FAILED", errorMsg);
		}
	} catch (err: any) {
		// ✅ 处理自定义的 EscrowRequestError
		console.error("[apiWithdrawFromAdsEscrowAccount] 外层异常:", {
			name: err?.name,
			message: err?.message,
			stack: err?.stack,
			code: err?.code,
			isEscrowRequestError: err instanceof EscrowRequestError
		});

		if (err instanceof EscrowRequestError) {
			return jsonError(c, err.statusCode as ContentfulStatusCode, err.code, err.detail);
		}
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

/**
 * 查询广告托管账本列表（充值/提现历史）
 */
export async function apiAdsPublisherLedger(c: ExtCtx) {
	try {
		const aXId = c.req.query("a_x_id");
		if (!aXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		const limitStr = c.req.query("limit") || "50";
		const offsetStr = c.req.query("offset") || "0";

		let limit = parseInt(limitStr, 10);
		let offset = parseInt(offsetStr, 10);

		if (!Number.isFinite(limit) || limit < 1) limit = 50;
		if (!Number.isFinite(offset) || offset < 0) offset = 0;

		const rows = await listAdEscrowLedger(c.env.DB, aXId, limit, offset);

		return c.json({
			success: true,
			rows
		});
	} catch (err: any) {
		console.error("[apiAdsPublisherLedger Error]", err);
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

/**
 * 注册广告相关路由
 */
export function registerAdsRoutes(app: Hono<ExtendedEnv>) {
	app.get(API_PATH_ADS_BALANCE, apiAdsBalance);
	app.post(API_PATH_ADS_CREATE, apiAdsCreate);
	app.post(API_PATH_ADS_UPDATE, apiAdsUpdate);
	app.get(API_PATH_ADS_MY_ADS, apiAdsMyAds);
	app.get(API_PATH_ADS_LIST, apiAdsList);
	app.post(API_PATH_ADS_CLAIM, apiAdsClaim);
	app.get(API_PATH_ADS_MY_CLAIMS, apiAdsMyClaims);
	app.post(API_PATH_ADS_PUBLISHER_RECHARGE, apiRechargeToAdEscrowAccount);
	app.post(API_PATH_ADS_PUBLISHER_WITHDRAW, apiWithdrawFromAdsEscrowAccount);
	app.get(API_PATH_ADS_PUBLISHER_LEDGER, apiAdsPublisherLedger);
}

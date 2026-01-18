import {Hono} from "hono";
import {ContentfulStatusCode} from "hono/utils/http-status";
import {ExtCtx, ExtendedEnv, jsonError, requireStringField, parsePositiveInt, parsePositiveAtomic, usdcToAtomicSafe, isHexAddress, getPaymentHeader, decodeBase64Json, encodeBase64Json} from "./common";
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
	getMyAds,
	getActiveAdsList,
	getAdById,
	incrementAdQuota,
	getExistingClaim,
	createClaim,
	getMyClaimsList,
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
	type AdCreatePayload,
	type ClaimCreatePayload,
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
		const unitPriceAtomic = parsePositiveAtomic(body?.unit_price_atomic);
		const quotaTotal = parsePositiveInt(body?.quota_total);
		let rulesJson: string | null = null;

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

		// Parse and validate rules_json (optional)
		if (body?.rules_json) {
			const rulesRaw = body.rules_json;
			try {
				// Accept both string and object
				if (typeof rulesRaw === "string") {
					const parsed = JSON.parse(rulesRaw);
					rulesJson = JSON.stringify(parsed);
				} else if (typeof rulesRaw === "object" && rulesRaw !== null) {
					rulesJson = JSON.stringify(rulesRaw);
				} else {
					return jsonError(c, 400, "INVALID_REQUEST", "Invalid rules_json format");
				}
				// Check length (limit to 8KB)
				if (rulesJson.length > 8192) {
					return jsonError(c, 400, "INVALID_REQUEST", "rules_json exceeds maximum size (8KB)");
				}
			} catch (e) {
				return jsonError(c, 400, "INVALID_REQUEST", "Invalid rules_json: must be valid JSON");
			}
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
			unitPriceAtomic,
			quotaTotal,
			startAt: body?.start_at ?? null,
			endAt: body?.end_at ?? null,
			rulesJson,
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
				deadlineText: formatDeadlineText(row.end_at),
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
		const bWallet = body?.b_wallet;

		if (!requireStringField(adId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing ad_id");
		if (!requireStringField(bXId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing b_x_id");
		if (!requireStringField(bWallet)) return jsonError(c, 400, "INVALID_REQUEST", "Missing b_wallet");

		// Get ad info
		const adRow = await getAdById(c.env.DB, adId);
		if (!adRow) return jsonError(c, 404, "NOT_FOUND", "Ad not found");
		if (adRow.status !== "ACTIVE") {
			return jsonError(c, 400, "AD_NOT_ACTIVE", "Ad is not active");
		}
		if (adRow.quota_used >= adRow.quota_total) {
			return jsonError(c, 400, "QUOTA_FULL", "Ad quota is full");
		}

		// Check if already claimed
		const existingClaim = await getExistingClaim(c.env.DB, adId, bXId);
		if (existingClaim) return c.json(existingClaim);

		// Increment quota
		const quotaIncremented = await incrementAdQuota(c.env.DB, adId);
		if (!quotaIncremented) {
			return jsonError(c, 400, "QUOTA_FULL", "Ad quota is full or inactive");
		}

		// Create claim record
		const claimId = crypto.randomUUID();
		const expiresAt = toSqliteDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

		const claimPayload: ClaimCreatePayload = {
			claimId,
			adId: adRow.ad_id,
			aXId: adRow.a_x_id,
			bXId,
			bWallet,
			unitPriceAtomic: adRow.unit_price_atomic,
			expiresAt,
		};

		const claimCreated = await createClaim(c.env.DB, claimPayload);
		if (!claimCreated) {
			return jsonError(c, 500, "INTERNAL_ERROR", "Failed to create claim");
		}

		return c.json({
			claim_id: claimId,
			ad_id: adRow.ad_id,
			a_x_id: adRow.a_x_id,
			b_x_id: bXId,
			b_wallet: bWallet,
			status: "CLAIMED",
			unit_price_atomic: adRow.unit_price_atomic,
			expires_at: expiresAt,
		});
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsMyClaims(c: ExtCtx) {
	try {
		const bXId = c.req.query("b_x_id");
		if (!bXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing b_x_id");

		const claims = await getMyClaimsList(c.env.DB, bXId);
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
		// ✅ 使用新的解析函数
		const { aXId, amountAtomic } = await parseEscrowRequestParams(c);

		// 从 kol_binding 表查询用户的绑定钱包地址（原路返回）
		const kolBinding = await getKolBindingByXId(c.env.DB, aXId);
		if (!kolBinding || !kolBinding.wallet_address) {
			return jsonError(c, 400, "INVALID_REQUEST", "User wallet address not found. Please bind your wallet first.");
		}

		const toAddress = kolBinding.wallet_address;

		// 使用确定性的幂等性密钥来防止重复提现
		// 格式：aXId_yearMonth (e.g., "user_123_202601") - 每月最多提现一次
		const now = new Date();
		const yearMonth = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
		const idempotencyKey = `${aXId}_${yearMonth}`; // "user_123_202601"

		// 检查该用户是否已经在本月提现过
		const existingLedger = await getEscrowLedgerByRequestId(c.env.DB, aXId, 'WITHDRAW', idempotencyKey);
		if (existingLedger) {
			if (existingLedger.status === 'SETTLED' && existingLedger.tx_hash) {
				return c.json({
					success: true,
					txHash: existingLedger.tx_hash,
					message: "Already withdrawn this month"
				});
			} else if (existingLedger.status === 'PENDING') {
				return jsonError(c, 400, "PENDING", "Withdrawal is still pending from previous attempt");
			} else if (existingLedger.status === 'FAILED') {
				return jsonError(c, 400, "FAILED", existingLedger.error_reason || "Previous withdrawal failed, please try later");
			}
		}

		// 原子性地锁定资金：插入账本记录并扣除余额
		const ledgerId = crypto.randomUUID();
		const ledgerInserted = await insertWithdrawLedger(
			c.env.DB,
			ledgerId,
			aXId,
			amountAtomic,
			toAddress as `0x${string}`,
			idempotencyKey
		);

		if (!ledgerInserted) {
			return jsonError(c, 400, "INVALID_REQUEST", "Withdrawal already processing. Please check again later.");
		}

		// 扣除余额
		const debited = await debitEscrowBalance(c.env.DB, aXId, amountAtomic);
		if (!debited) {
			// 标记账本记录为失败
			await failWithdrawLedger(c.env.DB, ledgerId, "Insufficient available balance");
			return jsonError(c, 400, "INSUFFICIENT_BALANCE", `Required ${amountAtomic}, insufficient available balance`);
		}

		// 执行 x402 支付：从库账户转账到用户的绑定钱包
		try {
			const resourceUrl = `ads://withdraw/${aXId}`;
			const settleResult = await internalTreasurySettle(
				c,
				toAddress as `0x${string}`,
				amountAtomic,
				resourceUrl
			);

			if (!settleResult.success) {
				throw new Error(settleResult.errorReason || "Settlement failed");
			}

			// 更新账本记录为已结算
			const txHash = settleResult.transaction;
			const payer = settleResult.payer?.toLowerCase();
			await settleWithdrawLedger(c.env.DB, ledgerId, txHash, payer || "");

			return c.json({
				success: true,
				txHash,
				to_address: toAddress,
				amount_atomic: amountAtomic
			});
		} catch (err: any) {
			// 支付失败：标记账本为失败并退款
			const errorMsg = err?.message || "Payout failed";
			await failWithdrawLedger(c.env.DB, ledgerId, errorMsg);
			await refundEscrowBalance(c.env.DB, aXId, amountAtomic);

			return jsonError(c, 500, "WITHDRAW_FAILED", errorMsg);
		}
	} catch (err: any) {
		// ✅ 处理自定义的 EscrowRequestError
		if (err instanceof EscrowRequestError) {
			return jsonError(c, err.statusCode as ContentfulStatusCode, err.code, err.detail);
		}
		console.error("[apiWithdrawFromAdsEscrowAccount Error]", err);
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

/**
 * 注册广告相关路由
 */
export function registerAdsRoutes(app: Hono<ExtendedEnv>) {
	app.get("/ads/balance", apiAdsBalance);
	app.post("/ads/create", apiAdsCreate);
	app.get("/ads/my_ads", apiAdsMyAds);
	app.get("/ads/list", apiAdsList);
	app.post("/ads/claim", apiAdsClaim);
	app.get("/ads/my_claims", apiAdsMyClaims);
	app.post("/ads/publisher/recharge", apiRechargeToAdEscrowAccount);
	app.post("/ads/publisher/withdraw", apiWithdrawFromAdsEscrowAccount);
}

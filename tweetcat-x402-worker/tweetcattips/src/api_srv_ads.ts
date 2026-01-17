import {Hono} from "hono";
import {ExtCtx, ExtendedEnv, jsonError, requireStringField, parsePositiveInt, parsePositiveAtomic} from "./common";
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
	deductAdAccountBalance,
	createAd,
	getMyAds,
	getActiveAdsList,
	getAdById,
	incrementAdQuota,
	getExistingClaim,
	createClaim,
	getMyClaimsList,
	type AdCreatePayload,
	type ClaimCreatePayload,
} from "./database_ad";

export async function apiAdsBalance(c: ExtCtx) {
	try {
		const aXId = c.req.query("a_x_id");
		if (!aXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		const row = await getAdAccountBalance(c.env.DB, aXId);
		if (!row) {
			return c.json({a_x_id: aXId, asset_symbol: "USDC", balance_atomic: "0"});
		}
		return c.json(row);
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsCreate(c: ExtCtx) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const aXId = body?.a_x_id;
		const adType = body?.ad_type;
		const category = body?.category;
		const name = body?.name;
		const title = body?.title;
		const description = body?.description;
		const detailUrl = body?.detail_url;
		const unitPriceAtomic = parsePositiveAtomic(body?.unit_price_atomic);
		const quotaTotal = parsePositiveInt(body?.quota_total);

		if (!requireStringField(aXId)) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");
		if (!requireStringField(adType)) return jsonError(c, 400, "INVALID_REQUEST", "Missing ad_type");
		if (!requireStringField(category)) return jsonError(c, 400, "INVALID_REQUEST", "Missing category");
		if (!requireStringField(name)) return jsonError(c, 400, "INVALID_REQUEST", "Missing name");
		if (!requireStringField(title)) return jsonError(c, 400, "INVALID_REQUEST", "Missing title");
		if (!requireStringField(description)) return jsonError(c, 400, "INVALID_REQUEST", "Missing description");
		if (!requireStringField(detailUrl)) return jsonError(c, 400, "INVALID_REQUEST", "Missing detail_url");
		if (!unitPriceAtomic) return jsonError(c, 400, "INVALID_REQUEST", "Invalid unit_price_atomic");
		if (!quotaTotal) return jsonError(c, 400, "INVALID_REQUEST", "Invalid quota_total");

		const requiredAtomic = (BigInt(unitPriceAtomic) * BigInt(quotaTotal)).toString();

		// 尝试扣减余额
		const deducted = await deductAdAccountBalance(c.env.DB, aXId, requiredAtomic);
		if (!deducted) {
			const accountInfo = await getAccountBalanceAtomic(c.env.DB, aXId);
			return jsonError(
				c,
				400,
				"INSUFFICIENT_BALANCE",
				`Required ${requiredAtomic}, current ${accountInfo.balanceAtomic}.`
			);
		}

		// 创建广告
		const adId = crypto.randomUUID();
		const payload: AdCreatePayload = {
			adId,
			aXId,
			adType,
			category,
			name,
			title,
			description,
			detailUrl,
			unitPriceAtomic,
			quotaTotal,
			startAt: body?.start_at ?? null,
			endAt: body?.end_at ?? null,
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

		// 获取广告信息
		const adRow = await getAdById(c.env.DB, adId);
		if (!adRow) return jsonError(c, 404, "NOT_FOUND", "Ad not found");
		if (adRow.status !== "ACTIVE") {
			return jsonError(c, 400, "AD_NOT_ACTIVE", "Ad is not active");
		}
		if (adRow.quota_used >= adRow.quota_total) {
			return jsonError(c, 400, "QUOTA_FULL", "Ad quota is full");
		}

		// 检查是否已经领取过
		const existingClaim = await getExistingClaim(c.env.DB, adId, bXId);
		if (existingClaim) return c.json(existingClaim);

		// 增加配额
		const quotaIncremented = await incrementAdQuota(c.env.DB, adId);
		if (!quotaIncremented) {
			return jsonError(c, 400, "QUOTA_FULL", "Ad quota is full or inactive");
		}

		// 创建领取记录
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
 * 注册广告相关路由
 */
export function registerAdsRoutes(app: Hono<ExtendedEnv>) {
	app.get("/ads/balance", apiAdsBalance);
	app.post("/ads/create", apiAdsCreate);
	app.get("/ads/my_ads", apiAdsMyAds);
	app.get("/ads/list", apiAdsList);
	app.post("/ads/claim", apiAdsClaim);
	app.get("/ads/my_claims", apiAdsMyClaims);
}

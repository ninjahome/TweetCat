import {Hono} from "hono";
import {ExtCtx, ExtendedEnv, jsonError, requireStringField, parsePositiveInt, parsePositiveAtomic} from "./common";

export async function apiAdsBalance(c: ExtCtx) {
	try {
		const aXId = c.req.query("a_x_id");
		if (!aXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		const stmt = c.env.DB.prepare(
			"SELECT a_x_id, asset_symbol, balance_atomic FROM ad_account WHERE a_x_id = ?"
		).bind(aXId);
		const row = await stmt.first<{a_x_id: string; asset_symbol: string; balance_atomic: string}>();
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

		const updateSql = `
			UPDATE ad_account
			SET balance_atomic = CAST(balance_atomic AS INTEGER) - ?,
				updated_at = datetime('now')
			WHERE a_x_id = ?
			  AND CAST(balance_atomic AS INTEGER) >= ?
		`;
		const updateResult = await c.env.DB.prepare(updateSql)
			.bind(requiredAtomic, aXId, requiredAtomic)
			.run();

		if (!updateResult.success || updateResult.meta.changes === 0) {
			const balanceRow = await c.env.DB.prepare(
				"SELECT balance_atomic FROM ad_account WHERE a_x_id = ?"
			).bind(aXId).first<{balance_atomic: string}>();
			const current = balanceRow?.balance_atomic ?? "0";
			return jsonError(
				c,
				400,
				"INSUFFICIENT_BALANCE",
				`Required ${requiredAtomic}, current ${current}.`
			);
		}

		const adId = crypto.randomUUID();
		const insertSql = `
			INSERT INTO ads (
				ad_id, a_x_id, ad_type, category, name, title, description, detail_url,
				unit_price_atomic, quota_total, start_at, end_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;
		await c.env.DB.prepare(insertSql)
			.bind(
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
				body?.start_at ?? null,
				body?.end_at ?? null
			)
			.run();

		return c.json({ok: true, ad_id: adId, required_atomic: requiredAtomic});
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

export async function apiAdsMyAds(c: ExtCtx) {
	try {
		const aXId = c.req.query("a_x_id");
		if (!aXId) return jsonError(c, 400, "INVALID_REQUEST", "Missing a_x_id");

		const stmt = c.env.DB.prepare(
			"SELECT * FROM ads WHERE a_x_id = ? ORDER BY created_at DESC LIMIT 200"
		).bind(aXId);
		const result = await stmt.all();
		return c.json(result.results ?? []);
	} catch (err: any) {
		return jsonError(c, 500, "INTERNAL_ERROR", err?.message || "Internal Server Error");
	}
}

/**
 * 保留 registerAdsRoutes 函数用于向后兼容
 * 使用导出的处理器函数来注册路由
 */
export function registerAdsRoutes(app: Hono<ExtendedEnv>) {
	app.get("/ads/balance", apiAdsBalance);
	app.post("/ads/create", apiAdsCreate);
	app.get("/ads/my_ads", apiAdsMyAds);
}

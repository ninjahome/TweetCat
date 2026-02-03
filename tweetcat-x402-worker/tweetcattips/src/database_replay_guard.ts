import type {ContentfulStatusCode} from "hono/utils/http-status";

export type ReplayInsertResult =
	| {ok: true}
	| {ok: false; status: ContentfulStatusCode; code: string; detail: string};

export async function insertReplayGuardOrError(
	db: D1Database,
	params: {jkt: string; jti: string; iat: number; expiresAt: number}
): Promise<ReplayInsertResult> {
	try {
		await db.prepare(
			"INSERT INTO replay_guard (jkt, jti, iat, expires_at) VALUES (?, ?, ?, ?)"
		).bind(params.jkt, params.jti, params.iat, params.expiresAt).run();
		return {ok: true};
	} catch (e: any) {
		const msg = String(e?.message || e);
		if (msg.includes("UNIQUE constraint failed") && msg.includes("replay_guard")) {
			return {ok: false, status: 409, code: "REPLAY_DETECTED", detail: "Replay detected"};
		}
		console.error("[replay_guard] insert error", msg);
		return {ok: false, status: 500, code: "REPLAY_GUARD_ERROR", detail: "Replay guard error"};
	}
}

export async function deleteExpiredReplayGuards(db: D1Database, nowSec: number): Promise<void> {
	await db.prepare("DELETE FROM replay_guard WHERE expires_at < ?").bind(nowSec).run();
}

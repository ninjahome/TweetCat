import {TipMode} from "./common";

export async function getKolBinding(db: D1Database, xId: string): Promise<string | null> {
	const stmt = db.prepare("SELECT wallet_address FROM kol_binding WHERE x_id = ?").bind(xId);
	const row = await stmt.first<{ wallet_address: string }>();
	return row?.wallet_address ?? null;
}

export interface TipRecord {
	xId: string;
	mode: TipMode;
	amountAtomic: string;
	payer: string;
	txHash: string;
}

export async function recordEscrowTips(db: D1Database, params: TipRecord): Promise<string> {
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO tips (id, x_id, mode, amount_atomic, payer, tx_hash, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
		)
		.bind(
			id,
			params.xId,
			params.mode,
			params.amountAtomic,
			params.payer,
			params.txHash,
			"pending"
		)
		.run();

	return id
}

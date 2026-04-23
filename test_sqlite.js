const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec("CREATE TABLE ad_escrow_accounts (a_x_id TEXT, asset_symbol TEXT, available_atomic TEXT, frozen_atomic TEXT);");
db.exec("INSERT INTO ad_escrow_accounts VALUES ('123', 'USDC', '20000', '1000');");
const stmt = db.prepare(`
    UPDATE ad_escrow_accounts
    SET available_atomic = CAST(available_atomic AS INTEGER) - ?,
        frozen_atomic = CAST(frozen_atomic AS INTEGER) + ?
    WHERE a_x_id = ?
      AND asset_symbol = 'USDC'
      AND CAST(available_atomic AS INTEGER) >= CAST(? AS INTEGER)
`);
const result = stmt.run('19000', '19000', '123', '19000');
console.log("Changes:", result.changes);
const row = db.prepare("SELECT * FROM ad_escrow_accounts").get();
console.log(row);

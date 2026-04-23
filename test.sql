CREATE TABLE ad_escrow_accounts (a_x_id TEXT, asset_symbol TEXT, available_atomic TEXT, frozen_atomic TEXT);
INSERT INTO ad_escrow_accounts VALUES ('123', 'USDC', '20000', '1000');
.headers on
.mode column
SELECT * FROM ad_escrow_accounts;

UPDATE ad_escrow_accounts
SET available_atomic = CAST(available_atomic AS INTEGER) - '19000',
    frozen_atomic = CAST(frozen_atomic AS INTEGER) + '19000'
WHERE a_x_id = '123'
  AND asset_symbol = 'USDC'
  AND CAST(available_atomic AS INTEGER) >= CAST('19000' AS INTEGER);

SELECT * FROM ad_escrow_accounts;

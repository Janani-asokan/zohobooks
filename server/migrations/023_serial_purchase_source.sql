-- 023: where each serial / IMEI number came from, for warranty and returns to the vendor. Serial numbers entered on a
-- purchase bill or while receiving a purchase order now remember that bill or order and the date the unit came in.
-- Columns are nullable additions only: serials registered before this (by hand, from opening stock) keep no source.
ALTER TABLE item_serials ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES bills(id) ON DELETE RESTRICT;
ALTER TABLE item_serials ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE item_serials ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors(id) ON DELETE RESTRICT;
ALTER TABLE item_serials ADD COLUMN IF NOT EXISTS received_on date;
CREATE INDEX IF NOT EXISTS item_serials_bill_id_idx ON item_serials (bill_id);
CREATE INDEX IF NOT EXISTS item_serials_purchase_order_id_idx ON item_serials (purchase_order_id);
CREATE INDEX IF NOT EXISTS item_serials_vendor_id_idx ON item_serials (vendor_id);
-- A serial / IMEI belongs to one unit in the whole shop: looked up shop-wide when one is entered.
CREATE INDEX IF NOT EXISTS item_serials_shop_serial_idx ON item_serials (shop_id, serial);

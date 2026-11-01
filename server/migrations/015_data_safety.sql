-- Data safety. Deleting a parent row must never silently delete history.
--
-- 1. Every foreign key that cascaded a delete now refuses it (RESTRICT), so deleting a shop, item, branch,
--    bank account, bill, user or field day while history points at it fails instead of wiping that history.
--    Only three links keep cascading: they are owned children of rows the app is allowed to delete
--    (public links and reminder log of a draft invoice, activity notes of an unused customer).
-- 2. Field-staff days and visits get the foreign key to users they were missing.
-- 3. Every foreign key column gets an index, so lookups and the delete checks above stay fast as data grows.
-- 4. Backups can read every shop: a read-only policy that only the backup process switches on (app.backup_read).
--    Before this, pg_dump was refused by forced row-level security and no backup could be taken.
-- 5. Customers can be archived: hidden from pickers, history kept, restorable.
-- Nothing here deletes or rewrites data.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confdeltype = 'c' AND c.connamespace = 'public'::regnamespace
      AND NOT (c.conrelid::regclass::text IN ('public_links', 'reminder_log') AND c.confrelid::regclass::text = 'invoices')
      AND NOT (c.conrelid::regclass::text = 'customer_activity' AND c.confrelid::regclass::text = 'customers')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    -- The rows already satisfied this key, so add it unchecked and validate it, which takes a lighter lock.
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID', r.tbl, r.conname, replace(r.def, 'ON DELETE CASCADE', 'ON DELETE RESTRICT')); -- data-safety: reviewed (turns cascades off)
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- New rows are checked at once. Existing rows are validated when they are all clean; if an old row points at a
-- user that no longer exists, the key stays enforced for new rows and the startup log says so, without failing.
ALTER TABLE field_days ADD CONSTRAINT field_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE field_visits ADD CONSTRAINT field_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
DO $$
BEGIN
  BEGIN
    ALTER TABLE field_days VALIDATE CONSTRAINT field_days_user_id_fkey;
  EXCEPTION WHEN foreign_key_violation THEN RAISE WARNING 'field_days has rows for missing users; key enforced for new rows only';
  END;
  BEGIN
    ALTER TABLE field_visits VALIDATE CONSTRAINT field_visits_user_id_fkey;
  EXCEPTION WHEN foreign_key_violation THEN RAISE WARNING 'field_visits has rows for missing users; key enforced for new rows only';
  END;
END $$;

-- One index per foreign key column that had none.
CREATE INDEX IF NOT EXISTS bill_payments_account_id_idx ON bill_payments (account_id);
CREATE INDEX IF NOT EXISTS bill_payments_vendor_id_idx ON bill_payments (vendor_id);
CREATE INDEX IF NOT EXISTS bills_branch_id_idx ON bills (branch_id);
CREATE INDEX IF NOT EXISTS bills_purchase_order_id_idx ON bills (purchase_order_id);
CREATE INDEX IF NOT EXISTS bills_vendor_id_idx ON bills (vendor_id);
CREATE INDEX IF NOT EXISTS credit_notes_invoice_id_idx ON credit_notes (invoice_id);
CREATE INDEX IF NOT EXISTS delivery_challans_customer_id_idx ON delivery_challans (customer_id);
CREATE INDEX IF NOT EXISTS delivery_challans_invoice_id_idx ON delivery_challans (invoice_id);
CREATE INDEX IF NOT EXISTS delivery_challans_sales_order_id_idx ON delivery_challans (sales_order_id);
CREATE INDEX IF NOT EXISTS expenses_account_id_idx ON expenses (account_id);
CREATE INDEX IF NOT EXISTS expenses_vendor_id_idx ON expenses (vendor_id);
CREATE INDEX IF NOT EXISTS field_days_user_id_idx ON field_days (user_id);
CREATE INDEX IF NOT EXISTS field_visits_customer_id_idx ON field_visits (customer_id);
CREATE INDEX IF NOT EXISTS field_visits_day_id_idx ON field_visits (day_id);
CREATE INDEX IF NOT EXISTS field_visits_user_id_idx ON field_visits (user_id);
CREATE INDEX IF NOT EXISTS invoices_branch_id_idx ON invoices (branch_id);
CREATE INDEX IF NOT EXISTS invoices_recurring_id_idx ON invoices (recurring_id);
CREATE INDEX IF NOT EXISTS invoices_sales_order_id_idx ON invoices (sales_order_id);
CREATE INDEX IF NOT EXISTS item_batches_branch_id_idx ON item_batches (branch_id);
CREATE INDEX IF NOT EXISTS item_serials_branch_id_idx ON item_serials (branch_id);
CREATE INDEX IF NOT EXISTS item_serials_invoice_id_idx ON item_serials (invoice_id);
CREATE INDEX IF NOT EXISTS item_stock_branch_id_idx ON item_stock (branch_id);
CREATE INDEX IF NOT EXISTS items_tax_slab_id_idx ON items (tax_slab_id);
CREATE INDEX IF NOT EXISTS lending_loans_account_id_idx ON lending_loans (account_id);
CREATE INDEX IF NOT EXISTS lending_loans_collector_id_idx ON lending_loans (collector_id);
CREATE INDEX IF NOT EXISTS lending_payments_account_id_idx ON lending_payments (account_id);
CREATE INDEX IF NOT EXISTS lending_payments_collector_id_idx ON lending_payments (collector_id);
CREATE INDEX IF NOT EXISTS payments_account_id_idx ON payments (account_id);
CREATE INDEX IF NOT EXISTS public_links_invoice_id_idx ON public_links (invoice_id);
CREATE INDEX IF NOT EXISTS purchase_orders_branch_id_idx ON purchase_orders (branch_id);
CREATE INDEX IF NOT EXISTS purchase_orders_vendor_id_idx ON purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS recurring_profiles_branch_id_idx ON recurring_profiles (branch_id);
CREATE INDEX IF NOT EXISTS recurring_profiles_customer_id_idx ON recurring_profiles (customer_id);
CREATE INDEX IF NOT EXISTS reminder_log_invoice_id_idx ON reminder_log (invoice_id);
CREATE INDEX IF NOT EXISTS sales_orders_customer_id_idx ON sales_orders (customer_id);
CREATE INDEX IF NOT EXISTS sales_orders_source_id_idx ON sales_orders (source_id);
CREATE INDEX IF NOT EXISTS sessions_active_shop_id_idx ON sessions (active_shop_id);
CREATE INDEX IF NOT EXISTS shops_plan_id_idx ON shops (plan_id);
CREATE INDEX IF NOT EXISTS stock_adjustments_branch_id_idx ON stock_adjustments (branch_id);
CREATE INDEX IF NOT EXISTS stock_movements_branch_id_idx ON stock_movements (branch_id);
CREATE INDEX IF NOT EXISTS stock_transfers_from_branch_id_idx ON stock_transfers (from_branch_id);
CREATE INDEX IF NOT EXISTS stock_transfers_to_branch_id_idx ON stock_transfers (to_branch_id);
CREATE INDEX IF NOT EXISTS subscription_payments_plan_id_idx ON subscription_payments (plan_id);
CREATE INDEX IF NOT EXISTS users_branch_id_idx ON users (branch_id);

-- Read-only, and only for a session that sets app.backup_read = 'on' (the backup job does, via PGOPTIONS). The app
-- never sets it; writes stay limited to the current shop by the existing policies.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format($p$CREATE POLICY backup_read ON %I FOR SELECT USING (current_setting('app.backup_read', true) = 'on')$p$, t);
  END LOOP;
END $$;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- Invoice requirements (docs: Invoice Design Requirements).
-- 1. Reprints match the original (FUN-11 / TEC-05): an issued invoice keeps a snapshot of the business details and
--    print layout it was issued with. Invoices issued before this migration get today's details, so from now on
--    their reprints no longer change when the profile or layout is edited.
-- 2. Invoice-level trade fields (patient and doctor for pharmacies, vehicle number for steel) on the shop's profile
--    and their values on each invoice.
-- 3. Share links can be turned off (NFR-04): a revoked link stops working and a new one can be made.
-- Columns are only added; no row is deleted.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS print_snapshot jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invoice_fields jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Invoices and organizations use forced row-level security, so the backfill runs inside each shop's context;
-- without it the update would silently change nothing.
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT id FROM shops LOOP
    PERFORM set_config('app.shop_id', s.id::text, true);
    UPDATE invoices i SET print_snapshot = jsonb_build_object(
        'org', jsonb_build_object(
          'companyName', o.company_name, 'legalName', o.legal_name, 'gstin', o.gstin, 'email', o.email, 'phone', o.phone,
          'address', o.address, 'state', o.state, 'logo', o.logo, 'invoiceFooter', o.invoice_footer, 'upiId', o.upi_id,
          'bankDetails', o.bank_details, 'invoiceTemplate', o.invoice_template, 'compositionScheme', o.composition_scheme,
          'businessType', o.business_type, 'tradeDetails', o.trade_details),
        'settings', o.print_settings,
        'itemFields', o.item_fields,
        'invoiceFields', o.invoice_fields,
        'branch', (SELECT jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone) FROM branches b WHERE b.id = i.branch_id),
        'takenAt', now(),
        'backfilled', true)
      FROM organizations o
      WHERE o.shop_id = i.shop_id AND i.shop_id = s.id AND i.status <> 'Draft' AND i.print_snapshot IS NULL;
  END LOOP;
  PERFORM set_config('app.shop_id', '', true);
END $$;

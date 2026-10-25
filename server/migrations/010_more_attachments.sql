-- Files can be attached to stock documents, journals, payments and bank transactions too.
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_entity_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_check CHECK (entity IN (
  'invoice', 'bill', 'item', 'customer', 'vendor', 'expense', 'purchase_order', 'sales_order', 'credit_note',
  'stock_adjustment', 'stock_transfer', 'journal', 'payment', 'bill_payment', 'bank_transaction'
));

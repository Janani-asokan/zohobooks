-- 020: items added by a business template carried the note "Added from the business template. Check the price and GST
-- rate before billing." as their description, and descriptions print on receipts and invoices. Clear that exact note
-- only; any description the owner wrote or edited is left as it is. Issued invoices keep their saved lines unchanged.
DO $$ DECLARE s record; BEGIN
  FOR s IN SELECT id FROM shops LOOP
    PERFORM set_config('app.shop_id', s.id::text, true);
    UPDATE items SET description = ''
     WHERE shop_id = s.id AND description = 'Added from the business template. Check the price and GST rate before billing.';
  END LOOP;
END $$;

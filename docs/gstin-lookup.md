# GSTIN Validate and lookup

Every GST number box (customers, vendors, quick-add on bills, your organization, branches, invoice ship-to) has a
**Validate** button. Validation also runs by itself once all 15 characters are typed or pasted.

## Always on (free, offline)
- **Format and state:** the first two digits must be a real state code, and the state is filled in from them.
- **PAN inside the number:** shown with who holds it (company, firm, proprietor and so on).
- **Check digit:** the last character is a checksum of the first 14. A mismatch means a typo, and the person is
  asked to check the number. Saving is still allowed, so old records keep working.
- **Duplicates:** a warning appears if the GSTIN is already saved as a customer or vendor, or is your own.

## Name and address lookup (optional)
With a lookup service switched on, Validate also fills in:
- the **legal name**, with the trade name shown;
- the **registered address** and **state**;
- the **registration status**.

It fills only fields that are empty, so it never overwrites what someone typed. Cancelled or suspended numbers are
shown in red, with advice to bill the party as unregistered.

Any provider that returns the GST portal's taxpayer record works (fields `lgnm`, `tradeNam`, `sts`, `pradr`). Many
Indian GST API providers do, usually with a small free tier and paid packs.

Each number is looked up **once and kept for 30 days**, so cost stays very low. Numbers that fail the check digit are
never sent. Every call shows in **Super admin → Logs → API calls → GSTIN lookup**.

### Switch it on
In the droplet console:

```bash
sudo nano /opt/corpus360/.env
```

Add your provider's address. Put `{gstin}` where the number goes, and `{key}` if the key goes in the address:

```
GSTIN_LOOKUP_URL=https://provider.example/api/verifyGST?gstNo={gstin}&key_secret={key}
GSTIN_LOOKUP_KEY=your-key
```

If the provider wants the key in a header instead, leave `{key}` out of the address and set the header name, for
example `GSTIN_LOOKUP_KEY_HEADER=x-api-key`.

Then run:

```bash
corpus360-update --force
```

### Check that it works
Open **Customers → New Customer → Business**, then paste a real GSTIN. The green card should show the legal name
and address.

## Other gentle checks added with this
- **Email typos:** "Did you mean name@gmail.com?" under email fields (customers, vendors, sign-up) for common
  mistakes such as `gmial.com` or `.con`. One tap fixes it.
- **HSN / SAC codes:** items warn when the code isn't 4, 6 or 8 digits, when a service code doesn't start with 99, or
  when a goods code does.

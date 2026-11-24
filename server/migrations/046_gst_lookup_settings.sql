-- GST number lookup provider, set in Super admin → Configuration (instead of server environment variables):
-- {"url": "...{gstin}...", "method": "GET"|"POST", "headers": {"name": "value"}, "body": "...{gstin}..."}.
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS gst_lookup jsonb;

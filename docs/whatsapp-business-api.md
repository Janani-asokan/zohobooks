# WhatsApp Business API: support inbox

Messages that shops send to your support WhatsApp number arrive in **Super admin → Customer care → WhatsApp →
Inbox**, and agents reply from there. This uses Meta's **WhatsApp Cloud API**.

Until it is set up, the WhatsApp tab shows only the "WhatsApp us" taps, and the team replies from the WhatsApp
Business app.

## Before you start
- **The number moves to the API.** A number connected to the Cloud API can't stay in the WhatsApp Business app on a
  phone. Use a number dedicated to support, or accept that replies move into the console.
- **Cost:**
  - Replying within **24 hours** of the shop's last message is free (service conversations).
  - After 24 hours, WhatsApp only allows a pre-approved **template**, which Meta charges per message (a few rupees in
    India).
- **Meta needs a verified business**, through Meta Business verification. Start that first, because it can take a
  few days.

## Set up (once)

### 1. Create the Meta app
1. Go to **developers.facebook.com → My Apps → Create app**, choose type **Business**, and link it to your
   business portfolio.
2. Add the **WhatsApp** product.
3. Under **WhatsApp → API Setup**, add your support phone number and verify it with the code Meta sends.
4. Copy the **Phone number ID**. This is `WHATSAPP_PHONE_ID`.

### 2. Create a permanent token
1. Go to **business.facebook.com → Settings → Users → System users → Add**.
2. Add an Admin system user, then **Add assets** and give it your WhatsApp account (full control).
3. Choose **Generate new token**, pick the app, and select `whatsapp_business_messaging` and
   `whatsapp_business_management`.
4. Copy the token. This is `WHATSAPP_TOKEN`. The temporary token on the API Setup page expires in 24 hours, so don't
   use that one.

### 3. Get the app secret
Go to **App settings → Basic → App secret → Show** and copy it. This is `WHATSAPP_APP_SECRET`. It is what proves
incoming messages really come from Meta.

### 4. Add the settings to the server
In the DigitalOcean console (**Droplet → Access → Launch Droplet Console**), open the settings file:

```bash
sudo nano /opt/corpus360/.env
```

Add these lines, with your own values:

```
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_APP_SECRET=abc123...
WHATSAPP_VERIFY_TOKEN=pick-any-long-random-words
```

`WHATSAPP_VERIFY_TOKEN` is any secret phrase you make up. You type the same phrase into Meta in step 5.

Save the file (Ctrl+O, Enter, Ctrl+X), then run:

```bash
corpus360-update --force
```

### 5. Connect the webhook in Meta
1. Go to **WhatsApp → Configuration → Webhook → Edit** and enter:
   - **Callback URL:** `https://corpus360lite.com/api/webhooks/whatsapp`
   - **Verify token:** the same phrase as `WHATSAPP_VERIFY_TOKEN`
2. Click **Verify and save**. It only succeeds when the server has the settings from step 4.
3. Under **Webhook fields**, **Subscribe** to `messages`.

### 6. Optional: a template for after 24 hours
1. In **WhatsApp Manager → Message templates**, create a template, for example `support_followup`, category
   **Utility**, with a body such as: "Hi, this is Corpus360 support following up on your question. Reply here to
   continue."
2. Once Meta approves it, add these lines to the settings file and run `corpus360-update --force` again:

   ```
   WHATSAPP_TEMPLATE=support_followup
   WHATSAPP_TEMPLATE_LANG=en
   ```

## Check that it works
1. Open **Customer care → WhatsApp**. It should show **Inbox** and say when WhatsApp last reached the server.
2. From another phone, send a WhatsApp message to the support number. It appears in the Inbox within seconds,
   with a chime.
3. Reply from the console. Ticks show sent, delivered and read.
4. **Logs → API calls → WhatsApp** shows every call to Meta, and any error Meta returned.

## How it behaves
- **Shop matching:** each sender has one conversation. It is linked to a shop when the number is the shop's phone,
  or when the message contains the shop's name from the "WhatsApp us" pre-filled text (`Shop: …`).
- **Read receipts:** opening a conversation marks it read here and shows blue ticks to the shop.
- **Photos and documents** are fetched from WhatsApp when an agent opens them, and never stored on our server.
  Images, PDFs, audio and video open in the browser; anything else downloads as a file.
- **The 24-hour rule:** after 24 hours the reply box is replaced by **Send template**, or by advice to call if no
  template is set.
- **Security:**
  - Every webhook call must carry Meta's signature, made with the app secret, or it is refused.
  - Repeated deliveries are stored once.
  - Keys live only in `/opt/corpus360/.env`.

## Settings

| Setting | What it is |
|---|---|
| `WHATSAPP_TOKEN` | Permanent system-user token (step 2) |
| `WHATSAPP_PHONE_ID` | Phone number ID (step 1) |
| `WHATSAPP_APP_SECRET` | App secret (step 3). Without it every webhook call is refused |
| `WHATSAPP_VERIFY_TOKEN` | Your secret phrase for the webhook check (step 5) |
| `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | Approved template for after 24 hours (optional; language defaults to `en`) |
| `WHATSAPP_API_VERSION` | Graph API version (default `v21.0`) |

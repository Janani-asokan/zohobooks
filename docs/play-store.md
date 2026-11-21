# CorpusLite on Google Play: release checklist

App id `in.corpus360.lite`. Release 1.2.3 is versionCode 7. Every upload needs a higher versionCode
(`mobile/android/app/build.gradle`).

## Build

```bash
npm run build:app && (cd mobile && npx cap sync android)
cd mobile/android && ./gradlew bundleRelease assembleRelease   # signing from keystore.properties or CORPUSLITE_* env vars
```

Upload `app/build/outputs/bundle/release/app-release.aab`. The `.apk` is only for installing directly on a test phone.
Keep the upload key (`corpuslite-upload.jks` and its passwords) safe and out of Git. Play App Signing holds the
real signing key, so if the upload key is lost Google can reset it.

## What the app does to meet Play policy

| Rule | How it is met |
|---|---|
| Target API level | targetSdk 36, compileSdk 36, minSdk 24 |
| Account deletion (the app has sign-up) | Profile → My account → *Delete my login* / *Close this shop*, and the public page `/delete-account` |
| Privacy policy | Public page `/privacy`, linked from sign-in, sign-up and My account |
| Permissions | Only internet, network state, camera (scanning) and Bluetooth "Nearby devices" (receipt printer). No location, contacts, SMS, storage or microphone permissions |
| Data in transit | HTTPS only: `network_security_config.xml` turns off cleartext traffic and trusts only the system certificate authorities |
| Backups | `allowBackup=false` and `data_extraction_rules.xml` keep the sign-in token off cloud backups and phone-to-phone transfer |
| File sharing | The FileProvider shares only the app's own cache folder |
| Debugging | Release builds aren't debuggable, so WebView debugging is off |
| 16 KB page size | The app has no native `.so` libraries, so the rule doesn't apply |

## Play Console answers

- **Privacy policy URL:** `https://corpus360lite.com/privacy`
- **Delete account URL:** `https://corpus360lite.com/delete-account`
- **App access:** give reviewers a working login, for example a dedicated shop-owner login, under *App content → App access*.
- **Ads:** No ads.
- **Content rating:** Utility / productivity. No violence, gambling or user-to-user content apart from the support chat with staff.
- **Target audience:** 18 and over.
- **Data safety:**
  - *Collected:* name, email, phone (account management), and the business records users enter, such as customers' names and phone numbers on bills (app functionality).
  - *Not collected by the app:* location.
  - *Encrypted in transit:* yes.
  - *Users can ask for deletion:* yes.
  - *Shared with third parties:* no. The email provider, Razorpay and the AI provider are service providers acting for us, which Play does not count as sharing.
  - *Camera:* used on the phone only, not collected.
- **Financial features declaration:** the app is billing and accounting software. It does not lend money or hold funds, so choose "none of these". Microfinance is web-only and not in the app.
- **Store listing assets:** ready in `mobile/store-listing/` (6 phone screenshots 1080×1920, feature graphic 1024×500, icon 512×512). Rebuild with `node mobile/store-listing/compose.cjs <raw-dir> <out-dir> <repo>` from 390×780 @3x captures.
- **Originally required:**
  - 512×512 icon
  - 1024×500 feature graphic
  - at least 2 phone screenshots (sign-in, POS bill, items, invoice)
  - a short description of up to 80 characters
  - a full description of up to 4000 characters

## Before each release

1. Set the support email and phone in Customer care → Support hours. The privacy and delete-account pages show them.
2. Set up an email provider (Brevo or Resend) so that password-reset, OTP and shop-closed emails are delivered.
3. Run the tests and install the APK on a real phone. Check sign-in, a POS bill, printing, sharing a PDF, scanning a barcode and the back button.

# CorpusLite (Android and iOS)

The Corpus360 shop app for phones and tablets: POS, items and stock, customers, vendors, invoices, purchases and
bills, barcode labels and simple reports. Accounting, AI, field staff and microfinance stay on the website.

- **Works with no internet.** Every screen keeps the last copy of its data on the phone (IndexedDB) and opens with
  it offline. Bills made offline are kept on the phone and sent by themselves when the internet is back.
- **Its own GST invoice series.** Each phone registers once (online) and gets a code (A1, A2 … Z9). Its bills are
  numbered `A1/2026-27/0001`, `0002` … by the phone itself, so the final invoice number prints at the counter even
  offline. The server checks each number is used once; a new financial year starts the series again.
- **Small.** The app's web part is built from the same code with the web-only pages left out (`npm run build:app` in
  the repository root, about 2.4 MB), inside a Capacitor shell.
- **Signs in with a token** (`Authorization: Bearer …`), not a cookie; the server allows the app origins
  `capacitor://localhost` (iOS) and `https://localhost` (Android).

## Build

GitHub Actions (`.github/workflows/corpuslite.yml`) builds on every push: an Android APK to install directly, and an
iOS simulator build. Download them from the run's *Artifacts* on the Actions tab.

By hand (Node 22, JDK 21, Android SDK; Xcode on a Mac for iOS):

```
npm ci && npm run build:app             # repository root
cd mobile && npm ci && npx cap sync
cd android && ./gradlew assembleDebug   # mobile/android/app/build/outputs/apk/debug/app-debug.apk
npx cap open ios                        # on a Mac: build and run in Xcode
```

## Releasing to the stores (next step)

Google Play needs a Play developer account, a signing key and a service-account key; the App Store needs an Apple
Developer account and an App Store Connect API key. These go in the repository's GitHub secrets (never in the code),
then the workflow can sign and upload (`bundleRelease` for Play, an archive to TestFlight for iOS).

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
- **Prints like the website.** Print (receipts, A4/A5 invoices, labels, reports) opens the phone's print screen
  (Android printing / AirPrint) with the page at the paper's size. On Android, a paired **Bluetooth receipt printer**
  (58 or 80 mm, chosen once in Print settings → Receipt) prints straight away: the receipt is sent as a picture in
  ESC/POS, so Tamil/Hindi names, ₹, the logo and the UPI QR print as on screen.
- **Label printers without the print screen.** In Barcode & Labels → Send labels, a 2/3/4-inch label printer on
  Bluetooth (Android) or the shop's Wi-Fi (Android and iPhone, port 9100) gets the labels in its own language (TSPL,
  ZPL) with the exact label size and gap, so labels never come out sideways or fitted onto 4 × 6 in paper.
- **Files and links.** PDF, Excel and CSV downloads are saved on the phone and offered to WhatsApp, Drive, Files…;
  WhatsApp, maps, phone and UPI links open in the phone's apps; shared bill links point to the website.
- **Fits the phone.** Keeps clear of the status bar, notch and home bar; the phone's big-font setting doesn't break
  the layout; Back goes to the previous screen.
- **Signs in with a token** (`Authorization: Bearer …`), not a cookie; the server allows the app origins
  `capacitor://localhost` (iOS) and `https://localhost` (Android).

The native part is one small plugin, `C360Native` (`android/…/C360NativePlugin.java`, `ios/App/App/C360Native.swift`),
used from `src/lib/native.ts` and `src/lib/btPrinter.ts`. Checks: `e2e/tools/corpuslite-native.mjs`.

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

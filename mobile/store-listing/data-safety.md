# CorpusLite: Play Console Data safety answers

Checked against the code on 21 Nov 2026 (app 1.2.1). If the app starts collecting something new, such as location,
analytics or crash reports, update this form and `/privacy` before release.

## 1. Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes**. HTTPS only, and cleartext traffic is off in `network_security_config.xml`. |
| Which ways do you provide for users to request that their data is deleted? | **In the app** (My account → Delete my login / Close this shop) **and on the web**: `https://corpus360lite.com/delete-account` |
| Does your app share data with third parties? | **No** (see the note on service providers below) |

**Service providers are not "sharing".** Play does not count data sent to a provider that processes it for you under your
instructions as sharing. Those providers are:

- your hosting provider;
- Brevo or Resend, for email;
- Anthropic, when someone uses the AI assistant, the help bot's AI answers, or reads a supplier bill from a photo.

The only other case is data handed over when the law requires it, which Play also exempts.

## 2. Data types

Every data type below has the same three answers:

- **Shared:** No
- **Processed ephemerally:** No. It is stored on our server.
- **Encrypted in transit:** Yes

### Personal info

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **Name** | Yes | Required | App functionality, Account management |
| **Email address** | Yes | Required | App functionality, Account management, Developer communications |
| **User IDs** | Yes | Required | App functionality, Account management, Fraud prevention, security and compliance |
| **Address** | Yes | Optional | App functionality |
| **Phone number** | Yes | Required | App functionality, Account management |
| **Race and ethnicity, Political or religious beliefs, Sexual orientation** | No | | |
| **Other info** | Yes | Optional | App functionality |

Notes on personal info:

- **Name:** the user's own name, and the names of customers and suppliers they put on bills.
- **Email address:** sign-in, password reset, licence and shop-closed emails, plus customer and supplier emails entered on bills.
- **User IDs:** the account ID.
- **Address:** shop, customer and supplier addresses printed on invoices.
- **Phone number:** the shop's phone number is required at sign-up. Customer and supplier phone numbers are entered on bills.
- **Other info:** GSTIN and business details.

### Financial info

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **User payment info** | No | | |
| **Purchase history** | No | | |
| **Credit score** | No | | |
| **Other financial info** | Yes | Optional | App functionality |

- **User payment info:** the app never takes card or bank details. Plan payments go through Razorpay on the website, not in the app.
- **Purchase history:** these are not purchases the user makes in the app.
- **Other financial info:** the shop's bills, payments received and made, expenses and accounts.

### Location

| Data type | Collected |
|---|---|
| Approximate location | **No** |
| Precise location | **No** |

The app has no location permission. Field-staff location tracking exists only on the website.

### Messages

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **Emails** | No | | |
| **SMS or MMS** | No | | |
| **Other in-app messages** | Yes | Optional | App functionality |

Other in-app messages are support chat messages, help-bot questions and call-back requests.

### Photos and videos

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **Photos** | Yes | Optional | App functionality |
| **Videos** | No | | |

- **Photos collected:** item pictures, the shop logo, and supplier bill photos that the user chooses to upload.
- **Barcode scanning:** camera frames stay on the phone. Only the number read from the code is used.

### Audio

All audio types: **No**. There is no microphone permission, and voice input is hidden in the app.

### Files and docs

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **Files and docs** | Yes | Optional | App functionality |

Files and docs are attachments on bills and expenses, and CSV or Excel imports of items and customers.

### Calendar, Contacts, Health and fitness, Web browsing, Installed apps

All: **No**. The app does not read device contacts or the calendar.

### App activity

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **App interactions** | Yes | Required | App functionality, Fraud prevention, security and compliance |
| **In-app search history** | No | | |
| **Installed apps** | No | | |
| **Other user-generated content** | Yes | Optional | App functionality |
| **Other actions** | No | | |

- **App interactions:** the audit trail, which records who created or changed what and when, so the shop owner can see it.
- **Other user-generated content:** items, customers, notes and other records the shop enters.

### App info and performance

All: **No**. There are no crash reporting, diagnostics or analytics SDKs.

### Device or other IDs

| Data type | Collected | Required or optional | Purposes |
|---|---|---|---|
| **Device or other IDs** | Yes | Required | App functionality, Fraud prevention, security and compliance |

There are two kinds of ID:

- **A random ID the app makes for this phone.** It gives the phone its own invoice series (A1/2026-27/0001), so bills can be numbered offline.
- **The device and browser description saved with each sign-in.** This is used for security.

The app collects no advertising ID, Android ID or IMEI from the phone. IMEIs that a shop enters as product serial
numbers are business records, not device IDs.

## 3. Other Play Console declarations

- **Ads:** No
- **Target audience:** 18 and over
- **Data deletion URL:** `https://corpus360lite.com/delete-account`
- **Privacy policy URL:** `https://corpus360lite.com/privacy`
- **Account creation:** Yes, the app can create accounts (sign-up), and deletion is available in the app and on the web
- **Independent security review:** No
- **Committed to Play Families Policy:** Not applicable (not for children)

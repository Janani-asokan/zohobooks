/**
 * Daily test report: runs every automated test (or reads a vitest JSON result) and writes an Excel workbook:
 *   Summary     – date, totals, and each feature with its pass / fail count
 *   Test cases  – every test case: feature, group, what it checks, Pass / Fail, time, the reason when it failed
 *   History     – one row per day, from reports/history.csv (kept between runs)
 * Usage: node scripts/test-report.mjs [results.json] [outDir]
 * Runs every day on GitHub (.github/workflows/tests.yml); the workbook is kept on the test-reports branch.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { buildWorkbook } from '../shared/xlsx.ts';

const FEATURES = {
  accountDeletion: 'Close account / delete data', accounting: 'Accounting (ledger, journals, P&L)', addons: 'Add-ons & pricing', aiUsage: 'AI credits', appDownloads: 'App downloads on the website',
  attendance: 'Staff attendance', auth: 'Sign in & sessions', badInput: 'Bad input handling', bank: 'Banking', barcode: 'Barcodes', billing: 'Plans & billing', briefing: 'Daily briefing', btPrinter: 'Bluetooth printer',
  BusinessPicker: 'Multiple businesses', calc: 'Bill calculations (GST, discounts)', columnMap: 'Import: column matching', contact: 'Email & phone checks', dashboardAddons: 'Dashboard', extract: 'Photo to bill (AI OCR)',
  features: 'Feature switches', field: 'Field staff tracking', files: 'Attachments', gst: 'GST rules', gstAccuracy: 'GST returns accuracy (GSTR-1, 3B)', gstin: 'GSTIN Validate & lookup', imei: 'IMEI / serial numbers',
  imeiAndPhones: 'Phones with IMEI', insights: 'Insights', inventory: 'Inventory & stock', inventoryOnboarding: 'Stock onboarding', invoicePrint: 'Invoice printing', invoiceRequirements: 'Invoice rules',
  invoices: 'Invoices', labelDirect: 'Label printing (direct)', labelEngine: 'Label engine', labelFit: 'Label layout fit', labelLayout: 'Label layout', labelPage: 'Label sheets', labelsApi: 'Labels', licenses: 'Warehouse licences',
  looseItems: 'Loose items by weight', mail: 'Email sending', match: 'Item matching', net: 'Connection (weak / offline)', ocr: 'OCR', offers: 'Offers', offersLoyalty: 'Offers & loyalty', offlinePos: 'Offline counter billing',
  offlineWrites: 'Offline invoices, payments & edits', orgProfile: 'Business profile', outboundLogs: 'Email & API logs', payables: 'Payables', phone: 'Phone numbers', posCounter: 'Counter billing (POS)', print: 'Printing',
  printerProfiles: 'Printer profiles', purchasing: 'Purchases', reportShare: 'Reports: PDF, Excel, CSV, email, WhatsApp', sales: 'Sales', salesHelp: 'Sales leads & help desk', schema: 'Database rules & backups',
  signup: 'Sign up', signupVerify: 'Sign-up email verification', superAdminGuard: 'Super admin security', support: 'Customer support', supportBot: 'Help bot', supportWhatsapp: 'WhatsApp support',
  tally: 'Tally export / import', templates: 'Business templates', tenancy: 'Shop data separation', transfers: 'Stock transfers', units: 'Units & quantities', vendorContact: 'Supplier contacts',
  voiceParse: 'Voice billing', whatsappCloud: 'WhatsApp Cloud inbox', xlsxRead: 'Excel import',
};
const feature = (file) => { const b = path.basename(file).replace(/\.test\.tsx?$/, ''); return FEATURES[b] ?? b.replace(/([a-z])([A-Z])/g, '$1 $2'); };

const outDir = process.argv[3] ?? 'reports';
let resultsFile = process.argv[2];
if (!resultsFile) {
  resultsFile = path.join(outDir, 'results.json');
  fs.mkdirSync(outDir, { recursive: true });
  try { execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${resultsFile}`], { stdio: 'inherit' }); } catch { /* failures are in the report */ }
}
const r = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const now = new Date();
const ist = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const istTime = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(d);
const date = ist(now);
let commit = process.env.GITHUB_SHA ?? '';
try { commit ||= execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(); } catch { /* */ }

const cases = [];
for (const f of r.testResults) {
  for (const t of f.assertionResults) {
    cases.push({ feature: feature(f.name), file: path.relative(process.cwd(), f.name), group: t.ancestorTitles.join(' › '), title: t.title,
      status: t.status === 'passed' ? 'Pass' : t.status === 'failed' ? 'Fail' : 'Skipped', ms: Math.round(t.duration ?? 0),
      reason: (t.failureMessages ?? []).join(' ').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 300) });
  }
}
const total = cases.length, passed = cases.filter((c) => c.status === 'Pass').length, failed = cases.filter((c) => c.status === 'Fail').length, skipped = total - passed - failed;
const byFeature = new Map();
for (const c of cases) { const x = byFeature.get(c.feature) ?? { n: 0, p: 0, f: 0 }; x.n++; if (c.status === 'Pass') x.p++; if (c.status === 'Fail') x.f++; byFeature.set(c.feature, x); }

// History: one row per day (the latest run of the day wins).
fs.mkdirSync(outDir, { recursive: true });
const histFile = path.join(outDir, 'history.csv');
const hist = fs.existsSync(histFile) ? fs.readFileSync(histFile, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')) : [];
const keep = hist.filter((h) => h[0] !== date);
keep.push([date, istTime(now), String(total), String(passed), String(failed), String(skipped), String(byFeature.size), commit.slice(0, 7)]);
keep.sort((a, b) => a[0].localeCompare(b[0]));
fs.writeFileSync(histFile, ['date,time,total,passed,failed,skipped,features,commit', ...keep.map((h) => h.join(','))].join('\n') + '\n');

const book = buildWorkbook([
  { name: 'Summary', title: [`Corpus360 automated test report · ${date} ${istTime(now)} IST`, `${passed} of ${total} test cases passed${failed ? `, ${failed} FAILED` : ''} · ${byFeature.size} features · version ${commit.slice(0, 7)}`],
    columns: [{ label: 'Feature', width: 44 }, { label: 'Test cases', money: false }, { label: 'Passed', money: false }, { label: 'Failed', money: false }, { label: 'Status', width: 12 }],
    rows: [...[...byFeature.entries()].sort((a, b) => b[1].f - a[1].f || a[0].localeCompare(b[0])).map(([k, v]) => ({ cells: [k, v.n, v.p, v.f, v.f ? 'FAIL' : 'Pass'], bold: v.f > 0 })),
      { cells: ['All features', total, passed, failed, failed ? 'FAIL' : 'Pass'], bold: true }] },
  { name: 'Test cases', title: [`Every test case · ${date}`],
    columns: [{ label: 'Date', width: 12 }, { label: 'Feature', width: 36 }, { label: 'Group', width: 40 }, { label: 'What it checks', width: 80 }, { label: 'Result', width: 9 }, { label: 'Time (ms)', money: false }, { label: 'Why it failed', width: 60 }, { label: 'Test file', width: 34 }],
    rows: cases.map((c) => ({ cells: [date, c.feature, c.group, c.title, c.status, c.ms, c.reason, c.file], bold: c.status === 'Fail' })) },
  { name: 'History', title: ['Every day’s run'],
    columns: [{ label: 'Date', width: 12 }, { label: 'Time (IST)', width: 11 }, { label: 'Test cases', money: false }, { label: 'Passed', money: false }, { label: 'Failed', money: false }, { label: 'Skipped', money: false }, { label: 'Features', money: false }, { label: 'Version', width: 10 }],
    rows: [...keep].reverse().map((h) => ({ cells: [h[0], h[1], Number(h[2]), Number(h[3]), Number(h[4]), Number(h[5]), Number(h[6]), h[7]], bold: Number(h[4]) > 0 })) },
]);
const file = path.join(outDir, `test-report-${date}.xlsx`);
fs.writeFileSync(file, book);
fs.copyFileSync(file, path.join(outDir, 'latest.xlsx'));
console.log(`${file}: ${passed}/${total} passed, ${failed} failed, ${byFeature.size} features`);
if (failed) process.exitCode = 1;

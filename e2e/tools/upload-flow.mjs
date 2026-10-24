// Dev check: open a page, upload a file into the "Fill from a PDF or photo" box, screenshot the review and the filled form.
// Usage: node e2e/tools/upload-flow.mjs <route> <file> <outPrefix> [openSelector]
import { chromium } from 'playwright';
const [route, file, out, openSel] = process.argv.slice(2);
const B = 'http://localhost:5173';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(B + '/login'); await p.fill('input[type=email]', 'owner@shop.com'); await p.fill('input[type=password]', 'owner123'); await p.keyboard.press('Enter'); await p.waitForURL(/app/);
await p.goto(B + route); await p.waitForTimeout(1200);
if (openSel) { await p.click(openSel); await p.waitForTimeout(500); }
await p.locator('.smart-upload input[type=file]').first().setInputFiles(file);
await p.waitForSelector('text=Check what we read', { timeout: 30000 });
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}-review.png` });
await p.click('button:has-text("Fill the form")');
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}-filled.png`, fullPage: true });
console.log(errs.join('\n') || 'no errors');
await b.close();

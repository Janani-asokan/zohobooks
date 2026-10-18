// Dev helper: screenshot a list of routes as the demo owner. Usage: node e2e/tools/shots.mjs <outDir> <route>[=name] ...
import { chromium } from 'playwright';
const [out, ...routes] = process.argv.slice(2);
const B = process.env.BASE ?? 'http://localhost:5173';
const dark = process.env.DARK === '1';
const width = Number(process.env.W ?? 1440), height = Number(process.env.H ?? 900);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
p.on('console', (m) => m.type() === 'error' && !/401|Failed to load resource/.test(m.text()) && errors.push('console ' + m.text()));
await p.goto(B + '/login');
if (dark) await p.evaluate(() => localStorage.setItem('ledgerly.theme', 'dark'));
await p.fill('input[type=email]', process.env.EMAIL ?? 'owner@shop.com'); await p.fill('input[type=password]', process.env.PASS ?? 'owner123'); await p.keyboard.press('Enter');
await p.waitForURL(/\/(app|super-admin)/); await p.waitForTimeout(1200);
for (const r of routes) {
  const [route, name] = r.split('=');
  await p.goto(B + route); await p.waitForTimeout(Number(process.env.WAIT ?? 1500));
  await p.screenshot({ path: `${out}/${name ?? route.replace(/\W+/g, '_')}.png`, fullPage: process.env.FULL === '1' });
}
console.log(errors.join('\n') || 'no errors');
await b.close();

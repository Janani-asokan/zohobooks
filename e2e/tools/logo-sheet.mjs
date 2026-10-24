// Dev helper: render the brand SVGs at several sizes. Usage: node e2e/tools/logo-sheet.mjs out.png
import fs from 'node:fs';
import { chromium } from 'playwright';
const svg = (f) => fs.readFileSync(f, 'utf8');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 420 } });
await p.setContent(`<body style="margin:0;padding:30px;font-family:sans-serif;display:grid;gap:28px">
<div style="display:flex;gap:40px;align-items:center"><div style="height:120px">${svg('public/brand/corpus360-lockup.svg').replace('<svg', '<svg height="120"')}</div></div>
<div style="display:flex;gap:40px;align-items:center">
 <div style="height:20px">${svg('public/brand/corpus360-lockup.svg').replace('<svg', '<svg height="20"')}</div>
 <div style="width:16px">${svg('public/favicon.svg').replace('<svg', '<svg width="16"')}</div>
 <div style="width:32px">${svg('public/favicon.svg').replace('<svg', '<svg width="32"')}</div>
 <div style="width:96px">${svg('public/icon.svg').replace('<svg', '<svg width="96"')}</div>
 <div style="background:#0f1217;padding:12px;color:#9ab9e3"><div style="height:24px">${svg('public/brand/corpus360-lockup.svg').replace(/#1F3A5F/g, '#9ab9e3').replace('<svg', '<svg height="24"')}</div></div>
</div></body>`);
await p.screenshot({ path: process.argv[2] }); await b.close();

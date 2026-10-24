// Dev helper: render a product label to PNG (for OCR checks). Usage: node e2e/tools/label-image.mjs out.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 700, height: 420 } });
await p.setContent(`<div style="font:28px Arial;padding:30px;line-height:1.5;transform:rotate(-1deg)">
<b>Product Name: Boat Rockerz 450</b><br>Brand: boAt<br>HSN: 8518<br>MRP: Rs. 3,990<br>Selling Price: 1,499<br>GST 18%</div>`);
await p.screenshot({ path: process.argv[2] }); await b.close();

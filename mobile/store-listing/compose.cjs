// Builds the Play Store phone screenshots (1080x1920) and the feature graphic (1024x500) from raw captures.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [RAW, OUT, REPO] = process.argv.slice(2);
const b64 = (f) => 'data:font/woff2;base64,' + fs.readFileSync(f).toString('base64');
const font = (w) => b64(`${REPO}/node_modules/@fontsource/poppins/files/poppins-latin-${w}-normal.woff2`);
const inter = (w) => b64(`${REPO}/node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`);
const MARK = `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M20.21 9.80 A8.5 8.5 0 1 1 14.20 3.79" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M7.6 11.6 11.4 15.4 21 5.8" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>`;
const base = `
@font-face { font-family: Pop; src: url(${font(600)}); font-weight: 600; }
@font-face { font-family: Pop; src: url(${font(700)}); font-weight: 700; }
@font-face { font-family: Int; src: url(${inter(500)}); font-weight: 500; }
* { box-sizing: border-box; margin: 0; }
body { width: __W__; height: __H__; overflow: hidden; color: #fff;
  background: radial-gradient(110% 60% at 85% 0%, rgba(209,151,131,.38) 0%, rgba(209,151,131,0) 60%), linear-gradient(165deg, #5a1611 0%, #330000 70%); }
`;

const shots = [
  ['pos-a', 'Bill in seconds', 'Tap or scan items. Stock and GST are worked out for you.'],
  ['pos-b', 'Cash, UPI, card or split', 'Take payment your way, with change worked out.'],
  ['inv-view', 'Proper GST invoices', 'CGST, SGST or IGST picked from the place of supply.'],
  ['home', 'Your shop at a glance', 'Collections, cash coming in and stock health.'],
  ['stock', 'Stock in every branch', 'Stock value, low stock and transfers in transit.'],
  ['help', 'Help inside the app', 'Ask the help bot, or talk to a person when you need one.'],
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  let i = 1;
  for (const [raw, title, sub] of shots) {
    const img = 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, raw + '.png')).toString('base64');
    await p.setContent(`<html><style>${base.replace('__W__', '1080px').replace('__H__', '1920px')}
      .cap { position: absolute; top: 110px; left: 80px; right: 80px; text-align: center; }
      h1 { font: 700 76px/1.12 Pop; letter-spacing: -0.5px; }
      p { font: 500 38px/1.4 Int; color: #f1d3c7; margin-top: 22px; }
      .phone { position: absolute; left: 50%; top: 470px; width: 760px; transform: translateX(-50%); border-radius: 64px; padding: 18px;
        background: #140404; box-shadow: 0 40px 90px rgba(0,0,0,.45); }
      .phone img { display: block; width: 100%; border-radius: 48px; }
    </style><body><div class="cap"><h1>${title}</h1><p>${sub}</p></div><div class="phone"><img src="${img}"></div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    const name = `${OUT}/screenshot-${i++}-${raw}.png`;
    await p.screenshot({ path: name });
    console.log(name);
  }

  // Feature graphic: 1024x500, no transparency.
  await p.setViewportSize({ width: 1024, height: 500 });
  const a = 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, 'pos-a.png')).toString('base64');
  const c = 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, 'inv-view.png')).toString('base64');
  await p.setContent(`<html><style>${base.replace('__W__', '1024px').replace('__H__', '500px')}
    .l { position: absolute; left: 60px; top: 0; bottom: 0; width: 500px; display: flex; flex-direction: column; justify-content: center; }
    .brand { display: flex; align-items: center; gap: 16px; }
    .mark { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, #330000, #5a1611); border: 1.5px solid rgba(209,151,131,.6); color: #d19783; padding: 9px; }
    .name { font: 700 52px/1 Pop; letter-spacing: -0.5px; }
    h1 { font: 600 38px/1.2 Pop; margin-top: 30px; }
    p { font: 500 21px/1.45 Int; color: #f1d3c7; margin-top: 14px; }
    .ph { position: absolute; width: 230px; border-radius: 30px; padding: 8px; background: #140404; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
    .ph img { display: block; width: 100%; border-radius: 23px; }
    .p1 { left: 600px; top: 80px; transform: rotate(-6deg); }
    .p2 { left: 760px; top: 46px; transform: rotate(5deg); }
  </style><body>
    <div class="l"><div class="brand"><div class="mark">${MARK}</div><div class="name">CorpusLite</div></div>
      <h1>GST billing and stock for your shop</h1>
      <p>Bills, payments, items and branches. Works offline, prints on Bluetooth printers.</p></div>
    <div class="ph p1"><img src="${c}"></div><div class="ph p2"><img src="${a}"></div>
  </body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/feature-graphic-1024x500.png` });

  // App icon: 512x512, full square (Play rounds the corners itself).
  await p.setViewportSize({ width: 512, height: 512 });
  await p.setContent(`<html><style>* { margin: 0 } body { width: 512px; height: 512px; background: linear-gradient(135deg, #330000, #5a1611); display: grid; place-items: center; color: #d19783; }
    .m { width: 300px; height: 300px; }</style><body><div class="m">${MARK}</div></body></html>`);
  await p.screenshot({ path: `${OUT}/icon-512.png` });
  await b.close();
})();

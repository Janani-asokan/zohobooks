// Dev helper: write a simple text PDF. Usage: node e2e/tools/make-pdf.mjs out.pdf "line one" "line two" ...
import fs from 'node:fs';
const [out, ...lines] = process.argv.slice(2);
const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const stream = ['BT', '/F1 12 Tf', '16 TL', '50 790 Td', ...lines.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`), 'ET'].join('\n');
const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`];
let pdf = '%PDF-1.4\n'; const off = [];
objs.forEach((o, i) => { off.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const x = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
fs.writeFileSync(out, Buffer.from(pdf, 'latin1'));

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildXlsx, crc32 } from './xlsx';
import { readXlsx, xlsxToCsv } from './xlsxRead';

/** A ZIP with deflated entries, the way Excel saves a workbook. */
function deflatedZip(files: Array<[string, string]>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name); const raw = enc.encode(text); const data = new Uint8Array(deflateRawSync(raw)); const crc = crc32(raw);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 8, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, 8, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

describe('reading .xlsx item lists', () => {
  it('reads a workbook written by our own exporter', async () => {
    const x = buildXlsx({ name: 'Items', columns: [{ label: 'Name' }, { label: 'Price' }], rows: [{ cells: ['Teddy, big', 499] }, { cells: ['Ball "red"', 40.5] }] });
    expect(await readXlsx(x)).toEqual([['Name', 'Price'], ['Teddy, big', '499'], ['Ball "red"', '40.5']]);
    expect(await xlsxToCsv(x)).toBe('Name,Price\r\n"Teddy, big",499\r\n"Ball ""red""",40.5');
  });

  it('reads an Excel-style workbook: compressed, shared strings, numeric IMEIs kept whole, gaps and rich text', async () => {
    const shared = `<sst ${NS} count="5" uniqueCount="5"><si><t>Item name</t></si><si><t>IMEI</t></si><si><t>Price</t></si><si><r><t>Redmi </t></r><r><rPr><b/></rPr><t>Note 13 &amp; case</t></r><rPh><t>x</t></rPh></si><si><t xml:space="preserve"> Galaxy A15 </t></si></sst>`;
    const sheet = `<worksheet ${NS}><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>356789104512345</v></c><c r="D2"><v>17999</v></c></row>
      <row r="3"/>
      <row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="inlineStr"><is><t>359876543210987</t></is></c><c r="C4" t="b"><v>1</v></c><c r="D4" t="str"><f>D2-1000</f><v>16999</v></c></row>
    </sheetData></worksheet>`;
    const wb = `<workbook ${NS}><sheets><sheet name="Phones" sheetId="3" r:id="rId7"/></sheets></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="worksheet" Target="worksheets/sheet3.xml"/></Relationships>`;
    const file = deflatedZip([['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', rels], ['xl/sharedStrings.xml', shared], ['xl/worksheets/sheet3.xml', sheet]]);
    expect(await readXlsx(file)).toEqual([
      ['Item name', 'IMEI', '', 'Price'],
      ['Redmi Note 13 & case', '356789104512345', '', '17999'],
      [' Galaxy A15 ', '359876543210987', 'TRUE', '16999'],
    ]);
  });

  it('explains old .xls files and files that are not workbooks', async () => {
    await expect(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toThrow(/97–2003/);
    await expect(readXlsx(new TextEncoder().encode('name,price\nA,1'))).rejects.toThrow(/valid \.xlsx/);
  });
});

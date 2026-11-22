import type { Db } from '../db';
import { many } from '../db';
import { r2 } from '../../../shared/calc';
import { B2CL_THRESHOLD, isInterState, stateCode } from '../../../shared/gst';
import { getOrg } from './common';

const dmy = (iso: string) => iso.split('-').reverse().join('-');

export function periodRange(period: string) {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = new Date(y, m, 0).getDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${end}`, fp: `${String(m).padStart(2, '0')}${y}` };
}

interface RateRow { rt: number; txval: number; iamt: number; camt: number; samt: number }

/** Splits a document's lines into per-rate taxable values + tax heads. */
function byRate(lines: any[], withGst: boolean, inter: boolean, sign = 1): RateRow[] {
  const m = new Map<number, RateRow>();
  for (const l of lines) {
    const rt = withGst ? Number(l.taxRate) : 0;
    const row = m.get(rt) ?? { rt, txval: 0, iamt: 0, camt: 0, samt: 0 };
    const tx = Number(l.amount) * sign;
    const tax = (tx * rt) / 100;
    row.txval += tx;
    if (inter) row.iamt += tax;
    else { row.camt += tax / 2; row.samt += tax / 2; }
    m.set(rt, row);
  }
  return [...m.values()].map((r) => ({ rt: r.rt, txval: r2(r.txval), iamt: r2(r.iamt), camt: r2(r.camt), samt: r2(r.samt) }));
}

/**
 * HSN/SAC summary (GSTR-1 table 12): quantity, taxable value and tax per HSN and rate, net of credit notes
 * (returned goods reduce the quantity and value of the HSN they were sold under).
 */
function hsnRows(invoices: any[], credits: any[]) {
  const m = new Map<string, { hsn: string; description: string; unit: string; rate: number; qty: number; taxable: number; igst: number; cgst: number; sgst: number }>();
  const add = (lines: any[], withGst: boolean, inter: boolean, sign: number) => {
    for (const l of lines) {
      const rt = withGst ? Number(l.taxRate) : 0;
      const k = `${l.hsn || 'NA'}|${rt}`;
      const h = m.get(k) ?? { hsn: l.hsn || 'NA', description: l.name, unit: l.unit, rate: rt, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      const amt = Number(l.amount) * sign;
      const tax = (amt * rt) / 100;
      h.qty += Number(l.qty) * sign; h.taxable += amt;
      if (inter) h.igst += tax; else { h.cgst += tax / 2; h.sgst += tax / 2; }
      m.set(k, h);
    }
  };
  for (const inv of invoices) add(inv.lines, inv.with_gst, inv.inter_state, 1);
  for (const cn of credits) add(cn.lines, cn.with_gst, cn.inter_state, -1);
  return [...m.values()]
    .map((h) => ({ ...h, qty: Math.round(h.qty * 1000) / 1000, taxable: r2(h.taxable), igst: r2(h.igst), cgst: r2(h.cgst), sgst: r2(h.sgst) }))
    .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

/**
 * How the month's tax is paid (sections 49 and 49A, rule 88A): IGST credit is used first, against IGST and then
 * against CGST and SGST; CGST credit against CGST and then IGST; SGST credit against SGST and then IGST (never
 * CGST against SGST). IGST credit left after IGST goes to whichever of CGST/SGST their own credit can't cover, so
 * the least cash is paid. Returns the cash payable per head and the credit carried forward.
 */
export function setOff(liab: { iamt: number; camt: number; samt: number }, itc: { iamt: number; camt: number; samt: number }) {
  let I = liab.iamt, C = liab.camt, S = liab.samt;
  let iC = itc.iamt, cC = itc.camt, sC = itc.samt;
  const use = (need: number, have: number) => { const u = Math.min(need, have); return [need - u, have - u] as const; };
  [I, iC] = use(I, iC);
  // IGST credit left over: first to the part of CGST / SGST their own credit won't cover.
  const needC = Math.max(0, C - cC), needS = Math.max(0, S - sC);
  let u: number;
  [, u] = use(needC, iC); const toC = iC - u; iC = u;
  [, u] = use(needS, iC); const toS = iC - u; iC = u;
  C -= toC; S -= toS;
  [C, cC] = use(C, cC);
  [S, sC] = use(S, sC);
  [I, cC] = use(I, cC);
  [I, sC] = use(I, sC);
  return { payable: { iamt: r2(I), camt: r2(C), samt: r2(S) }, carryForward: { iamt: r2(iC), camt: r2(cC), samt: r2(sC) } };
}

async function periodDocs(db: Db, shopId: string, from: string, to: string) {
  const invoices = await many(db, "SELECT * FROM invoices WHERE shop_id = $1 AND status IN ('Issued','Cancelled') AND date BETWEEN $2 AND $3 ORDER BY number", [shopId, from, to]);
  const credits = await many(
    db,
    'SELECT cn.*, i.customer, i.place_of_supply, i.number AS inv_number, i.date AS inv_date, i.total AS inv_total, i.reverse_charge FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id WHERE cn.shop_id = $1 AND cn.date BETWEEN $2 AND $3 ORDER BY cn.number',
    [shopId, from, to],
  );
  return { invoices, credits };
}

/** GSTR-1 in the GSTN offline-tool JSON layout (b2b, b2cl, b2cs, cdnr, nil, hsn, doc_issue). */
export async function buildGstr1(db: Db, shopId: string, period: string) {
  const org = await getOrg(db, shopId);
  const { from, to, fp } = periodRange(period);
  const { invoices, credits } = await periodDocs(db, shopId, from, to);
  const issued = invoices.filter((i) => i.status === 'Issued');
  const pos = (i: any) => stateCode(i.place_of_supply);

  const b2bMap = new Map<string, any[]>();
  const b2cl: any[] = [];
  const b2cs = new Map<string, any>();
  const nil = { INTRB2B: { expt: 0, nil: 0 }, INTRAB2B: { expt: 0, nil: 0 }, INTRB2C: { expt: 0, nil: 0 }, INTRAB2C: { expt: 0, nil: 0 } } as Record<string, { expt: number; nil: number }>;

  for (const inv of issued) {
    const gstin = inv.customer?.gstin as string;
    const rows = byRate(inv.lines, inv.with_gst, inv.inter_state);
    // Nil-rated (0%) and non-GST (net-mode) values go to the "nil" table, not the invoice tables.
    const key = `${inv.inter_state ? 'INTR' : 'INTRA'}${gstin ? 'B2B' : 'B2C'}`;
    for (const r of rows) if (r.rt === 0) nil[key]![inv.with_gst ? 'nil' : 'expt'] += r.txval;
    const taxed = rows.filter((r) => r.rt > 0);
    if (!taxed.length) continue;
    const itms = taxed.map((r, i) => ({ num: i + 1, itm_det: { txval: r.txval, rt: r.rt, iamt: r.iamt, camt: r.camt, samt: r.samt, csamt: 0 } }));
    if (gstin) {
      const list = b2bMap.get(gstin) ?? [];
      list.push({ inum: inv.number, idt: dmy(inv.date), val: Number(inv.total), pos: pos(inv), rchrg: inv.reverse_charge ? 'Y' : 'N', inv_typ: 'R', itms });
      b2bMap.set(gstin, list);
    } else if (inv.inter_state && Number(inv.total) > B2CL_THRESHOLD) {
      b2cl.push({ pos: pos(inv), inv: [{ inum: inv.number, idt: dmy(inv.date), val: Number(inv.total), itms: itms.map((x) => ({ num: x.num, itm_det: { txval: x.itm_det.txval, rt: x.itm_det.rt, iamt: x.itm_det.iamt, csamt: 0 } })) }] });
    } else {
      for (const r of taxed) {
        const k = `${pos(inv)}|${r.rt}`;
        const e = b2cs.get(k) ?? { sply_ty: inv.inter_state ? 'INTER' : 'INTRA', pos: pos(inv), typ: 'OE', rt: r.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        e.txval += r.txval; e.iamt += r.iamt; e.camt += r.camt; e.samt += r.samt;
        b2cs.set(k, e);
      }
    }
  }

  // Credit notes: registered → CDNR; unregistered against a large inter-state invoice (B2CL) → CDNUR;
  // other unregistered → reduce B2CS for that POS/rate. Nil-rated / non-GST lines reduce the nil table.
  const cdnrMap = new Map<string, any[]>();
  const cdnur: any[] = [];
  for (const cn of credits) {
    const gstin = cn.customer?.gstin as string;
    const inter = cn.inter_state;
    const all = byRate(cn.lines, cn.with_gst, inter);
    const key = `${inter ? 'INTR' : 'INTRA'}${gstin ? 'B2B' : 'B2C'}`;
    for (const r of all) if (r.rt === 0) nil[key]![cn.with_gst ? 'nil' : 'expt'] -= r.txval;
    const rows = all.filter((r) => r.rt > 0);
    if (!rows.length) continue;
    if (!gstin && inter && Number(cn.inv_total) > B2CL_THRESHOLD) {
      cdnur.push({ ntty: 'C', nt_num: cn.number, nt_dt: dmy(cn.date), val: Number(cn.total), typ: 'B2CL', pos: stateCode(cn.place_of_supply),
        itms: rows.map((r, i) => ({ num: i + 1, itm_det: { txval: r.txval, rt: r.rt, iamt: r.iamt, csamt: 0 } })) });
      continue;
    }
    if (gstin) {
      const list = cdnrMap.get(gstin) ?? [];
      list.push({ ntty: 'C', nt_num: cn.number, nt_dt: dmy(cn.date), val: Number(cn.total), pos: stateCode(cn.place_of_supply), rchrg: cn.reverse_charge ? 'Y' : 'N', inv_typ: 'R', itms: rows.map((r, i) => ({ num: i + 1, itm_det: { txval: r.txval, rt: r.rt, iamt: r.iamt, camt: r.camt, samt: r.samt, csamt: 0 } })) });
      cdnrMap.set(gstin, list);
    } else {
      for (const r of rows) {
        const k = `${stateCode(cn.place_of_supply)}|${r.rt}`;
        const e = b2cs.get(k) ?? { sply_ty: inter ? 'INTER' : 'INTRA', pos: stateCode(cn.place_of_supply), typ: 'OE', rt: r.rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        e.txval -= r.txval; e.iamt -= r.iamt; e.camt -= r.camt; e.samt -= r.samt;
        b2cs.set(k, e);
      }
    }
  }

  const round = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
  const series = (docs: any[], numKey: string) => {
    if (!docs.length) return null;
    const nums = docs.map((d) => d[numKey]).sort();
    const cancel = docs.filter((d) => d.status === 'Cancelled').length;
    return { num: 1, from: nums[0], to: nums[nums.length - 1], totnum: docs.length, cancel, net_issue: docs.length - cancel };
  };
  const docInv = series(invoices, 'number');
  const docCn = series(credits, 'number');

  const json = {
    gstin: org.gstin,
    fp,
    version: 'GST3.1.6',
    hash: 'hash',
    b2b: [...b2bMap.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: Object.values(b2cl.reduce((acc: any, x) => { (acc[x.pos] ??= { pos: x.pos, inv: [] }).inv.push(...x.inv); return acc; }, {})),
    b2cs: [...b2cs.values()].map(round),
    cdnr: [...cdnrMap.entries()].map(([ctin, nt]) => ({ ctin, nt })),
    cdnur,
    nil: { inv: Object.entries(nil).map(([sply_ty, v]) => ({ sply_ty, expt_amt: r2(v.expt), nil_amt: r2(v.nil), ngsup_amt: 0 })) },
    hsn: { data: hsnRows(issued, credits).map((h, i) => ({ num: i + 1, hsn_sc: h.hsn, desc: h.description.slice(0, 30), uqc: (h.unit || 'OTH').toUpperCase(), qty: h.qty, rt: h.rate, txval: h.taxable, iamt: h.igst, camt: h.cgst, samt: h.sgst, csamt: 0 })) },
    doc_issue: { doc_det: [docInv && { doc_num: 1, docs: [docInv] }, docCn && { doc_num: 5, docs: [docCn] }].filter(Boolean) },
  };

  const sum = (arr: any[], k: string) => r2(arr.reduce((s, x) => s + (x[k] ?? 0), 0));
  const b2bItems = json.b2b.flatMap((c) => c.inv.flatMap((i: any) => i.itms.map((x: any) => x.itm_det)));
  const summary = {
    period, from, to, gstin: org.gstin,
    b2b: { invoices: json.b2b.reduce((s, c) => s + c.inv.length, 0), taxable: sum(b2bItems, 'txval'), tax: r2(sum(b2bItems, 'iamt') + sum(b2bItems, 'camt') + sum(b2bItems, 'samt')) },
    b2cl: { invoices: b2cl.length, taxable: r2(b2cl.reduce((s, x) => s + x.inv[0].itms.reduce((a: number, i: any) => a + i.itm_det.txval, 0), 0)) },
    b2cs: { taxable: sum(json.b2cs, 'txval'), tax: r2(sum(json.b2cs, 'iamt') + sum(json.b2cs, 'camt') + sum(json.b2cs, 'samt')) },
    cdnr: { notes: json.cdnr.reduce((s, c) => s + c.nt.length, 0) },
    cdnur: { notes: cdnur.length, taxable: r2(cdnur.reduce((s, n) => s + n.itms.reduce((a: number, i: any) => a + i.itm_det.txval, 0), 0)) },
    nil: json.nil.inv,
    docs: { invoices: docInv, creditNotes: docCn },
  };
  return { json, summary };
}

/** GSTR-3B summary for a month: outward liability (3.1), inter-state B2C (3.2), and ITC from bills (4). */
export async function buildGstr3b(db: Db, shopId: string, period: string) {
  const org = await getOrg(db, shopId);
  const { from, to } = periodRange(period);
  const { invoices, credits } = await periodDocs(db, shopId, from, to);
  const out = { txval: 0, iamt: 0, camt: 0, samt: 0 };
  const nilExempt = { txval: 0 };
  const interB2c = new Map<string, { pos: string; txval: number; iamt: number }>();
  const add = (lines: any[], withGst: boolean, inter: boolean, sign: number, gstin: string, posState: string) => {
    for (const r of byRate(lines, withGst, inter, sign)) {
      if (r.rt === 0) { nilExempt.txval += r.txval; continue; }
      out.txval += r.txval; out.iamt += r.iamt; out.camt += r.camt; out.samt += r.samt;
      if (inter && !gstin) {
        const e = interB2c.get(posState) ?? { pos: `${stateCode(posState)}-${posState}`, txval: 0, iamt: 0 };
        e.txval += r.txval; e.iamt += r.iamt;
        interB2c.set(posState, e);
      }
    }
  };
  for (const inv of invoices.filter((i) => i.status === 'Issued')) add(inv.lines, inv.with_gst, inv.inter_state, 1, inv.customer?.gstin, inv.place_of_supply);
  for (const cn of credits) add(cn.lines, cn.with_gst, cn.inter_state, -1, cn.customer?.gstin, cn.place_of_supply);

  const bills = await many(db, 'SELECT b.tax_amount, b.taxable_amount, v.state, v.gstin FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.shop_id = $1 AND b.date BETWEEN $2 AND $3', [shopId, from, to]);
  const itc = { iamt: 0, camt: 0, samt: 0 };
  for (const b of bills) {
    if (!b.gstin) continue; // ITC only from registered suppliers
    const tax = Number(b.tax_amount);
    if (isInterState(org.state, b.state || org.state)) itc.iamt += tax;
    else { itc.camt += tax / 2; itc.samt += tax / 2; }
  }
  // Business expenses from GST-registered vendors also carry input tax credit.
  const exps = await many(db, 'SELECT e.tax_amount, v.state, v.gstin FROM expenses e JOIN vendors v ON v.id = e.vendor_id WHERE e.shop_id = $1 AND e.date BETWEEN $2 AND $3 AND e.tax_amount > 0', [shopId, from, to]);
  for (const e of exps) {
    if (!e.gstin) continue;
    const tax = Number(e.tax_amount);
    if (isInterState(org.state, e.state || org.state)) itc.iamt += tax;
    else { itc.camt += tax / 2; itc.samt += tax / 2; }
  }
  const R = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
  const { payable, carryForward } = setOff({ iamt: r2(out.iamt), camt: r2(out.camt), samt: r2(out.samt) }, { iamt: r2(itc.iamt), camt: r2(itc.camt), samt: r2(itc.samt) });
  return {
    period, from, to, gstin: org.gstin,
    sup_details: { osup_det: R(out), osup_nil_exmp: R(nilExempt), isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0 } },
    inter_sup: { unreg_details: [...interB2c.values()].map(R) },
    itc_elg: { itc_avl: R(itc) },
    payable,
    carryForward,
    note: 'ITC is taken from bills and expenses with a vendor GSTIN. Tax payable uses the credit set-off order of the GST law (IGST credit first); credit left over is carried forward.',
  };
}

export async function hsnSummary(db: Db, shopId: string, from: string, to: string) {
  const { invoices, credits } = await periodDocs(db, shopId, from, to);
  return hsnRows(invoices.filter((i) => i.status === 'Issued'), credits);
}

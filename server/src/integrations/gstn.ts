/**
 * Builders for government JSON formats. These produce upload-ready payloads for the
 * NIC e-invoice (IRP) and e-way bill portals. Direct API filing needs a GSP/ASP licence +
 * credentials; until those are configured, users download the JSON and upload it on the portal.
 */
import { r2 } from '../../../shared/calc';
import { stateCode } from '../../../shared/gst';

const UNIT_CODES: Record<string, string> = { pcs: 'PCS', nos: 'NOS', box: 'BOX', kg: 'KGS', g: 'GMS', ltr: 'LTR', mtr: 'MTR', dozen: 'DOZ', ream: 'OTH' };
const unitCode = (u: string) => UNIT_CODES[u?.toLowerCase()] ?? 'OTH';
const pinOf = (addr: string) => Number(/\b(\d{6})\b/.exec(addr ?? '')?.[1] ?? 0);
const placeOf = (addr: string) => (addr ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(-1)[0]?.replace(/\d{6}/, '').trim() || 'NA';
const dmy = (iso: string, sep = '/') => iso.split('-').reverse().join(sep);

export function buildEInvoice(org: any, inv: any) {
  const c = inv.customer;
  if (!org.gstin) throw new Error('Add your GSTIN in Organization profile first');
  if (!c?.gstin) throw new Error('E-invoices are required only for B2B invoices (customer GSTIN missing)');
  const items = (inv.lines as any[]).map((l, i) => {
    const gross = r2(l.qty * l.rate);
    const ass = r2(l.amount);
    const tax = inv.with_gst ? r2((ass * l.taxRate) / 100) : 0;
    return {
      SlNo: String(i + 1),
      PrdDesc: l.name,
      IsServc: l.type === 'Services' ? 'Y' : 'N',
      HsnCd: l.hsn || '00',
      Qty: l.qty,
      Unit: l.type === 'Services' ? 'OTH' : unitCode(l.unit),
      UnitPrice: l.rate,
      TotAmt: gross,
      Discount: r2(gross - ass),
      AssAmt: ass,
      GstRt: inv.with_gst ? l.taxRate : 0,
      IgstAmt: inv.inter_state ? tax : 0,
      CgstAmt: inv.inter_state ? 0 : r2(tax / 2),
      SgstAmt: inv.inter_state ? 0 : r2(tax - r2(tax / 2)),
      TotItemVal: r2(ass + tax),
    };
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: inv.reverse_charge ? 'Y' : 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: inv.number, Dt: dmy(inv.date) },
    SellerDtls: { Gstin: org.gstin, LglNm: org.legal_name || org.company_name, TrdNm: org.company_name, Addr1: (org.address || 'NA').slice(0, 100), Loc: placeOf(org.address), Pin: pinOf(org.address), Stcd: stateCode(org.state), Ph: (org.phone || '').replace(/\D/g, '').slice(-10) || undefined, Em: org.email || undefined },
    BuyerDtls: { Gstin: c.gstin, LglNm: c.companyName || c.name, Pos: stateCode(inv.place_of_supply), Addr1: (c.address || 'NA').slice(0, 100), Loc: placeOf(c.address), Pin: pinOf(c.address), Stcd: c.gstin.slice(0, 2) },
    ItemList: items,
    ValDtls: { AssVal: Number(inv.sub_total), CgstVal: Number(inv.cgst), SgstVal: Number(inv.sgst), IgstVal: Number(inv.igst), RndOffAmt: Number(inv.round_off), TotInvVal: Number(inv.total) },
  };
}

export interface Transport {
  distanceKm: number;
  vehicleNo: string;
  transporterId?: string;
  transporterName?: string;
  mode: 1 | 2 | 3 | 4; // road, rail, air, ship
}

export function buildEwayBill(org: any, inv: any, t: Transport) {
  const c = inv.customer;
  if (!org.gstin) throw new Error('Add your GSTIN in Organization profile first');
  const goods = (inv.lines as any[]).filter((l) => l.type === 'Goods');
  if (!goods.length) throw new Error('E-way bills apply to movement of goods only');
  const half = (r: number) => (inv.with_gst && !inv.inter_state ? r / 2 : 0);
  return {
    version: '1.0.0621',
    billLists: [
      {
        userGstin: org.gstin,
        supplyType: 'O',
        subSupplyType: 1,
        docType: 'INV',
        docNo: inv.number,
        docDate: dmy(inv.date),
        fromGstin: org.gstin,
        fromTrdName: org.company_name,
        fromAddr1: (org.address || '').slice(0, 120),
        fromPlace: placeOf(org.address),
        fromPincode: pinOf(org.address),
        fromStateCode: Number(stateCode(org.state)),
        actFromStateCode: Number(stateCode(org.state)),
        toGstin: c.gstin || 'URP',
        toTrdName: c.companyName || c.name,
        toAddr1: (c.address || '').slice(0, 120),
        toPlace: placeOf(c.address),
        toPincode: pinOf(c.address),
        toStateCode: Number(stateCode(inv.place_of_supply)),
        actToStateCode: Number(stateCode(inv.place_of_supply)),
        totalValue: Number(inv.sub_total),
        cgstValue: Number(inv.cgst),
        sgstValue: Number(inv.sgst),
        igstValue: Number(inv.igst),
        cessValue: 0,
        totInvValue: Number(inv.total),
        transMode: t.mode,
        transDistance: t.distanceKm,
        transporterId: t.transporterId ?? '',
        transporterName: t.transporterName ?? '',
        vehicleNo: t.vehicleNo.replace(/\s/g, '').toUpperCase(),
        vehicleType: 'R',
        itemList: goods.map((l, i) => ({
          itemNo: i + 1,
          productName: l.name,
          hsnCode: Number(l.hsn || 0),
          quantity: l.qty,
          qtyUnit: unitCode(l.unit),
          taxableAmount: l.amount,
          cgstRate: half(l.taxRate),
          sgstRate: half(l.taxRate),
          igstRate: inv.with_gst && inv.inter_state ? l.taxRate : 0,
          cessRate: 0,
        })),
      },
    ],
  };
}

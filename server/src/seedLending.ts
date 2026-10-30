import type { Db } from './db';
import { hashPassword, todayISO } from './auth';
import { nextSeq } from './services/common';
import { aadhaarAvailable, aadhaarHash, encryptAadhaar } from './services/lending';
import { addDays, quoteLoan, type LoanType } from '../../shared/lending';

/* Demo microfinance book for the demo shop: four areas, twenty borrowers and fifteen loans in every state
   (on time, slow, overdue, defaulting, closed, and one existing loan brought in), with their collections. */

const AREAS: Array<[string, string]> = [['KUN', 'Kundi'], ['SLM', 'Salem'], ['NMK', 'Namakkal'], ['ERD', 'Erode']];
const PEOPLE: Array<[string, string]> = [
  ['Muthu Kumar', 'Rangasamy'], ['Selvi Priya', 'Murugan'], ['Karthik Raj', 'Sundaram'], ['Lakshmi Devi', 'Paramasivan'], ['Arun Kumar', 'Ganesan'],
  ['Revathi S', 'Shanmugam'], ['Suresh Babu', 'Balakrishnan'], ['Meena K', 'Krishnan'], ['Naveen Raj', 'Ravi'], ['Gayathri P', 'Palani'],
  ['Rajesh M', 'Mahendran'], ['Deepa L', 'Loganathan'], ['Vignesh R', 'Raman'], ['Kalaivani T', 'Thangavel'], ['Prakash S', 'Subramani'],
  ['Jayanthi N', 'Natarajan'], ['Saravanan V', 'Velu'], ['Anitha D', 'Durai'], ['Balamurugan C', 'Chinnasamy'], ['Hema R', 'Rajendran'],
];

// borrower index, plan, amount, instalments, days ago, payer habit (share of due instalments paid), late fee
const LOANS: Array<[number, LoanType, number, number, number, number, number]> = [
  [0, 'Daily 100-Day', 50000, 100, 40, 1, 0], [1, 'Daily 100-Day', 30000, 100, 25, 0.8, 50], [2, 'Daily 100-Day', 20000, 100, 96, 0.9, 0],
  [3, 'Daily 100-Day', 40000, 100, 112, 0.7, 100], [4, 'Daily 100-Day', 25000, 100, 140, 0.55, 100], [5, 'Weekly', 60000, 26, 70, 1, 0],
  [6, 'Weekly', 35000, 20, 190, 0.6, 200], [7, 'Monthly EMI', 100000, 12, 120, 1, 0], [8, 'Monthly EMI', 75000, 10, 340, 0.6, 500],
  [9, 'Monthly EMI', 50000, 6, 230, 1, 0], [10, 'Daily 100-Day', 15000, 100, 130, 1, 0], [11, 'Weekly', 45000, 26, 14, 1, 0],
  [12, 'Daily 100-Day', 35000, 100, 4, 1, 0], [13, 'Monthly EMI', 120000, 12, 60, 0.5, 300], [15, 'Daily 100-Day', 18000, 100, 2, 1, 0],
];

export async function seedLending(db: Db, shopId: string, branchId: string | null, password: string) {
  const today = todayISO();
  await db.query('UPDATE organizations SET lending_enabled = true WHERE shop_id = $1', [shopId]);
  for (const [code, name] of AREAS) await db.query('INSERT INTO lending_areas (shop_id, code, name) VALUES ($1,$2,$3)', [shopId, code, name]);
  const collector = (await db.query(`INSERT INTO users (shop_id, name, email, password_hash, role, branch_id) VALUES ($1,'Arun Selvam','collector@shop.com',$2,'Collector',$3) RETURNING id, name`,
    [shopId, await hashPassword(password), branchId])).rows[0];
  const manager = (await db.query(`SELECT id, name FROM users WHERE shop_id = $1 AND role = 'Manager' LIMIT 1`, [shopId])).rows[0];
  // Loans are paid out of, and collected into, the shop's cash account; the owner put lending capital in first.
  const cashAcc = (await db.query(`SELECT id FROM bank_accounts WHERE shop_id = $1 AND type = 'Cash' ORDER BY created_at LIMIT 1`, [shopId])).rows[0]?.id ?? null;
  if (cashAcc) await db.query(`INSERT INTO bank_transactions (shop_id, account_id, date, description, amount, category) VALUES ($1,$2,$3,'Microfinance capital from owner',800000,'Owner Contribution')`, [shopId, cashAcc, addDays(today, -350)]);

  const borrowers: Array<{ id: string; code: string }> = [];
  for (const [i, [name, father]] of PEOPLE.entries()) {
    const area = AREAS[i % AREAS.length]![0];
    const code = `${area}${String(await nextSeq(db, shopId, `borrower:${area}`)).padStart(3, '0')}`;
    const mobile = `9${String(840012300 + i * 7919).slice(0, 9)}`;
    // Demo Aadhaar numbers only when the server has an encryption key (AADHAAR_KEY in production).
    const aadhaar = i % 3 === 2 || !aadhaarAvailable() ? null : String(234500000000 + i * 104729);
    const status = i === 16 || i === 18 ? 'Pending Verification' : i === 19 ? 'Manual Verification Approved' : 'Verified';
    const r = await db.query(`INSERT INTO borrowers (shop_id, code, name, father_name, mobile, address, area_code, guarantor, aadhaar_enc, aadhaar_hash, aadhaar_last4, status, status_note, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Aravind Kumar', now() - ($14 || ' days')::interval) RETURNING id`,
      [shopId, code, name, father, mobile, `${12 + i}, ${['Main Road', 'Temple Street', 'Bazaar Street', 'Mill Road'][i % 4]}, ${AREAS[i % AREAS.length]![1]}`, area,
        i % 4 === 3 ? '' : `${PEOPLE[(i + 5) % PEOPLE.length]![0]} (neighbour)`, aadhaar ? JSON.stringify(encryptAadhaar(aadhaar)) : null, aadhaar ? aadhaarHash(aadhaar) : null,
        aadhaar ? aadhaar.slice(-4) : '', status, status === 'Manual Verification Approved' ? 'Ration card and voter ID checked at the office' : '', String(400 - i * 10)]);
    borrowers.push({ id: r.rows[0].id, code });
  }

  for (const [bi, type, principal, periods, ago, habit, lateFee] of LOANS) {
    const borrowDate = addDays(today, -ago);
    const q = quoteLoan({ principal, monthlyRate: 2.14, loanType: type, periods, borrowDate, cashHandover: null });
    const cash = Math.floor(q.netDisbursed / 10) * 10; // owners round cash in hand down to the nearest ₹10
    const quote = quoteLoan({ principal, monthlyRate: 2.14, loanType: type, periods, borrowDate, cashHandover: cash });
    const who = bi % 2 ? collector : manager;
    const number = `LN-${String(await nextSeq(db, shopId, 'loan')).padStart(6, '0')}`;
    const loan = (await db.query(`INSERT INTO lending_loans (shop_id, number, borrower_id, loan_type, principal, monthly_rate, periods, collector_id, collector_name, borrow_date, first_due, maturity,
        instalment, upfront_interest, processing_fee, net_disbursed, calculated_net, cash_rounding, apr, late_fee, disbursement_mode, account_id, ack_reference, entered_on, schedule, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,2.14,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,'Cash',$21,$19,$9,$20,'Aravind Kumar',$9::date + time '10:00')
      RETURNING id`,
      [shopId, number, borrowers[bi]!.id, type, principal, periods, who.id, who.name, borrowDate, quote.firstDue, quote.maturity, quote.instalment, quote.upfrontInterest,
        quote.netDisbursed, quote.calculatedNet, quote.cashRounding, quote.apr, lateFee, `Signed slip ${number.slice(3)}`, JSON.stringify(quote.rows), cashAcc])).rows[0];

    // Collections: pay the instalments that fell due, skipping some for slower payers; good payers pay on the due day.
    let balance = principal, k = 0, paid = 0;
    for (const r of quote.rows) {
      if (r.due > today || (r.due === today && habit < 1)) break; // good payers have already paid today
      k++;
      if (habit < 1 && k % Math.round(1 / (1 - habit)) === 0) continue; // e.g. 0.8 misses every 5th instalment
      if (habit < 0.65 && r.due > addDays(today, -35)) continue; // slow payers have stopped lately
      const upi = k % 4 === 0;
      const key = `receipt:${r.due.replace(/-/g, '')}`;
      const receipt = `RCP-${r.due.replace(/-/g, '')}-${String(await nextSeq(db, shopId, key)).padStart(4, '0')}`;
      await db.query(`INSERT INTO lending_payments (shop_id, loan_id, receipt_no, date, at, amount, mode, reference, kind, principal_part, balance_before, balance_after, collector_id, collector_name, account_id, created_by)
        VALUES ($1,$2,$3,$4,$4::date + time '09:30' + ($12 || ' minutes')::interval,$5,$6,$7,'Collection',$5,$8,$9,$10,$11,$13,$11)`,
        [shopId, loan.id, receipt, r.due, r.amount, upi ? 'UPI' : 'Cash', upi ? `UPI${String(410000000 + k * 977).slice(0, 9)}` : '', balance, Math.round((balance - r.amount) * 100) / 100, who.id, who.name, String((bi * 17) % 300), cashAcc]);
      balance = Math.round((balance - r.amount) * 100) / 100; paid++;
    }
    if (balance <= 0) await db.query(`UPDATE lending_loans SET status = 'Closed', closed_at = $3::date + time '18:00', closed_by = 'System', closure_reason = 'Balance reached zero - closed automatically' WHERE id = $1 AND shop_id = $2`, [loan.id, shopId, quote.maturity]);
    // The worst defaulter gets a late charge on the oldest missed instalment.
    if (lateFee > 0 && habit <= 0.55 && paid < quote.rows.length) {
      const missed = quote.rows.find((r, idx) => idx >= paid && r.due < addDays(today, -30));
      if (missed) await db.query(`INSERT INTO lending_charges (shop_id, loan_id, kind, amount, instalment, reason, date, created_by) VALUES ($1,$2,'Late charge',$3,$4,$5,$6,'Aravind Kumar')`,
        [shopId, loan.id, lateFee, missed.n, `Instalment ${missed.n} overdue since ${missed.due}`, addDays(missed.due, 31)]);
    }
  }

  // An existing loan brought in from the paper register: lent 8 months ago, ₹40,000 already repaid.
  const exDate = addDays(today, -240);
  const ex = quoteLoan({ principal: 60000, monthlyRate: 2.14, loanType: 'Monthly EMI', periods: 12, borrowDate: exDate, cashHandover: null });
  const exNum = `LN-${String(await nextSeq(db, shopId, 'loan')).padStart(6, '0')}`;
  const exLoan = (await db.query(`INSERT INTO lending_loans (shop_id, number, borrower_id, loan_type, principal, monthly_rate, periods, collector_id, collector_name, borrow_date, first_due, maturity,
      instalment, upfront_interest, net_disbursed, calculated_net, apr, ack_reference, existing_loan, already_repaid, entered_on, schedule, notes, created_by)
    VALUES ($1,$2,$3,'Monthly EMI',60000,2.14,12,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,'Existing loan from the paper register',true,40000,$13,$14,'Brought in from the old ledger book','Aravind Kumar') RETURNING id`,
    [shopId, exNum, borrowers[17]!.id, collector.id, collector.name, exDate, ex.firstDue, ex.maturity, ex.instalment, ex.upfrontInterest, ex.netDisbursed, ex.apr, addDays(today, -20), JSON.stringify(ex.rows)])).rows[0];
  await db.query(`INSERT INTO lending_payments (shop_id, loan_id, receipt_no, date, amount, mode, reference, kind, principal_part, balance_before, balance_after, collector_name, created_by)
    VALUES ($1,$2,$3,$4,40000,'Opening balance','Repaid before this system','Opening balance',40000,60000,20000,'Aravind Kumar','Aravind Kumar')`, [shopId, exLoan.id, `OPN-${exNum}`, addDays(today, -21)]);
}

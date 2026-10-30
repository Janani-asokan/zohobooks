import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { LendingMode, LoanState, LoanType, Quote, ScheduleRow } from '../../shared/lending';

export interface LendingSettings {
  enabled: boolean; areas: Array<{ code: string; name: string; active: boolean }>; collectors: Array<{ id: string; name: string; role: string }>;
  accounts: Array<{ id: string; name: string; type: string }>; aadhaarAvailable: boolean; loanTypes: LoanType[]; modes: LendingMode[];
  rules: { defaultMonthlyRate: number; minMonthlyRate: number; maxMonthlyRate: number; maxCashRounding: number; newLoanBackdateDays: number; defaulterDays: number; defaultPeriods: Record<LoanType, number> };
}
export interface Borrower {
  id: string; code: string; name: string; fatherName: string; mobile: string; address: string; areaCode: string; areaName: string; guarantor: string;
  hasAadhaar: boolean; aadhaarMasked: string; status: string; statusNote: string; createdBy: string; createdAt: string;
  riskScore: number; riskBand: string; loanCount: number; activeLoans: number; outstanding: number;
}
export interface Loan {
  id: string; number: string; borrowerId: string; borrowerCode: string; borrowerName: string; mobile: string; areaCode: string; areaName: string;
  loanType: LoanType; principal: number; monthlyRate: number; periods: number; collectorId: string | null; collectorName: string; borrowDate: string;
  firstDue: string; maturity: string; instalment: number; upfrontInterest: number; processingFee: number; netDisbursed: number; calculatedNet: number;
  cashRounding: number; apr: number; lateFee: number; disbursementMode: string; accountId: string | null; ackReference: string; existingLoan: boolean;
  alreadyRepaid: number; enteredOn: string; storedStatus: string; closedAt: string | null; closedBy: string; closureReason: string; notes: string;
  createdBy: string; createdAt: string; schedule?: ScheduleRow[]; state: LoanState;
}
export interface LoanPayment {
  id: string; loanId: string; loanNumber?: string; receiptNo: string; date: string; at: string; amount: number; mode: string; reference: string; kind: string;
  principalPart: number; penaltyPart: number; balanceBefore: number; balanceAfter: number; collectorName: string; status: string; reversedReason: string;
  createdBy: string; borrowerName?: string; borrowerCode?: string;
}
export interface LoanDetail {
  loan: Loan & { schedule: ScheduleRow[] };
  schedule: Array<ScheduleRow & { paid: number; state: 'Paid' | 'Part paid' | 'Overdue' | 'Due today' | 'Upcoming' }>;
  payments: LoanPayment[]; charges: Array<{ id: string; kind: string; amount: number; instalment: number | null; reason: string; date: string; created_by: string }>;
  lateCharge: { isDefaulter: boolean; overdueDays: number; thresholdDays: number; lateFee: number; nextInstalment: number | null; message: string };
}
export interface LendingDashboard {
  totals: { activeLoans: number; overdueLoans: number; defaulters: number; outstanding: number; overdueAmount: number; todayCollection: number; monthCollection: number; monthDisbursed: number; monthInterest: number; pendingVerification: number; closedLoans: number };
  split: Record<LoanType, number>;
  areas: Array<{ code: string; name: string; activeLoans: number; outstanding: number; today: number; month: number; paidToday: number; yetToPay: number }>;
  collectors: Array<{ name: string; today: number; month: number; count: number }>;
  alerts: Array<{ loanId: string; number: string; borrower: string; area: string; alert: string; balance: number; overdueDays: number; daysElapsed: number }>;
  trend: Array<{ month: string; total: number }>;
}
export interface DueRow {
  loanId: string; number: string; borrowerId: string; borrower: string; mobile: string; area: string; frequency: string; instalment: number; collector: string; balance: number;
  start: string; end: string; status: 'Paid' | 'Less paid' | 'Not paid' | 'Upcoming' | 'Arrears'; scheduled: number; paid: number; short: number; pendingCount: number; pendingAmount: number; pendingSince: string | null;
}
export type { Quote };

export const LENDING_KEYS = [['lending']];
export const useLendingSettings = () => useQuery({ queryKey: ['lending', 'settings'], queryFn: () => api.get<LendingSettings>('/shop/lending/settings'), staleTime: 60_000 });
export const useBorrowers = (enabled = true) => useQuery({ queryKey: ['lending', 'borrowers'], queryFn: () => api.get<Borrower[]>('/shop/lending/borrowers'), enabled });
export const useLoans = () => useQuery({ queryKey: ['lending', 'loans'], queryFn: () => api.get<Loan[]>('/shop/lending/loans') });
export const useLoan = (id?: string) => useQuery({ queryKey: ['lending', 'loan', id], queryFn: () => api.get<LoanDetail>(`/shop/lending/loans/${id}`), enabled: !!id });
export const useLendingDashboard = () => useQuery({ queryKey: ['lending', 'dashboard'], queryFn: () => api.get<LendingDashboard>('/shop/lending/dashboard'), refetchInterval: 60_000 });
export const useDues = (date: string) => useQuery({ queryKey: ['lending', 'dues', date], queryFn: () => api.get<{ date: string; today: string; rows: DueRow[] }>(`/shop/lending/dues?date=${date}`) });
export const useDayReceipts = (date: string) => useQuery({ queryKey: ['lending', 'payments', date], queryFn: () => api.get<{ date: string; payments: LoanPayment[]; total: number; byMode: Record<string, number> }>(`/shop/lending/payments?date=${date}`) });

export const LOAN_TONE: Record<string, string> = { Active: 'blue', Overdue: 'red', Closed: 'green', 'Written Off': 'gray' };
export const DUE_TONE: Record<string, string> = { Paid: 'green', 'Less paid': 'amber', 'Not paid': 'red', Arrears: 'red', Upcoming: 'gray' };
export const BORROWER_TONE: Record<string, string> = { Verified: 'green', 'Manual Verification Approved': 'teal', 'Pending Verification': 'amber', 'Verification Failed': 'red' };
export const RISK_TONE = (score: number) => (score >= 75 ? 'green' : score >= 55 ? 'amber' : 'red');
export const newRequestId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

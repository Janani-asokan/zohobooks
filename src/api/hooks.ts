import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, ApiError } from './client';
import { useToast } from '@/context/ToastContext';
import type {
  AuditEntry, BankAccount, BankTxn, Bill, Branch, CreditNote, Customer, Dashboard, Invoice, InvoiceDetail, Item, Notification, Organization,
  PaymentRow, Plan, PlatformConfig, Recurring, SalesOrder, Shop, StaffUser, TaxSlab, Vendor,
} from './types';

const S = '/shop';
const q = <T,>(key: QueryKey, url: string, enabled = true) => ({ queryKey: key, queryFn: () => api.get<T>(url), enabled });

/* ---------- shop reads ---------- */
export const useOrg = () => useQuery(q<Organization>(['org'], `${S}/organization`));
export const useTaxSlabs = () => useQuery({ ...q<TaxSlab[]>(['taxSlabs'], `${S}/tax-slabs`), staleTime: 5 * 60_000 });
export const useBranches = () => useQuery(q<Branch[]>(['branches'], `${S}/branches`));
export const useItems = () => useQuery(q<Item[]>(['items'], `${S}/items`));
export const useCustomers = () => useQuery(q<Customer[]>(['customers'], `${S}/customers`));
export const useInvoices = () => useQuery(q<Invoice[]>(['invoices'], `${S}/invoices`));
export const useInvoice = (id?: string) => useQuery(q<InvoiceDetail>(['invoice', id], `${S}/invoices/${id}`, !!id));
export const usePayments = () => useQuery(q<PaymentRow[]>(['payments'], `${S}/payments`));
export const useCreditNotes = () => useQuery(q<CreditNote[]>(['creditNotes'], `${S}/credit-notes`));
export const useSalesOrders = () => useQuery(q<SalesOrder[]>(['salesOrders'], `${S}/sales-orders`));
export const useRecurring = () => useQuery(q<Recurring[]>(['recurring'], `${S}/recurring`));
export const useVendors = (enabled = true) => useQuery(q<Vendor[]>(['vendors'], `${S}/vendors`, enabled));
export const useBills = (enabled = true) => useQuery(q<Bill[]>(['bills'], `${S}/bills`, enabled));
export const useBankAccounts = () => useQuery(q<BankAccount[]>(['bankAccounts'], `${S}/bank-accounts`));
export const useBankTxns = (enabled = true) => useQuery(q<BankTxn[]>(['bankTxns'], `${S}/bank-transactions`, enabled));
export const useStaff = (enabled = true) => useQuery(q<StaffUser[]>(['staff'], `${S}/staff`, enabled));
export const useAudit = (enabled = true) => useQuery(q<AuditEntry[]>(['audit'], `${S}/audit`, enabled));
export const useDashboard = () => useQuery(q<Dashboard>(['dashboard'], `${S}/dashboard`));
export const useNotifications = () => useQuery({ ...q<Notification[]>(['notifications'], `${S}/notifications`), refetchInterval: 5 * 60_000 });
export const useNextCustomerId = (enabled: boolean) => useQuery({ ...q<{ customId: string }>(['nextCustomerId'], `${S}/customers/next-id`, enabled), staleTime: 0 });
export const useNextInvoiceNumber = (date: string) => useQuery({ ...q<{ number: string; fy: string }>(['nextInvoiceNumber', date], `${S}/invoices/next-number?date=${date}`), staleTime: 0 });
export const useStockAlerts = (days = 30) => useQuery(q<{ lowStock: Array<{ itemId: string; name: string; unit: string; stock: number; reorderLevel: number }>; expiring: Array<{ itemId: string; name: string; batchNo: string; expiryDate: string; qty: number; branch: string }> }>(['stockAlerts', days], `${S}/stock/alerts?days=${days}`));
export const useMovements = (itemId?: string) =>
  useQuery(q<{ movements: Array<{ id: number; at: string; branch: string; qty: number; reason: string; batchNo: string; note: string; user: string }>; batches: Array<{ id: string; branch: string; batchNo: string; expiryDate: string | null; qty: number }> }>(['movements', itemId], `${S}/items/${itemId}/movements`, !!itemId));

/* ---------- platform reads ---------- */
export const usePlatformOverview = () => useQuery(q<{ shops: Shop[]; totalRevenue: number; monthly: Array<{ month: string; revenue: number }> }>(['platform', 'overview'], '/platform/overview'));
export const usePlatformConfig = () => useQuery(q<PlatformConfig>(['platform', 'config'], '/platform/config'));
export const usePlans = () => useQuery(q<Plan[]>(['platform', 'plans'], '/platform/plans'));
export const usePlatformAudit = () => useQuery(q<AuditEntry[]>(['platform', 'audit'], '/platform/audit'));
export const usePlatformPayments = () => useQuery(q<Array<{ id: string; shopName: string; planName: string; years: number; amount: number; method: string; reference: string; status: string; paidAt: string | null; createdAt: string }>>(['platform', 'payments'], '/platform/payments'));
export const useBackups = () => useQuery(q<{ enabled: boolean; keep: number; files: Array<{ name: string; bytes: number; createdAt: string }> }>(['platform', 'backups'], '/platform/backups'));

/**
 * Mutation with automatic cache invalidation and error toast.
 * Pass the query keys whose data changes.
 */
export function useMut<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>, invalidate: QueryKey[], opts: { success?: string | ((out: TOut, v: TVars) => string); silentError?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TOut, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: (out, v) => {
      for (const k of invalidate) qc.invalidateQueries({ queryKey: k });
      if (opts.success) toast('success', typeof opts.success === 'function' ? opts.success(out, v) : opts.success);
    },
    onError: (e) => {
      if (!opts.silentError && !e.details) toast('error', e.message);
      else if (!opts.silentError && e.details) toast('error', 'Please fix the highlighted fields', e.message);
    },
  });
}

/** Keys touched by anything that changes invoices/money. */
export const SALES_KEYS: QueryKey[] = [['invoices'], ['invoice'], ['dashboard'], ['customers'], ['payments'], ['creditNotes'], ['notifications'], ['bankAccounts'], ['bankTxns'], ['items'], ['salesOrders'], ['nextInvoiceNumber'], ['stockAlerts'], ['movements']];

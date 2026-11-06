import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FullPageSpinner, ProtectedRoute } from './components/ProtectedRoute';
import { homeFor, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AppLayout from './layouts/AppLayout';
import SettingsLayout from './layouts/SettingsLayout';
import { IS_APP } from './lib/platform';

// Route-level code splitting keeps the first load small. In the CorpusLite phone app (IS_APP, a build-time constant)
// the web-only pages are left out of the package altogether, which keeps the app small.
const WebOnly = lazy(() => import('./pages/WebOnly'));
const PublicInvoice = IS_APP ? WebOnly : lazy(() => import('./pages/PublicInvoice'));
const PrintInvoice = lazy(() => import('./pages/PrintInvoice'));
const Landing = IS_APP ? WebOnly : lazy(() => import('./pages/Landing'));
const SuperDashboard = IS_APP ? WebOnly : lazy(() => import('./pages/super/Dashboard'));
const Configuration = IS_APP ? WebOnly : lazy(() => import('./pages/super/Configuration'));
const Plans = IS_APP ? WebOnly : lazy(() => import('./pages/super/Plans'));
const SuperFeatures = IS_APP ? WebOnly : lazy(() => import('./pages/super/Features'));
const Activity = IS_APP ? WebOnly : lazy(() => import('./pages/super/Activity'));
const Home = lazy(() => import('./pages/app/Home'));
const Features = IS_APP ? WebOnly : lazy(() => import('./pages/app/Features'));
const TodayRates = lazy(() => import('./pages/app/TodayRates'));
const Pos = lazy(() => import('./pages/app/Pos'));
const Items = lazy(() => import('./pages/app/Items'));
const ItemForm = lazy(() => import('./pages/app/ItemForm'));
const PurchaseOrders = lazy(() => import('./pages/app/PurchaseOrders'));
const Expenses = lazy(() => import('./pages/app/Expenses'));
const Vendors = lazy(() => import('./pages/app/Vendors'));
const Customers = lazy(() => import('./pages/app/Customers'));
const SalesOrders = IS_APP ? WebOnly : lazy(() => import('./pages/app/SalesOrders'));
const Invoices = lazy(() => import('./pages/app/Invoices'));
const InvoiceForm = lazy(() => import('./pages/app/InvoiceForm'));
const InvoiceView = lazy(() => import('./pages/app/InvoiceView'));
const PaymentsReceived = lazy(() => import('./pages/app/PaymentsReceived'));
const CreditNotes = IS_APP ? WebOnly : lazy(() => import('./pages/app/CreditNotes'));
const Recurring = IS_APP ? WebOnly : lazy(() => import('./pages/app/Recurring'));
const Offers = IS_APP ? WebOnly : lazy(() => import('./pages/app/Offers'));
const Purchases = lazy(() => import('./pages/app/Purchases'));
const PaymentsMade = lazy(() => import('./pages/app/PaymentsMade'));
const Warehouses = lazy(() => import('./pages/app/Warehouses'));
const StockAdjustments = lazy(() => import('./pages/app/StockAdjustments'));
const Transfers = lazy(() => import('./pages/app/Transfers'));
const DeliveryChallans = IS_APP ? WebOnly : lazy(() => import('./pages/app/DeliveryChallans'));
const StockInsights = IS_APP ? WebOnly : lazy(() => import('./pages/app/StockInsights'));
const DataTransfer = IS_APP ? WebOnly : lazy(() => import('./pages/app/DataTransfer'));
const FieldDay = IS_APP ? WebOnly : lazy(() => import('./pages/app/FieldDay'));
const FieldTeam = IS_APP ? WebOnly : lazy(() => import('./pages/app/FieldTeam'));
const LendingHome = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/LendingHome'));
const Borrowers = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/Borrowers'));
const BorrowerView = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/BorrowerView'));
const Loans = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/Loans'));
const LoanNew = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/LoanNew'));
const LoanView = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/LoanView'));
const Collections = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/Collections'));
const Planner = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/Planner'));
const LendingReports = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/LendingReports'));
const LendingSettings = IS_APP ? WebOnly : lazy(() => import('./pages/app/microfinance/LendingSettings'));
const StockSummary = lazy(() => import('./pages/app/StockSummary'));
const Banking = IS_APP ? WebOnly : lazy(() => import('./pages/app/Banking'));
const Reports = IS_APP ? WebOnly : lazy(() => import('./pages/app/Reports'));
const ReportsHome = lazy(() => import('./pages/app/ReportsHome'));
const ReportView = lazy(() => import('./pages/app/ReportView'));
const Accounts = IS_APP ? WebOnly : lazy(() => import('./pages/app/Accounts'));
const Journals = IS_APP ? WebOnly : lazy(() => import('./pages/app/Journals'));
const Ledger = IS_APP ? WebOnly : lazy(() => import('./pages/app/Ledger'));
const AuditLog = IS_APP ? WebOnly : lazy(() => import('./pages/app/AuditLog'));
const Organization = lazy(() => import('./pages/app/Organization'));
const Team = IS_APP ? WebOnly : lazy(() => import('./pages/app/Team'));
const Billing = IS_APP ? WebOnly : lazy(() => import('./pages/app/Billing'));
const PrintSettings = lazy(() => import('./pages/app/PrintSettings'));
const BarcodeLabels = lazy(() => import('./pages/app/BarcodeLabels'));

/** "/" shows the public landing page to visitors and sends signed-in users to their workspace. */
function RootPage() {
  const { me, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return me ? <Navigate to={homeFor(me)} replace /> : IS_APP ? <Navigate to="/login" replace /> : <Landing />;
}

function RootRedirect() {
  const { me, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return <Navigate to={me ? homeFor(me) : '/login'} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<RootPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/share/:token" element={<PublicInvoice />} />
        <Route path="/invoices/:id/print" element={<PrintInvoice />} />

        <Route element={<ProtectedRoute kind="super" />}>
          <Route path="/super-admin" element={<SuperAdminLayout />}>
            <Route index element={<SuperDashboard />} />
            <Route path="configuration" element={<Configuration />} />
            <Route path="plans" element={<Plans />} />
            <Route path="features" element={<SuperFeatures />} />
            <Route path="activity" element={<Activity />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute kind="user" />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="pos" element={<Pos />} />
            <Route path="items" element={<Items />} />
            <Route path="items/new" element={<ItemForm />} />
            <Route path="items/rates" element={<TodayRates />} />
            <Route path="items/labels" element={<BarcodeLabels />} />
            <Route path="items/:id/edit" element={<ItemForm />} />
            <Route path="sales/customers" element={<Customers />} />
            <Route path="sales/quotes" element={<SalesOrders key="quote" kind="quote" />} />
            <Route path="sales/orders" element={<SalesOrders key="order" />} />
            <Route path="sales/challans" element={<DeliveryChallans />} />
            <Route path="field" element={<FieldDay />} />
            <Route path="field/team" element={<FieldTeam />} />
            <Route path="sales/invoices" element={<Invoices />} />
            <Route path="sales/invoices/new" element={<InvoiceForm />} />
            <Route path="sales/invoices/:id" element={<InvoiceView />} />
            <Route path="sales/invoices/:id/edit" element={<InvoiceForm />} />
            <Route path="sales/payments" element={<PaymentsReceived />} />
            <Route path="sales/credit-notes" element={<CreditNotes />} />
            <Route path="sales/recurring" element={<Recurring />} />
            <Route path="sales/offers" element={<Offers />} />
            <Route path="purchases" element={<Navigate to="/app/purchases/bills" replace />} />
            <Route path="purchases/vendors" element={<Vendors />} />
            <Route path="purchases/orders" element={<PurchaseOrders />} />
            <Route path="purchases/bills" element={<Purchases />} />
            <Route path="purchases/payments" element={<PaymentsMade />} />
            <Route path="inventory/warehouses" element={<Warehouses />} />
            <Route path="inventory/adjustments" element={<StockAdjustments />} />
            <Route path="inventory/transfers" element={<Transfers />} />
            <Route path="inventory/reorder" element={<StockInsights />} />
            <Route path="accounting/tally" element={<DataTransfer />} />
            <Route path="inventory/stock-summary" element={<StockSummary />} />
            <Route path="purchases/expenses" element={<Expenses />} />
            <Route path="banking" element={<Banking />} />
            <Route path="accounting/accounts" element={<Accounts />} />
            <Route path="accounting/journals" element={<Journals />} />
            <Route path="accounting/ledger" element={<Ledger />} />
            <Route path="microfinance" element={<LendingHome />} />
            <Route path="microfinance/borrowers" element={<Borrowers />} />
            <Route path="microfinance/borrowers/:id" element={<BorrowerView />} />
            <Route path="microfinance/loans" element={<Loans />} />
            <Route path="microfinance/loans/new" element={<LoanNew />} />
            <Route path="microfinance/loans/:id" element={<LoanView />} />
            <Route path="microfinance/collections" element={<Collections />} />
            <Route path="microfinance/planner" element={<Planner />} />
            <Route path="microfinance/reports" element={<LendingReports />} />
            <Route path="microfinance/settings" element={<LendingSettings />} />
            <Route path="reports" element={<ReportsHome />} />
            <Route path="reports/gst" element={<Reports />} />
            <Route path="reports/:id" element={<ReportView />} />
            <Route element={<SettingsLayout />}>
              <Route path="organization" element={<Organization />} />
              <Route path="team" element={<Team />} />
              <Route path="print-settings" element={<PrintSettings />} />
              <Route path="features" element={<Features />} />
              <Route path="billing" element={<Billing />} />
              <Route path="audit" element={<AuditLog />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}

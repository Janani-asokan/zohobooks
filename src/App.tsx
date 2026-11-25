import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FullPageSpinner, ProtectedRoute } from './components/ProtectedRoute';
import { hasSignedInBefore, homeFor, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import LandingPage from './pages/Landing';
import { DeleteAccountHelp, Privacy, Terms } from './pages/Legal';
import ResetPassword from './pages/ResetPassword';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AppLayout from './layouts/AppLayout';
import SettingsLayout from './layouts/SettingsLayout';
import { IS_APP } from './lib/platform';
import { PublicHelp } from './components/PublicHelp';

// Route-level code splitting keeps the first load small. In the CorpusLite phone app (IS_APP, a build-time constant)
// the web-only pages are left out of the package altogether, which keeps the app small.
const WebOnly = lazy(() => import('./pages/WebOnly'));
const PublicInvoice = IS_APP ? WebOnly : lazy(() => import('./pages/PublicInvoice'));
const PrintInvoice = lazy(() => import('./pages/PrintInvoice'));
// The website's front page is in the main bundle (not loaded separately), so visitors wait for one download fewer.
const Landing = IS_APP ? WebOnly : LandingPage;
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
const Attendance = lazy(() => import('./pages/app/Attendance'));
const FieldTeam = IS_APP ? WebOnly : lazy(() => import('./pages/app/FieldTeam'));
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
const Support = lazy(() => import('./pages/app/Support'));
const TransferNote = lazy(() => import('./pages/app/TransferNote'));
const BranchPricing = lazy(() => import('./pages/app/BranchPricing'));
const Licenses = lazy(() => import('./pages/app/Licenses'));
const LicenseDetail = lazy(() => import('./pages/app/LicenseDetail'));
const SuperSupport = lazy(() => import('./pages/super/Support'));
const SuperLogs = lazy(() => import('./pages/super/Logs'));
const SuperMyAccount = lazy(() => import('./pages/super/MyAccount'));
const Account = lazy(() => import('./pages/app/Account'));
const BarcodeLabels = lazy(() => import('./pages/app/BarcodeLabels'));

/** "/" shows the public landing page to visitors and sends signed-in users to their workspace. */
function RootPage() {
  const { me, loading } = useAuth();
  // A first-time visitor sees the front page at once instead of waiting for the "are you signed in?" check; only
  // someone who signed in on this device before waits for it (and is then taken to their workspace).
  if (loading) return IS_APP || hasSignedInBefore() ? <FullPageSpinner /> : <Landing />;
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
        <Route path="/signup" element={<Signup />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/share/:token" element={<PublicInvoice />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/delete-account" element={<DeleteAccountHelp />} />
        <Route path="/invoices/:id/print" element={<PrintInvoice />} />

        <Route element={<ProtectedRoute kind="super" />}>
          <Route path="/super-admin" element={<SuperAdminLayout />}>
            <Route index element={<SuperDashboard />} />
            <Route path="configuration" element={<Configuration />} />
            <Route path="plans" element={<Plans />} />
            <Route path="features" element={<SuperFeatures />} />
            <Route path="activity" element={<Activity />} />
            <Route path="support" element={<SuperSupport />} />
            <Route path="logs" element={<SuperLogs />} />
            <Route path="account" element={<SuperMyAccount />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute kind="user" />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="pos" element={<Pos />} />
            <Route path="account" element={<Account />} />
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
            <Route path="attendance" element={<Attendance />} />
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
            <Route path="inventory/transfers/:id/note" element={<TransferNote />} />
            <Route path="inventory/pricing" element={<BranchPricing />} />
            <Route path="inventory/reorder" element={<StockInsights />} />
            <Route path="accounting/tally" element={<DataTransfer />} />
            <Route path="inventory/stock-summary" element={<StockSummary />} />
            <Route path="purchases/expenses" element={<Expenses />} />
            <Route path="banking" element={<Banking />} />
            <Route path="accounting/accounts" element={<Accounts />} />
            <Route path="accounting/journals" element={<Journals />} />
            <Route path="accounting/ledger" element={<Ledger />} />
            <Route path="microfinance/*" element={<Navigate to="/app" replace />} />
            <Route path="licenses" element={<Licenses />} />
            <Route path="licenses/:id" element={<LicenseDetail />} />
            <Route path="reports" element={<ReportsHome />} />
            <Route path="reports/gst" element={<Reports />} />
            <Route path="reports/:id" element={<ReportView />} />
            <Route element={<SettingsLayout />}>
              <Route path="organization" element={<Organization />} />
              <Route path="team" element={<Team />} />
              <Route path="print-settings" element={<PrintSettings />} />
              <Route path="support" element={<Support />} />
              <Route path="features" element={<Features />} />
              <Route path="billing" element={<Billing />} />
              <Route path="audit" element={<AuditLog />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
      <PublicHelpWhenSignedOut />
    </Suspense>
  );
}

/** Help → Talk to sales on the landing, sign-in, sign-up and legal pages; signed-in users have Help in the app. */
function PublicHelpWhenSignedOut() {
  const { me } = useAuth();
  return <PublicHelp signedIn={!!me} />;
}

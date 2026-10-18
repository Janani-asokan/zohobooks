import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FullPageSpinner, ProtectedRoute } from './components/ProtectedRoute';
import { homeFor, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AppLayout from './layouts/AppLayout';
import SettingsLayout from './layouts/SettingsLayout';

// Route-level code splitting keeps the first load small.
const PublicInvoice = lazy(() => import('./pages/PublicInvoice'));
const Landing = lazy(() => import('./pages/Landing'));
const SuperDashboard = lazy(() => import('./pages/super/Dashboard'));
const Configuration = lazy(() => import('./pages/super/Configuration'));
const Plans = lazy(() => import('./pages/super/Plans'));
const Activity = lazy(() => import('./pages/super/Activity'));
const Home = lazy(() => import('./pages/app/Home'));
const Pos = lazy(() => import('./pages/app/Pos'));
const Items = lazy(() => import('./pages/app/Items'));
const ItemForm = lazy(() => import('./pages/app/ItemForm'));
const PurchaseOrders = lazy(() => import('./pages/app/PurchaseOrders'));
const Expenses = lazy(() => import('./pages/app/Expenses'));
const Vendors = lazy(() => import('./pages/app/Vendors'));
const Customers = lazy(() => import('./pages/app/Customers'));
const SalesOrders = lazy(() => import('./pages/app/SalesOrders'));
const Invoices = lazy(() => import('./pages/app/Invoices'));
const InvoiceForm = lazy(() => import('./pages/app/InvoiceForm'));
const InvoiceView = lazy(() => import('./pages/app/InvoiceView'));
const PaymentsReceived = lazy(() => import('./pages/app/PaymentsReceived'));
const CreditNotes = lazy(() => import('./pages/app/CreditNotes'));
const Recurring = lazy(() => import('./pages/app/Recurring'));
const Purchases = lazy(() => import('./pages/app/Purchases'));
const Banking = lazy(() => import('./pages/app/Banking'));
const Reports = lazy(() => import('./pages/app/Reports'));
const Organization = lazy(() => import('./pages/app/Organization'));
const Team = lazy(() => import('./pages/app/Team'));
const Billing = lazy(() => import('./pages/app/Billing'));
const PrintSettings = lazy(() => import('./pages/app/PrintSettings'));
const BarcodeLabels = lazy(() => import('./pages/app/BarcodeLabels'));

/** "/" shows the public landing page to visitors and sends signed-in users to their workspace. */
function RootPage() {
  const { me, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return me ? <Navigate to={homeFor(me)} replace /> : <Landing />;
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

        <Route element={<ProtectedRoute kind="super" />}>
          <Route path="/super-admin" element={<SuperAdminLayout />}>
            <Route index element={<SuperDashboard />} />
            <Route path="configuration" element={<Configuration />} />
            <Route path="plans" element={<Plans />} />
            <Route path="activity" element={<Activity />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute kind="user" />}>
          <Route path="/app/items/labels" element={<BarcodeLabels />} />
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="pos" element={<Pos />} />
            <Route path="items" element={<Items />} />
            <Route path="items/new" element={<ItemForm />} />
            <Route path="items/:id/edit" element={<ItemForm />} />
            <Route path="sales/customers" element={<Customers />} />
            <Route path="sales/orders" element={<SalesOrders />} />
            <Route path="sales/invoices" element={<Invoices />} />
            <Route path="sales/invoices/new" element={<InvoiceForm />} />
            <Route path="sales/invoices/:id" element={<InvoiceView />} />
            <Route path="sales/invoices/:id/edit" element={<InvoiceForm />} />
            <Route path="sales/payments" element={<PaymentsReceived />} />
            <Route path="sales/credit-notes" element={<CreditNotes />} />
            <Route path="sales/recurring" element={<Recurring />} />
            <Route path="purchases" element={<Navigate to="/app/purchases/bills" replace />} />
            <Route path="purchases/vendors" element={<Vendors />} />
            <Route path="purchases/orders" element={<PurchaseOrders />} />
            <Route path="purchases/bills" element={<Purchases />} />
            <Route path="purchases/expenses" element={<Expenses />} />
            <Route path="banking" element={<Banking />} />
            <Route path="reports" element={<Reports />} />
            <Route element={<SettingsLayout />}>
              <Route path="organization" element={<Organization />} />
              <Route path="team" element={<Team />} />
              <Route path="print-settings" element={<PrintSettings />} />
              <Route path="billing" element={<Billing />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}

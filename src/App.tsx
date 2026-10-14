import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { homeFor, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import AppLayout from './layouts/AppLayout';
import SuperDashboard from './pages/super/Dashboard';
import Configuration from './pages/super/Configuration';
import Home from './pages/app/Home';
import Items from './pages/app/Items';
import Customers from './pages/app/Customers';
import SalesOrders from './pages/app/SalesOrders';
import Invoices from './pages/app/Invoices';
import InvoiceForm from './pages/app/InvoiceForm';
import InvoiceView from './pages/app/InvoiceView';
import Purchases from './pages/app/Purchases';
import Banking from './pages/app/Banking';
import Reports from './pages/app/Reports';
import Organization from './pages/app/Organization';
import Team from './pages/app/Team';

function RootRedirect() {
  const { session } = useAuth();
  return <Navigate to={session ? homeFor(session.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute role="SuperAdmin" />}>
        <Route path="/super-admin" element={<SuperAdminLayout />}>
          <Route index element={<SuperDashboard />} />
          <Route path="configuration" element={<Configuration />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute role="CustomerAdmin" />}>
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="items" element={<Items />} />
          <Route path="sales/customers" element={<Customers />} />
          <Route path="sales/orders" element={<SalesOrders />} />
          <Route path="sales/invoices" element={<Invoices />} />
          <Route path="sales/invoices/new" element={<InvoiceForm />} />
          <Route path="sales/invoices/:id" element={<InvoiceView />} />
          <Route path="sales/invoices/:id/edit" element={<InvoiceForm />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="banking" element={<Banking />} />
          <Route path="reports" element={<Reports />} />
          <Route path="organization" element={<Organization />} />
          <Route path="team" element={<Team />} />
        </Route>
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}

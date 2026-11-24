import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { PrefsProvider } from './context/PrefsContext';
import { ApiError } from './api/client';
import { registerServiceWorker } from './pwa';
import { IS_APP } from './lib/platform';
import { installNativeBridges } from './lib/native';
import { installTableCards } from './lib/tableCards';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css'; // ₹ and Indian names with accents
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-ext-500.css'; // ₹ and Indian names with accents
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css'; // ₹ and Indian names with accents
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-700.css'; // ₹ and Indian names with accents
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-ext-500.css'; // ₹ and Indian names with accents
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-ext-600.css'; // ₹ and Indian names with accents
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-ext-700.css'; // ₹ and Indian names with accents
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/features.css';
import './styles/theme.css';
import './styles/documents.css';
import './styles/print.css';
import './styles/app.css';
import './styles/brand.css';

// On a phone: printing, downloads and outside links go through the app (no-op on the website).
installNativeBridges();
installTableCards();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline, still ask: the service worker (website, Windows app) or the phone's own copy answers with the saved
      // data. The library's default would wait for the internet and leave a screen opened offline empty.
      networkMode: 'offlineFirst',
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
    // Saves always run: offline, the API keeps them on this device (lib/outbox) and the screen carries on. The
    // default held every save until the internet came back, so the button just kept spinning.
    mutations: { networkMode: 'always' },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <PrefsProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </PrefsProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// The phone app ships its files inside the app; only the website uses the service worker.
if (!IS_APP) registerServiceWorker();

// Scrolling the page with the mouse over a focused number box would quietly change it (a rate of 950 becomes 949):
// let the wheel scroll the page instead.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === 'number') el.blur();
}, { passive: true });

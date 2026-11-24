import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MonitorDown, Smartphone } from 'lucide-react';
import { api } from '@/api/client';
import { IS_APP, IS_DESKTOP, WINDOWS_DOWNLOAD } from '@/lib/platform';

const AndroidInstall = lazy(() => import('./AndroidInstall'));

export interface AppsInfo {
  android: { apk: { url: string; version: string; bytes: number; fileName: string } | null; playUrl: string };
  windows: { url: string };
}
const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
export const onAndroid = () => /Android/i.test(ua());
const onPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(ua());
/** Not inside one of our apps already. */
const inBrowser = !IS_APP && !IS_DESKTOP;

export function useApps() {
  return useQuery({ queryKey: ['public', 'apps'], queryFn: () => api.get<AppsInfo>('/public/apps'), staleTime: 5 * 60_000, enabled: inBrowser, retry: false });
}

/**
 * "Get the app": the Windows installer on computers, the Android app on Android phones (the Play Store when it is
 * set, else the APK with install steps), and on a computer the Android app as a QR code to scan with the phone.
 * Hidden inside our own apps. `variant`: big pills (landing hero), small links (footer) or account-menu rows.
 */
export function AppDownloads({ variant, onClick }: { variant: 'hero' | 'footer' | 'menu'; onClick?: () => void }) {
  const apps = useApps().data;
  const [install, setInstall] = useState(false);
  if (!inBrowser) return null;
  const android = apps?.android;
  const hasAndroid = !!(android?.playUrl || android?.apk);
  const phone = onPhone();
  const winTitle = 'CorpusLite for Windows 10 and 11 · free · about 85 MB. Keeps billing when the internet drops.';
  const openAndroid = (e: React.MouseEvent) => {
    // On an Android phone with the Play Store link: just go there. Otherwise show the steps (and a QR code on a
    // computer); the menu stays open under it, so the steps aren't closed with it.
    if (android?.playUrl && onAndroid()) { onClick?.(); return; }
    e.preventDefault(); setInstall(true);
  };
  const androidHref = android?.playUrl || android?.apk?.url || '#';
  const modal = install && android ? <Suspense fallback={null}><AndroidInstall info={android} onClose={() => setInstall(false)} /></Suspense> : null;

  if (variant === 'hero') {
    if (phone) return onAndroid() && hasAndroid ? <><a className="lp-pill lp-pill-win" href={androidHref} onClick={openAndroid}><Smartphone size={18} /> <span>Get the Android app</span></a>{modal}</> : null;
    return <a className="lp-pill lp-pill-win" href={WINDOWS_DOWNLOAD} download title={winTitle}><MonitorDown size={18} /> <span>Download for Windows</span></a>;
  }
  if (variant === 'footer') {
    return (
      <>
        {!phone && <a href={WINDOWS_DOWNLOAD} download title={winTitle}><MonitorDown size={13} /> Windows app</a>}
        {hasAndroid && (!phone || onAndroid()) && <a href={androidHref} onClick={openAndroid}><Smartphone size={13} /> Android app</a>}
        {modal}
      </>
    );
  }
  return (
    <>
      {!phone && <a className="dropdown-item" href={WINDOWS_DOWNLOAD} download onClick={onClick} title={winTitle}><MonitorDown size={16} /> Get the Windows app</a>}
      {hasAndroid && (!phone || onAndroid()) && <a className="dropdown-item" href={androidHref} onClick={openAndroid}><Smartphone size={16} /> Get the Android app</a>}
      {modal}
    </>
  );
}

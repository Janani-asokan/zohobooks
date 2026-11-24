import { MonitorDown } from 'lucide-react';
import { WINDOWS_DOWNLOAD, offerWindowsApp } from '@/lib/platform';

/**
 * "Download for Windows": the CorpusLite installer for Windows 10 / 11. Shown on computers in a browser; hidden on
 * phones and inside the apps. `variant` picks the look: a big pill (landing hero), a plain link (footer) or a menu row.
 */
export function WindowsDownload({ variant = 'pill', className = '', onClick }: { variant?: 'pill' | 'link' | 'menu'; className?: string; onClick?: () => void }) {
  if (!offerWindowsApp()) return null;
  const title = 'CorpusLite for Windows 10 and 11 · free · about 85 MB. Works when the internet drops.';
  if (variant === 'menu') return <a className={`dropdown-item ${className}`} href={WINDOWS_DOWNLOAD} download onClick={onClick} title={title}><MonitorDown size={16} /> Get the Windows app</a>;
  if (variant === 'link') return <a className={className} href={WINDOWS_DOWNLOAD} download title={title}><MonitorDown size={13} /> Windows app</a>;
  return (
    <a className={`lp-pill lp-pill-win ${className}`} href={WINDOWS_DOWNLOAD} download title={title}>
      <MonitorDown size={18} /> <span>Download for Windows</span>
    </a>
  );
}

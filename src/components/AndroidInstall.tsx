import { Download, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui';
import { useQr } from '@/components/qr';
import type { AppsInfo } from './AppDownloads';
import { onAndroid } from './AppDownloads';

/** How to get the Android app: a QR code to scan from a computer, or the download with the steps Android asks for. */
export default function AndroidInstall({ info, onClose }: { info: AppsInfo['android']; onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const target = info.playUrl || (info.apk ? origin + info.apk.url : '');
  const qr = useQr(onAndroid() ? null : target);
  const mb = info.apk ? `${(info.apk.bytes / 1_048_576).toFixed(1)} MB` : '';
  return (
    <Modal open onClose={onClose} title="Get the Android app" subtitle={info.apk?.version ? `CorpusLite ${info.apk.version}${mb ? ` · ${mb}` : ''} · free` : 'CorpusLite · free'}
      footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <div className="app-install">
        {qr && <figure><img src={qr} width={200} height={200} alt="QR code to get the Android app" /><figcaption className="small muted">Scan with your phone’s camera</figcaption></figure>}
        <div>
          {info.playUrl ? (
            <p><a className="btn btn-primary" href={info.playUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in Google Play</a></p>
          ) : info.apk && (
            <>
              <p><a className="btn btn-primary" href={info.apk.url} download><Download size={15} /> Download the app ({mb})</a></p>
              <ol className="small app-install-steps">
                <li>Open the downloaded file <strong>CorpusLite-{info.apk.version || 'app'}.apk</strong> (from the notification or the Downloads folder).</li>
                <li>If Android asks, tap <strong>Settings</strong> and turn on <strong>Allow from this source</strong> for your browser, then go back.</li>
                <li>Tap <strong>Install</strong>, then <strong>Open</strong>, and sign in with your Corpus360 email.</li>
              </ol>
              <p className="small muted">Already have the app? Installing the new file updates it and keeps your data.</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

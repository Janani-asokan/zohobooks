/**
 * Apps offered on the website. Windows: the installer built with the server (dist/downloads/CorpusLite-Setup.exe).
 * Android: the APK the super admin uploads (Configuration → App downloads), and/or the Play Store link once the app
 * is live there (the Play Store is preferred: it updates the app by itself).
 */
import crypto from 'node:crypto';
import { query } from '../db';
import { badRequest } from '../http';

export const ANDROID_PATH = '/downloads/CorpusLite.apk';
export const WINDOWS_PATH = '/downloads/CorpusLite-Setup.exe';
const PLAY_RE = /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+/;

export async function appsInfo() {
  const [a] = await query('SELECT version, file_name, bytes, play_url, updated_at, (file IS NOT NULL) AS has_file FROM app_downloads WHERE platform = $1', ['android']);
  return {
    android: {
      apk: a?.has_file ? { url: ANDROID_PATH, version: a.version as string, bytes: a.bytes as number, fileName: a.file_name as string, updatedAt: a.updated_at } : null,
      playUrl: (a?.play_url as string) || '',
    },
    windows: { url: WINDOWS_PATH },
  };
}

/** The super admin sets the Android app: a new APK (base64), its version, and/or the Play Store link. */
export async function setAndroid(by: string | null, b: { fileBase64?: string; fileName?: string; version?: string; playUrl?: string; removeFile?: boolean }) {
  if (b.playUrl && !PLAY_RE.test(b.playUrl)) throw badRequest('Paste the app’s Play Store link (https://play.google.com/store/apps/details?id=…)');
  let file: Buffer | null = null;
  if (b.fileBase64) {
    file = Buffer.from(b.fileBase64, 'base64');
    // An APK is a zip file that holds AndroidManifest.xml.
    if (file.length < 1000 || file.readUInt32LE(0) !== 0x04034b50 || !file.includes(Buffer.from('AndroidManifest.xml'))) throw badRequest('That isn’t an Android app file (.apk). Upload the .apk, not the .aab.');
  }
  const version = (b.version ?? '').trim() || /(\d+\.\d+(?:\.\d+)?)/.exec(b.fileName ?? '')?.[1] || '';
  await query(`INSERT INTO app_downloads (platform, version, file_name, file, bytes, sha256, play_url, uploaded_by, updated_at)
      VALUES ('android', $1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (platform) DO UPDATE SET
        version = CASE WHEN $3::bytea IS NOT NULL OR $8 THEN $1 ELSE app_downloads.version END,
        file_name = CASE WHEN $3::bytea IS NOT NULL THEN $2 WHEN $8 THEN '' ELSE app_downloads.file_name END,
        file = CASE WHEN $3::bytea IS NOT NULL THEN $3 WHEN $8 THEN NULL ELSE app_downloads.file END,
        bytes = CASE WHEN $3::bytea IS NOT NULL THEN $4 WHEN $8 THEN 0 ELSE app_downloads.bytes END,
        sha256 = CASE WHEN $3::bytea IS NOT NULL THEN $5 WHEN $8 THEN '' ELSE app_downloads.sha256 END,
        play_url = COALESCE($9, app_downloads.play_url), uploaded_by = $7, updated_at = now()`,
  [version, b.fileName ?? '', file, file?.length ?? 0, file ? crypto.createHash('sha256').update(file).digest('hex') : '', b.playUrl ?? '', by, !!b.removeFile, b.playUrl ?? null]);
  return appsInfo();
}

export async function androidFile() {
  const [r] = await query('SELECT file, version, sha256 FROM app_downloads WHERE platform = $1 AND file IS NOT NULL', ['android']);
  return r ? { file: r.file as Buffer, version: r.version as string, sha256: r.sha256 as string } : null;
}

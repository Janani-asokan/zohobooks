// CorpusLite for Windows: the full corpus360lite.com app in its own window, always the latest version.
const { app, BrowserWindow, shell, session, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Location (staff attendance) from Windows' own location service; Electron's default needs a Google key and fails.
app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation');
// The server recognises the Windows app by this (it allows the voice engine's code there only).
app.userAgentFallback = `${app.userAgentFallback} CorpusLiteDesktop/${app.getVersion()}`;
// For testing against a local server: CORPUS_SITE=http://localhost:4000

const SITE = process.env.CORPUS_SITE || 'https://corpus360lite.com';
const HOST = new URL(SITE).host;
let win;
// Bills made offline that haven't reached the server yet (the counter page reports the count).
let pending = 0;
ipcMain.on('pending-bills', (_e, n) => { pending = Math.max(0, Number(n) || 0); });
// Voice billing: the speech model shipped with the app (resources/voice), read once and handed to the page.
let voiceModel = null;
ipcMain.handle('voice-model', () => {
  if (voiceModel) return voiceModel;
  for (const p of [path.join(process.resourcesPath || '', 'voice', 'en-in.tar.gz'), path.join(__dirname, 'build', 'voice', 'en-in.tar.gz')]) {
    try { voiceModel = fs.readFileSync(p); return voiceModel; } catch { /* next */ }
  }
  return null;
});

const isOurs = (url) => { try { const u = new URL(url); return (u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost')) && (u.host === HOST || u.host.endsWith('.' + HOST)); } catch { return false; } };

const isPayment = (url) => { try { const h = new URL(url).hostname; return h === 'razorpay.com' || h.endsWith('.razorpay.com'); } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.setAppUserModelId('in.corpus360.lite');

function showOffline() {
  win.loadFile(path.join(__dirname, 'offline.html'));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 380, minHeight: 560,
    title: 'CorpusLite', backgroundColor: '#ffffff', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    // plugins: the built-in PDF viewer, so invoices and reports open in the app instead of only downloading.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, plugins: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // Closing with bills still waiting: they are safe on this PC, but say so, and offer to keep the app open to send them.
  win.on('close', (e) => {
    if (!pending) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Keep open to send them', 'Close anyway'], defaultId: 0, cancelId: 0,
      message: `${pending} bill${pending === 1 ? '' : 's'} made offline ${pending === 1 ? 'is' : 'are'} not sent yet`,
      detail: 'They are saved safely on this computer and will be sent the next time you open CorpusLite with the internet on.',
    });
    if (r === 0) e.preventDefault();
  });

  // Links to other sites (WhatsApp, email, maps, payment pages) open in the normal browser or app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    // Card / net-banking payment windows (Razorpay, then the bank) stay inside the app: the payment reports back to
    // the page that opened it, which an outside browser can't do.
    if (isPayment(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 760 } };
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isOurs(url) || url.startsWith('file:')) return;
    e.preventDefault();
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
  });
  // A page with unsaved changes asks before leaving (a browser shows its own box; Electron would just refuse to close).
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, message: 'Leave this page?', detail: 'Changes you made may not be saved.' });
    if (r === 0) e.preventDefault();
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && isOurs(url)) showOffline();
  });

  // Right-click: cut, copy, paste and spelling suggestions (Electron has no menu of its own).
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    for (const w of (p.dictionarySuggestions || []).slice(0, 5)) items.push({ label: w, click: () => win.webContents.replaceMisspelling(w) });
    if (p.misspelledWord) items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    if (p.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (p.linkURL && !p.isEditable) items.push({ label: 'Copy link', click: () => require('electron').clipboard.writeText(p.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  // The mouse's back / forward buttons.
  win.on('app-command', (_e, cmd) => {
    const h = win.webContents.navigationHistory;
    if (cmd === 'browser-backward' && h.canGoBack()) h.goBack();
    if (cmd === 'browser-forward' && h.canGoForward()) h.goForward();
  });

  win.loadURL(SITE + '/app');
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  try { ses.setSpellCheckerLanguages(['en-IN', 'en-US'].filter((l) => ses.availableSpellCheckerLanguages.includes(l))); } catch { /* */ }
  // Camera (attendance selfie, barcode scan), location (attendance), notifications, clipboard: only for our site.
  const allowed = new Set(['media', 'geolocation', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm) && isOurs(wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm) => allowed.has(perm) && !!wc && isOurs(wc.getURL()));

  // Downloads (PDF, Excel, CSV) ask where to save, then offer to open the file.
  ses.on('will-download', (_e, item) => {
    item.once('done', (_ev, state) => {
      if (state === 'completed') {
        dialog.showMessageBox(win, { type: 'info', buttons: ['Open', 'Show in folder', 'Close'], defaultId: 0, message: `Saved ${item.getFilename()}` })
          .then(({ response }) => { if (response === 0) shell.openPath(item.getSavePath()); if (response === 1) shell.showItemInFolder(item.getSavePath()); });
      }
    });
  });

  const go = (p) => () => win && win.loadURL(SITE + p);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Dashboard', accelerator: 'Ctrl+Shift+H', click: go('/app') }, { label: 'Print…', accelerator: 'Ctrl+P', click: () => win && win.webContents.print() }, { type: 'separator' }, { role: 'quit', label: 'Exit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Back', accelerator: 'Alt+Left', click: () => win && win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => win && win.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
      { role: 'reload' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'Customer support', click: go('/app/support') }, { label: 'Open in browser', click: () => shell.openExternal(win ? (isOurs(win.webContents.getURL()) ? win.webContents.getURL() : SITE) : SITE) }, { type: 'separator' }, { label: `About CorpusLite ${app.getVersion()}`, click: () => dialog.showMessageBox(win, { message: `CorpusLite ${app.getVersion()}`, detail: 'GST billing by Corpus360.\nThe app always opens the latest version of corpus360lite.com.' }) }] },
  ]));

  createWindow();
});

app.on('window-all-closed', () => app.quit());

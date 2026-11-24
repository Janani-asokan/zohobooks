// CorpusLite for Windows: the full corpus360lite.com app in its own window, always the latest version.
const { app, BrowserWindow, shell, session, Menu, dialog } = require('electron');
const path = require('path');

const SITE = 'https://corpus360lite.com';
const HOST = new URL(SITE).host;
let win;

const isOurs = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && (u.host === HOST || u.host.endsWith('.' + HOST)); } catch { return false; } };

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // Links to other sites (WhatsApp, email, maps, payment pages) open in the normal browser or app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isOurs(url) || url.startsWith('file:')) return;
    e.preventDefault();
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && isOurs(url)) showOffline();
  });

  win.loadURL(SITE + '/app');
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
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

# CorpusLite for Windows

A Windows app that opens the full corpus360lite.com in its own window, so it is always the latest version and needs no update when the website changes.

- Links to WhatsApp, email and payment pages open in the normal browser or app.
- PDFs, Excel and CSV files ask where to save, then offer to open the file.
- Camera and location (attendance, barcode) are allowed only for corpus360lite.com.
- With no internet it shows a "Try again" page and reconnects by itself.

## Build

```bash
npm install
npm run dist
```

This writes `dist/CorpusLite-Setup-<version>.exe`. The installer works without admin rights, installs for the current user, and adds desktop and Start menu shortcuts plus an entry in Windows "Installed apps" for uninstalling. Wine is not needed: the icon is set in JavaScript (`scripts/exe-info.mjs`) and the installer is made with NSIS (`installer.nsi`).

Raise `version` in `package.json` for every new build.

// Lets the site know it is running in the Windows app; the offline page can retry, and the counter tells the app how
// many bills made offline are still waiting to be sent (so closing the app can mention them).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('corpusDesktop', {
  platform: 'windows',
  retry: () => location.replace(new URL('/app', location.href.startsWith('file:') ? 'https://corpus360lite.com' : location.origin).href),
  setPending: (n) => ipcRenderer.send('pending-bills', Number(n) || 0),
  // Voice billing's speech model (shipped with the app): the bytes of a .tar.gz, or null.
  voiceModel: () => ipcRenderer.invoke('voice-model').then((b) => (b ? new Uint8Array(b) : null)),
});

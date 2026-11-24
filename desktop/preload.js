// Lets the site know it is running in the Windows app; the offline page can retry, and the counter tells the app how
// many bills made offline are still waiting to be sent (so closing the app can mention them).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('corpusDesktop', {
  platform: 'windows',
  retry: () => location.replace('https://corpus360lite.com/app'),
  setPending: (n) => ipcRenderer.send('pending-bills', Number(n) || 0),
});

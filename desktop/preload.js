// Lets the site know it is running in the Windows app; also lets the offline page retry.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('corpusDesktop', { platform: 'windows', retry: () => location.replace('https://corpus360lite.com/app') });

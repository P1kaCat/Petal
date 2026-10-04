const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petal', {
  call: async (method, args) => { const result = await ipcRenderer.invoke('petal:call', method, args); if (result.error) throw new Error(result.error); return result.data; },
  onEvent: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('petal:event', listener); return () => ipcRenderer.removeListener('petal:event', listener); }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostBridge', {
  getScreenSource: () => ipcRenderer.invoke('get-screen-source'),
  sendRemoteInput: (msg) => ipcRenderer.send('remote-input', msg),
});

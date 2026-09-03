const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFile:  () => ipcRenderer.invoke('open-file'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openPrivacy: () => ipcRenderer.invoke('open-privacy'),
  edgeTTS:   (params) => ipcRenderer.invoke('edge-tts', params),
  systemTTS: (params) => ipcRenderer.invoke('system-tts', params),
  chooseExportPath: (opts) => ipcRenderer.invoke('choose-export-path', opts),
  saveExport: (payload) => ipcRenderer.invoke('save-export', payload),
})

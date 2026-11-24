const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('packToolUpdate', {
  state: () => ipcRenderer.invoke('packtool:update:state'),
  check: () => ipcRenderer.invoke('packtool:update:check'),
  download: () => ipcRenderer.invoke('packtool:update:download'),
  cancel: () => ipcRenderer.invoke('packtool:update:cancel'),
  install: () => ipcRenderer.invoke('packtool:update:install'),
})

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('subscriptionStore', {
  read: () => ipcRenderer.invoke('subscriptions:read'),
  save: (records) => ipcRenderer.invoke('subscriptions:save', records),
  refresh: (link) => ipcRenderer.invoke('subscriptions:refresh', link),
})

contextBridge.exposeInMainWorld('aiGatewayStore', {
  read: () => ipcRenderer.invoke('ai:read'),
  save: (gateways) => ipcRenderer.invoke('ai:save', gateways),
  probe: (gatewayId, endpointId) => ipcRenderer.invoke('ai:probe', gatewayId, endpointId),
  copyKey: (gatewayId, endpointId) => ipcRenderer.invoke('ai:copy-key', gatewayId, endpointId),
})

contextBridge.exposeInMainWorld('domainStore', {
  read: () => ipcRenderer.invoke('domains:read'),
  save: (records) => ipcRenderer.invoke('domains:save', records),
  lookup: (domainName) => ipcRenderer.invoke('domains:lookup', domainName),
})

contextBridge.exposeInMainWorld('serverStore', {
  read: () => ipcRenderer.invoke('servers:read'),
  save: (records) => ipcRenderer.invoke('servers:save', records),
  probe: (serverId) => ipcRenderer.invoke('servers:probe', serverId),
})

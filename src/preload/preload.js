'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listeners = { snapshot: new Set(), theme: new Set(), goplan: new Set() };

ipcRenderer.on('snapshot', (_e, snap) => listeners.snapshot.forEach((fn) => fn(snap)));
ipcRenderer.on('theme', (_e, info) => listeners.theme.forEach((fn) => fn(info)));
ipcRenderer.on('goplan', (_e, payload) => listeners.goplan.forEach((fn) => fn(payload)));

contextBridge.exposeInMainWorld('gauge', {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  refresh: () => ipcRenderer.invoke('snapshot:refresh'),
  onSnapshot: (fn) => {
    listeners.snapshot.add(fn);
    return () => listeners.snapshot.delete(fn);
  },
  onTheme: (fn) => {
    listeners.theme.add(fn);
    return () => listeners.theme.delete(fn);
  },
  onGoPlan: (fn) => {
    listeners.goplan.add(fn);
    return () => listeners.goplan.delete(fn);
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setGeneral: (patch) => ipcRenderer.invoke('settings:setGeneral', patch),
  setProvider: (id, patch) => ipcRenderer.invoke('settings:setProvider', id, patch),
  testProvider: (id, secret) => ipcRenderer.invoke('provider:test', id, secret),

  getGoPlan: (force) => ipcRenderer.invoke('goplan:get', force),
  setPanelHeight: (h) => ipcRenderer.invoke('panel:height', h),
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  quit: () => ipcRenderer.invoke('app:quit'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
});

'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stage', {
  getState: () => ipcRenderer.invoke('stage:get-state'),
  addRoot: () => ipcRenderer.invoke('stage:add-root'),
  removeRoot: (dir) => ipcRenderer.invoke('stage:remove-root', dir),
  select: (dir) => ipcRenderer.invoke('stage:select', dir),
  open: (dir) => ipcRenderer.invoke('stage:open', dir),
  reveal: (dir) => ipcRenderer.invoke('stage:reveal', dir),
  revealSkill: () => ipcRenderer.invoke('stage:reveal-skill'),
  remoteGet: () => ipcRenderer.invoke('stage:remote-get'),
  remoteToggle: (on) => ipcRenderer.invoke('stage:remote-toggle', on),
  remoteReset: () => ipcRenderer.invoke('stage:remote-reset'),
  remoteKick: (sid) => ipcRenderer.invoke('stage:remote-kick', sid),
  copy: (text) => ipcRenderer.invoke('stage:copy', text),
  onChanged: (fn) => ipcRenderer.on('stage:changed', () => fn()),
  onShowSkills: (fn) => ipcRenderer.on('stage:show-skills', () => fn()),
  onShowRemote: (fn) => ipcRenderer.on('stage:show-remote', () => fn())
});

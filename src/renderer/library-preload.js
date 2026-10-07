'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stage', {
  getState: () => ipcRenderer.invoke('stage:get-state'),
  addRoot: () => ipcRenderer.invoke('stage:add-root'),
  removeRoot: (dir) => ipcRenderer.invoke('stage:remove-root', dir),
  addRemote: (spec) => ipcRenderer.invoke('stage:add-remote', spec),
  connections: () => ipcRenderer.invoke('stage:connections'),
  forgetConnection: (id) => ipcRenderer.invoke('stage:forget-connection', id),
  refreshRemote: (spec) => ipcRenderer.invoke('stage:refresh-remote', spec),
  select: (dir) => ipcRenderer.invoke('stage:select', dir),
  exportDeck: (dir, kind) => ipcRenderer.invoke('stage:export', dir, kind),
  open: (dir) => ipcRenderer.invoke('stage:open', dir),
  previewGet: (dir, retry) => ipcRenderer.invoke('stage:preview-get', dir, retry),
  onPreviewUpdate: (fn) => ipcRenderer.on('stage:preview-update', (_e, dir) => fn(dir)),
  installDemo: () => ipcRenderer.invoke('stage:demo-install'),
  removeDemo: () => ipcRenderer.invoke('stage:demo-remove'),
  setPointer: (prefs) => ipcRenderer.invoke('stage:pointer-set', prefs),
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

const { contextBridge, ipcMain } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  version: process.versions.electron
});

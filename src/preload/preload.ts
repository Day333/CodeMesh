import { contextBridge, ipcRenderer } from "electron";
import type {
  CodeMeshApi,
  CodeWindow,
  Settings,
  StoredState,
  TerminalSnapshot,
  WindowRule,
} from "../shared/types";

function listen<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) =>
    callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: CodeMeshApi = {
  bootstrap: () => ipcRenderer.invoke("bootstrap"),
  chooseDirectory: () => ipcRenderer.invoke("directory:choose"),
  addProject: (folder) => ipcRenderer.invoke("project:add", folder),
  removeProject: (id) => ipcRenderer.invoke("project:remove", id),
  addFavorite: (folder) => ipcRenderer.invoke("favorite:add", folder),
  removeFavorite: (folder) => ipcRenderer.invoke("favorite:remove", folder),
  updateSettings: (settings: Partial<Settings>) =>
    ipcRenderer.invoke("settings:update", settings),
  setWindowRule: (id: string, rule: WindowRule) =>
    ipcRenderer.invoke("windows:rule", id, rule),
  listWindows: () => ipcRenderer.invoke("windows:list"),
  focusWindow: (id) => ipcRenderer.invoke("windows:focus", id),
  tileWindow: (id) => ipcRenderer.invoke("windows:tile", id),
  prepareOverlayWindow: (id, projectId) =>
    ipcRenderer.invoke("windows:overlay:prepare", id, projectId),
  positionOverlayWindow: (id, projectId, bounds) =>
    ipcRenderer.invoke("windows:overlay:position", id, projectId, bounds),
  releaseOverlayWindow: (id) =>
    ipcRenderer.invoke("windows:overlay:release", id),
  onOverlaySync: (callback) => listen("windows:overlay:sync", () => callback()),
  openCode: (folder) => ipcRenderer.invoke("code:open", folder),
  listDirectory: (folder) => ipcRenderer.invoke("directory:list", folder),
  openFile: (filename) => ipcRenderer.invoke("file:open", filename),
  readEditableFile: (filename) => ipcRenderer.invoke("editor:read", filename),
  saveEditableFile: (filename, content, revision) =>
    ipcRenderer.invoke("editor:save", filename, content, revision),
  createTerminal: (input) => ipcRenderer.invoke("terminal:create", input),
  updateTerminal: (id, input) =>
    ipcRenderer.invoke("terminal:update", id, input),
  closeTerminal: (id) => ipcRenderer.invoke("terminal:close", id),
  writeTerminal: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
  resizeTerminal: (id, cols, rows) =>
    ipcRenderer.invoke("terminal:resize", id, cols, rows),
  onWindowsChanged: (callback: (windows: CodeWindow[]) => void) =>
    listen("windows:changed", callback),
  onTerminalData: (callback: (event: { id: string; data: string }) => void) =>
    listen("terminal:data", callback),
  onTerminalExit: (callback: (id: string) => void) =>
    listen("terminal:exit", callback),
  onStateChanged: (callback: (state: StoredState) => void) =>
    listen("state:changed", callback),
};

contextBridge.exposeInMainWorld("codemesh", api);

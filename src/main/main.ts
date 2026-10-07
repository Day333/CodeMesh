import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  shell,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store";
import { TerminalManager } from "./terminals";
import {
  focusCodeWindow,
  launchCode,
  listCodeWindows,
  setSessionWindowRule,
} from "./windows";
import type {
  CodeWindow,
  DirectoryResult,
  Settings,
  ShellKind,
  WindowRule,
} from "../shared/types";
import { runSmoke } from "./smoke";

if (process.platform !== "win32")
  throw new Error("CodeMesh 目前仅支持 Windows");
if (process.env.CODEMESH_SMOKE_OUT) {
  app.setPath(
    "userData",
    fs.mkdtempSync(path.join(os.tmpdir(), "codemesh-smoke-")),
  );
}
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | null = null;
let store: Store;
let terminals: TerminalManager;
let previousWindows = "";

function send(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, value);
}

function requireDirectory(value: unknown): string {
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error("无效文件夹路径");
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("文件夹不存在");
  return resolved;
}

function requireFile(value: unknown): string {
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error("无效文件路径");
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved).isFile()) throw new Error("文件不存在");
  return resolved;
}

function listDirectory(value: unknown): DirectoryResult {
  const folder = requireDirectory(value);
  const root = path.parse(folder).root;
  const entries = fs
    .readdirSync(folder, { withFileTypes: true })
    .map((item) => {
      const entryPath = path.join(folder, item.name);
      let size: number | null = null;
      if (item.isFile()) {
        try {
          size = fs.statSync(entryPath).size;
        } catch {
          /* Disappeared during listing. */
        }
      }
      return {
        name: item.name,
        path: entryPath,
        isDirectory: item.isDirectory(),
        size,
      };
    })
    .filter((item) => item.isDirectory || item.size !== null);
  entries.sort(
    (a, b) =>
      Number(b.isDirectory) - Number(a.isDirectory) ||
      a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
  );
  return {
    path: folder,
    parent:
      folder.toLowerCase() === root.toLowerCase() ? null : path.dirname(folder),
    entries,
  };
}

function refreshWindows(): CodeWindow[] {
  const windows = listCodeWindows(store.get());
  const serial = JSON.stringify(windows);
  if (serial !== previousWindows) {
    previousWindows = serial;
    send("windows:changed", windows);
  }
  return windows;
}

function registerIpc(): void {
  ipcMain.handle("bootstrap", () => ({
    state: store.get(),
    windows: refreshWindows(),
    terminals: terminals.list(),
  }));
  ipcMain.handle("directory:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("project:add", (_event, folder: unknown) => {
    const result = store.addProject(requireDirectory(folder));
    send("state:changed", result);
    return result;
  });
  ipcMain.handle("project:remove", (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("无效项目");
    const result = store.removeProject(id);
    send("state:changed", result);
    refreshWindows();
    return result;
  });
  ipcMain.handle("favorite:add", (_event, folder: unknown) => {
    const result = store.addFavorite(requireDirectory(folder));
    send("state:changed", result);
    return result;
  });
  ipcMain.handle("favorite:remove", (_event, folder: unknown) => {
    if (typeof folder !== "string") throw new Error("无效文件夹");
    const result = store.removeFavorite(folder);
    send("state:changed", result);
    return result;
  });
  ipcMain.handle("settings:update", (_event, input: Partial<Settings>) => {
    const result = store.updateSettings(input);
    send("state:changed", result);
    return result;
  });
  ipcMain.handle("windows:list", () => refreshWindows());
  ipcMain.handle(
    "windows:focus",
    (_event, id: unknown) => typeof id === "string" && focusCodeWindow(id),
  );
  ipcMain.handle("windows:capture-source", async (event, id: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof id !== "string")
      throw new Error("无效窗口请求");
    if (!refreshWindows().some((item) => item.id === id))
      throw new Error("该 VS Code 窗口已关闭");
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
    });
    const source = sources.find((item) => {
      const match = /^window:(\d+):\d+$/.exec(item.id);
      return match && BigInt(match[1]) === BigInt(id);
    });
    if (!source) throw new Error("Windows 未提供该窗口的画面预览");
    return source.id;
  });
  ipcMain.handle("windows:rule", (_event, id: unknown, rule: WindowRule) => {
    const openWindows = refreshWindows();
    const window = openWindows.find((item) => item.id === id);
    if (!window) throw new Error("该 VS Code 窗口已关闭");
    setSessionWindowRule(window.id, rule);
    const sameTitle = openWindows.filter(
      (item) =>
        item.title.toLocaleLowerCase() === window.title.toLocaleLowerCase(),
    );
    const state =
      sameTitle.length === 1
        ? store.setWindowRule(window.title, rule)
        : store.get();
    send("state:changed", state);
    return refreshWindows();
  });
  ipcMain.handle("code:open", async (_event, folder: unknown) =>
    launchCode(requireDirectory(folder)),
  );
  ipcMain.handle("directory:list", (_event, folder: unknown) =>
    listDirectory(folder),
  );
  ipcMain.handle("file:open", async (_event, filename: unknown) => {
    const error = await shell.openPath(requireFile(filename));
    if (error) throw new Error(error);
  });
  ipcMain.handle(
    "terminal:create",
    (
      _event,
      input: { projectId: string | null; cwd: string; shell: ShellKind },
    ) => {
      if (!input || !["powershell", "cmd"].includes(input.shell))
        throw new Error("无效终端类型");
      const cwd = requireDirectory(input.cwd || os.homedir());
      const projectId =
        input.projectId &&
        store.get().projects.some((item) => item.id === input.projectId)
          ? input.projectId
          : null;
      const snapshot = terminals.create({ projectId, cwd, shell: input.shell });
      const state = store.addTerminal({
        id: snapshot.id,
        projectId,
        cwd,
        shell: input.shell,
        title: snapshot.title,
      });
      send("state:changed", state);
      return snapshot;
    },
  );
  ipcMain.handle("terminal:close", (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("无效终端");
    terminals.close(id);
    send("state:changed", store.removeTerminal(id));
  });
  ipcMain.handle("terminal:write", (_event, id: unknown, data: unknown) => {
    if (
      typeof id !== "string" ||
      typeof data !== "string" ||
      data.length > 100000
    )
      throw new Error("无效终端输入");
    terminals.write(id, data);
  });
  ipcMain.handle(
    "terminal:resize",
    (_event, id: unknown, cols: number, rows: number) => {
      if (
        typeof id !== "string" ||
        !Number.isFinite(cols) ||
        !Number.isFinite(rows)
      )
        throw new Error("无效终端尺寸");
      terminals.resize(id, cols, rows);
    },
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: "#080d17",
    title: "CodeMesh",
    show: false,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.env.CODEMESH_DEV_URL)
    void mainWindow.loadURL(process.env.CODEMESH_DEV_URL);
  else
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

void app.whenReady().then(() => {
  app.setAppUserModelId("dev.codemesh.desktop");
  store = new Store();
  terminals = new TerminalManager(
    (id, data) => send("terminal:data", { id, data }),
    (id) => send("terminal:exit", id),
  );
  for (const definition of store.get().terminals) {
    try {
      terminals.start(definition);
    } catch {
      /* An unavailable folder or shell appears as a missing session. */
    }
  }
  registerIpc();
  createWindow();
  if (process.env.CODEMESH_SMOKE_OUT && mainWindow) {
    const output = process.env.CODEMESH_SMOKE_OUT;
    mainWindow.webContents.once("did-finish-load", () => {
      void runSmoke(
        mainWindow!,
        output,
        process.env.CODEMESH_SMOKE_CWD || process.cwd(),
        store,
      ).finally(() => app.quit());
    });
  }
  setInterval(() => {
    try {
      refreshWindows();
    } catch {
      /* Retry on next poll. */
    }
  }, 4000).unref();
  app.on("second-instance", () => {
    mainWindow?.restore();
    mainWindow?.focus();
  });
});

app.on("before-quit", () => {
  terminals?.closeAll();
});
app.on("window-all-closed", () => app.quit());

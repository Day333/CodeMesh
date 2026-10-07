import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store";
import { TerminalManager } from "./terminals";
import {
  focusCodeWindow,
  hideOverlayCodeWindow,
  launchCode,
  listCodeWindows,
  overlayCodeWindow,
  placeCodeWindow,
  raiseOverlayCodeWindow,
  releaseOverlayCodeWindow,
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
import { runOverlaySmoke } from "./overlay-smoke";
import { readEditableFile, saveEditableFile } from "./editor-files";

if (process.platform !== "win32")
  throw new Error("CodeMesh 目前仅支持 Windows");
if (process.env.CODEMESH_SMOKE_OUT || process.env.CODEMESH_OVERLAY_SMOKE_OUT) {
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
    for (const terminal of terminals.list()) {
      if (terminal.projectId === id)
        terminals.updateMetadata(terminal.id, { projectId: null });
    }
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
  ipcMain.handle("windows:tile", (event, id: unknown) => {
    if (
      event.sender !== mainWindow?.webContents ||
      typeof id !== "string" ||
      !mainWindow
    )
      throw new Error("无效窗口请求");
    if (!refreshWindows().some((item) => item.id === id))
      throw new Error("该 VS Code 窗口已关闭");
    const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    if (workArea.width < 1680 || workArea.height < 700)
      throw new Error(
        "屏幕空间不足，至少需要 1680×700 才能让两个窗口并排。可以使用 Alt+Tab 切换。",
      );
    const left = Math.floor(workArea.width / 2);
    const right = workArea.width - left;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setBounds({
      x: workArea.x,
      y: workArea.y,
      width: left,
      height: workArea.height,
    });
    placeCodeWindow(id, {
      x: workArea.x + left,
      y: workArea.y,
      width: right,
      height: workArea.height,
    });
    mainWindow.focus();
  });
  ipcMain.handle("windows:overlay:prepare", (event, id: unknown) => {
    if (
      event.sender !== mainWindow?.webContents ||
      typeof id !== "string" ||
      !mainWindow ||
      !refreshWindows().some((item) => item.id === id)
    )
      throw new Error("该 VS Code 窗口已关闭");
    const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    if (workArea.width < 1450 || workArea.height < 700)
      throw new Error("当前屏幕太窄，无法同时放下完整 VS Code 和终端");
    mainWindow.maximize();
    mainWindow.focus();
  });
  ipcMain.handle(
    "windows:overlay:position",
    async (event, id: unknown, rect: unknown) => {
      if (
        event.sender !== mainWindow?.webContents ||
        typeof id !== "string" ||
        !mainWindow ||
        !refreshWindows().some((item) => item.id === id) ||
        !rect ||
        typeof rect !== "object"
      )
        throw new Error("无效的 VS Code 内嵌请求");
      const input = rect as Record<string, unknown>;
      const { x, y, width, height } = input;
      const content = mainWindow.getContentBounds();
      if (
        ![x, y, width, height].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) ||
        (x as number) < 0 ||
        (y as number) < 0 ||
        (width as number) < 800 ||
        (height as number) < 450 ||
        (x as number) + (width as number) > content.width + 2 ||
        (y as number) + (height as number) > content.height + 2
      )
        throw new Error("VS Code 面板空间不足，已保留原窗口");
      const physical = screen.dipToScreenRect(mainWindow, {
        x: content.x + (x as number),
        y: content.y + (y as number),
        width: width as number,
        height: height as number,
      });
      await overlayCodeWindow(id, physical);
    },
  );
  ipcMain.handle("windows:overlay:release", async (event, id: unknown) => {
    if (event.sender !== mainWindow?.webContents)
      throw new Error("无效窗口请求");
    if (id !== undefined && typeof id !== "string")
      throw new Error("无效窗口请求");
    await releaseOverlayCodeWindow(id);
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
  const editorRoots = () => [
    ...store.get().projects.map((item) => item.path),
    ...store.get().favorites,
  ];
  ipcMain.handle("editor:read", (event, filename: unknown) => {
    if (event.sender !== mainWindow?.webContents)
      throw new Error("无效文件请求");
    return readEditableFile(filename, editorRoots());
  });
  ipcMain.handle(
    "editor:save",
    (event, filename: unknown, content: unknown, revision: unknown) => {
      if (event.sender !== mainWindow?.webContents)
        throw new Error("无效保存请求");
      return saveEditableFile(filename, content, revision, editorRoots());
    },
  );
  ipcMain.handle(
    "terminal:create",
    (
      _event,
      input: {
        projectId: string | null;
        cwd: string;
        shell: ShellKind;
        title?: string;
      },
    ) => {
      if (!input || !["powershell", "cmd"].includes(input.shell))
        throw new Error("无效终端类型");
      if (input.title !== undefined && typeof input.title !== "string")
        throw new Error("无效终端名称");
      const title = input.title?.trim();
      if (title && title.length > 80) throw new Error("终端名称不能超过 80 字");
      const cwd = requireDirectory(input.cwd || os.homedir());
      const projectId =
        input.projectId &&
        store.get().projects.some((item) => item.id === input.projectId)
          ? input.projectId
          : null;
      const snapshot = terminals.create({
        projectId,
        cwd,
        shell: input.shell,
        title,
      });
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
  ipcMain.handle(
    "terminal:update",
    (
      event,
      id: unknown,
      input: { title?: string; projectId?: string | null },
    ) => {
      if (
        event.sender !== mainWindow?.webContents ||
        typeof id !== "string" ||
        !input ||
        typeof input !== "object"
      )
        throw new Error("无效终端请求");
      const changes: { title?: string; projectId?: string | null } = {};
      if (input.title !== undefined) {
        if (typeof input.title !== "string") throw new Error("无效终端名称");
        const title = input.title.trim();
        if (!title || title.length > 80)
          throw new Error("终端名称需为 1 至 80 字");
        changes.title = title;
      }
      if (input.projectId !== undefined) {
        if (
          input.projectId !== null &&
          (typeof input.projectId !== "string" ||
            !store.get().projects.some((item) => item.id === input.projectId))
        )
          throw new Error("项目不存在");
        changes.projectId = input.projectId;
      }
      const snapshot = terminals.updateMetadata(id, changes);
      send("state:changed", store.updateTerminal(id, changes));
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
    minWidth: 840,
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
  mainWindow.on("focus", raiseOverlayCodeWindow);
  mainWindow.on("minimize", hideOverlayCodeWindow);
  mainWindow.on("restore", raiseOverlayCodeWindow);
  mainWindow.on("move", () => send("windows:overlay:sync", null));
  mainWindow.on("resize", () => send("windows:overlay:sync", null));
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
      ).finally(() => app.quit());
    });
  }
  if (process.env.CODEMESH_OVERLAY_SMOKE_OUT && mainWindow) {
    const output = process.env.CODEMESH_OVERLAY_SMOKE_OUT;
    mainWindow.webContents.once("did-finish-load", () => {
      void runOverlaySmoke(
        mainWindow!,
        output,
        process.env.CODEMESH_OVERLAY_SMOKE_SCREENSHOT,
        process.env.CODEMESH_OVERLAY_SMOKE_WINDOW_ID,
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

let overlayReleasedBeforeQuit = false;
let overlayQuitStarted = false;
app.on("before-quit", (event) => {
  if (!overlayReleasedBeforeQuit) {
    event.preventDefault();
    if (overlayQuitStarted) return;
    overlayQuitStarted = true;
    void releaseOverlayCodeWindow().finally(() => {
      overlayReleasedBeforeQuit = true;
      app.quit();
    });
    return;
  }
  terminals?.closeAll();
});
app.on("window-all-closed", () => app.quit());

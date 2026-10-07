import koffi from "koffi";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { CodeWindow, EmbedBounds, StoredState } from "../shared/types";
import type { WindowRule } from "../shared/types";
import { matchWindow, titleKey } from "../shared/matching";

const HANDLE = koffi.pointer("HANDLE", koffi.opaque());
koffi.alias("HWND", HANDLE);
const enumWindowProc = koffi.proto(
  "bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)",
);
const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const enumWindows = user32.func(
  "bool __stdcall EnumWindows(EnumWindowsProc *callback, intptr_t lParam)",
);
const isWindowVisible = user32.func(
  "bool __stdcall IsWindowVisible(HWND hwnd)",
);
const getWindowTextLength = user32.func(
  "int __stdcall GetWindowTextLengthW(HWND hwnd)",
);
const getWindowText = user32.func(
  "int __stdcall GetWindowTextW(HWND hwnd, void *buffer, int maxCount)",
);
const getWindowPid = user32.func(
  "uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)",
);
const isWindow = user32.func("bool __stdcall IsWindow(HWND hwnd)");
const showWindow = user32.func(
  "bool __stdcall ShowWindow(HWND hwnd, int command)",
);
const setForegroundWindow = user32.func(
  "bool __stdcall SetForegroundWindow(HWND hwnd)",
);
const getForegroundWindow = user32.func("HWND __stdcall GetForegroundWindow()");
const getParent = user32.func("HWND __stdcall GetParent(HWND hwnd)");
const setParent = user32.func(
  "HWND __stdcall SetParent(HWND child, HWND parent)",
);
const getWindowLongPtr = user32.func(
  "intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)",
);
const setWindowLongPtr = user32.func(
  "intptr_t __stdcall SetWindowLongPtrW(HWND hwnd, int index, intptr_t value)",
);
const getWindowRect = user32.func(
  "bool __stdcall GetWindowRect(HWND hwnd, void *rect)",
);
const setWindowPos = user32.func(
  "bool __stdcall SetWindowPos(HWND hwnd, HWND insertAfter, int x, int y, int width, int height, uint32_t flags)",
);
const postMessage = user32.func(
  "bool __stdcall PostMessageW(HWND hwnd, uint32_t message, uintptr_t wParam, intptr_t lParam)",
);
const openProcess = kernel32.func(
  "HANDLE __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)",
);
const queryProcessImage = kernel32.func(
  "bool __stdcall QueryFullProcessImageNameW(HANDLE process, uint32_t flags, void *buffer, _Inout_ uint32_t *size)",
);
const closeHandle = kernel32.func("bool __stdcall CloseHandle(HANDLE handle)");

interface NativeWindow {
  id: string;
  title: string;
  processId: number;
}
const liveHandles = new Map<string, bigint>();
const sessionRules = new Map<string, WindowRule>();
const embedded = new Map<
  string,
  {
    hwnd: bigint;
    parent: bigint | null;
    style: bigint;
    rect: number[];
    bounds: EmbedBounds | null;
  }
>();
const WS_CHILD = 0x40000000n;
const WS_POPUP = 0x80000000n;
const GWL_STYLE = -16;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SWP_HIDEWINDOW = 0x0080;

function processImageName(pid: number): string | null {
  const handle = openProcess(0x1000, false, pid) as bigint | null;
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(32768);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(buffer.length / 2);
    if (!queryProcessImage(handle, 0, buffer, size)) return null;
    return buffer.subarray(0, size.readUInt32LE() * 2).toString("utf16le");
  } finally {
    closeHandle(handle);
  }
}

function enumerate(): NativeWindow[] {
  const result: NativeWindow[] = [];
  const nextHandles = new Map<string, bigint>();
  const imageCache = new Map<number, string | null>();
  enumWindows((hwnd: bigint) => {
    if (!isWindowVisible(hwnd)) return true;
    const length = getWindowTextLength(hwnd) as number;
    if (length < 1) return true;
    const buffer = Buffer.alloc((length + 1) * 2);
    if (!getWindowText(hwnd, buffer, length + 1)) return true;
    const title = buffer.toString("utf16le").replace(/\0.*$/s, "").trim();
    const pidBuffer = Buffer.alloc(4);
    getWindowPid(hwnd, pidBuffer);
    const pid = pidBuffer.readUInt32LE();
    if (!imageCache.has(pid)) imageCache.set(pid, processImageName(pid));
    const exe = imageCache.get(pid);
    if (!exe || path.basename(exe).toLowerCase() !== "code.exe") return true;
    const id = hwnd.toString();
    result.push({ id, title, processId: pid });
    nextHandles.set(id, hwnd);
    return true;
  }, 0);
  // Reparented windows are no longer top-level, so EnumWindows cannot see them.
  for (const [id, record] of embedded) {
    if (!isWindow(record.hwnd)) {
      embedded.delete(id);
      continue;
    }
    const length = getWindowTextLength(record.hwnd) as number;
    const buffer = Buffer.alloc((Math.max(1, length) + 1) * 2);
    getWindowText(record.hwnd, buffer, Math.max(1, length) + 1);
    const pidBuffer = Buffer.alloc(4);
    getWindowPid(record.hwnd, pidBuffer);
    result.push({
      id,
      title:
        buffer.toString("utf16le").replace(/\0.*$/s, "").trim() || "VS Code",
      processId: pidBuffer.readUInt32LE(),
    });
    nextHandles.set(id, record.hwnd);
  }
  liveHandles.clear();
  for (const [id, hwnd] of nextHandles) liveHandles.set(id, hwnd);
  for (const id of sessionRules.keys())
    if (!nextHandles.has(id)) sessionRules.delete(id);
  return result;
}

export function listCodeWindows(state: StoredState): CodeWindow[] {
  const live = enumerate();
  const titleCounts = new Map<string, number>();
  for (const window of live)
    titleCounts.set(
      titleKey(window.title),
      (titleCounts.get(titleKey(window.title)) ?? 0) + 1,
    );
  return live.map((window) => ({
    ...window,
    embedded: embedded.has(window.id),
    ...matchWindow(
      window.title,
      state.projects,
      sessionRules.get(window.id) ??
        (titleCounts.get(titleKey(window.title)) === 1
          ? state.windowRules[titleKey(window.title)]
          : undefined),
    ),
  }));
}

export function setSessionWindowRule(id: string, rule: WindowRule): void {
  if (!liveHandles.has(id)) throw new Error("该 VS Code 窗口已关闭");
  sessionRules.set(id, rule);
}

export function focusCodeWindow(id: string): boolean {
  const hwnd = liveHandles.get(id);
  if (!hwnd || !isWindow(hwnd)) return false;
  if (!embedded.has(id)) showWindow(hwnd, 9); // SW_RESTORE
  setForegroundWindow(hwnd);
  return getForegroundWindow() === hwnd;
}

/** Reparents an existing VS Code window only after the user selects it for a pane. */
export function embedCodeWindow(id: string, host: bigint): void {
  if (embedded.has(id)) return;
  const hwnd = liveHandles.get(id);
  if (!hwnd || !isWindow(hwnd)) throw new Error("该 VS Code 窗口已关闭");
  const rect = Buffer.alloc(16);
  if (!getWindowRect(hwnd, rect)) throw new Error("无法读取窗口位置");
  const style = BigInt(getWindowLongPtr(hwnd, GWL_STYLE) as bigint);
  const parent = getParent(hwnd) as bigint | null;
  const oldRect = [0, 4, 8, 12].map((offset) => rect.readInt32LE(offset));
  // SetParent leaves style unchanged; Win32 requires WS_CHILD for a hosted window.
  setWindowLongPtr(hwnd, GWL_STYLE, (style & ~WS_POPUP) | WS_CHILD);
  const previous = setParent(hwnd, host) as bigint | null;
  if (!previous && parent) {
    setWindowLongPtr(hwnd, GWL_STYLE, style);
    throw new Error("无法嵌入 VS Code 窗口");
  }
  if (getParent(hwnd) !== host) {
    setWindowLongPtr(hwnd, GWL_STYLE, style);
    throw new Error("无法嵌入 VS Code 窗口（可能是 DPI 模式不兼容）");
  }
  embedded.set(id, { hwnd, parent, style, rect: oldRect, bounds: null });
  setWindowPos(
    hwnd,
    null,
    0,
    0,
    1,
    1,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_HIDEWINDOW,
  );
}

export function positionCodeWindow(
  id: string,
  bounds: EmbedBounds | null,
): void {
  const record = embedded.get(id);
  if (!record || !isWindow(record.hwnd)) return;
  if (!bounds) {
    setWindowPos(
      record.hwnd,
      null,
      0,
      0,
      1,
      1,
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_HIDEWINDOW,
    );
    return;
  }
  const { x, y, width, height } = bounds;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width < 1 ||
    height < 1 ||
    width > 10000 ||
    height > 10000
  )
    throw new Error("无效嵌入区域");
  if (
    !setWindowPos(
      record.hwnd,
      null,
      Math.round(x),
      Math.round(y),
      Math.round(width),
      Math.round(height),
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW,
    )
  )
    throw new Error("无法调整 VS Code 窗口位置");
  record.bounds = bounds;
}

export function restoreEmbeddedVisibility(): void {
  for (const [id, record] of embedded)
    if (record.bounds) positionCodeWindow(id, record.bounds);
}

export function releaseCodeWindow(id: string): void {
  const record = embedded.get(id);
  if (!record) return;
  embedded.delete(id);
  if (!isWindow(record.hwnd)) return;
  setParent(record.hwnd, record.parent);
  setWindowLongPtr(record.hwnd, GWL_STYLE, record.style);
  const [left, top, right, bottom] = record.rect;
  setWindowPos(
    record.hwnd,
    null,
    left,
    top,
    right - left,
    bottom - top,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
  );
}

export function releaseAllCodeWindows(): void {
  for (const id of [...embedded.keys()]) releaseCodeWindow(id);
}

/** Only used by the opt-in disposable-window smoke test. */
export function closeSmokeCodeWindow(id: string): void {
  const hwnd = liveHandles.get(id);
  if (hwnd && isWindow(hwnd)) postMessage(hwnd, 0x0010, 0, 0); // WM_CLOSE
}

function findCodeExe(): string | null {
  const roots = [
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Programs",
        "Microsoft VS Code",
        "Code.exe",
      ),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
    process.env["ProgramFiles(x86)"] &&
      path.join(
        process.env["ProgramFiles(x86)"],
        "Microsoft VS Code",
        "Code.exe",
      ),
  ].filter((item): item is string => !!item);
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    roots.push(path.resolve(dir, "..", "Code.exe"));
    roots.push(path.join(dir, "Code.exe"));
  }
  return roots.find(existsSync) ?? null;
}

export async function launchCode(folder: string): Promise<void> {
  const executable = findCodeExe();
  if (!executable)
    throw new Error("未找到 VS Code。请将 VS Code 添加到 PATH 后重试。");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["--new-window", folder], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

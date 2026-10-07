import koffi from "koffi";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { CodeWindow, StoredState } from "../shared/types";
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
  showWindow(hwnd, 9); // SW_RESTORE
  setForegroundWindow(hwnd);
  return getForegroundWindow() === hwnd;
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

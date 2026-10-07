import fs from "node:fs";
import { desktopCapturer, type BrowserWindow } from "electron";
import {
  inspectCodeWindowHandle,
  inspectNativeCodeWindow,
  inspectOverlayCodeWindow,
  maximizeSmokeCodeWindow,
  placeCodeWindow,
  releaseNativeCodeWindow,
  releaseOverlayCodeWindow,
} from "./windows";

/** Exercises an isolated, disposable VS Code window and always restores it. */
export async function runOverlaySmoke(
  window: BrowserWindow,
  output: string,
  screenshot?: string,
  targetId?: string,
  projectPath?: string,
  native = false,
  startBounds?: { x: number; y: number; width: number; height: number },
  quitWhileAttached = false,
  maximizeHost = false,
  maximizeCode = false,
): Promise<void> {
  let embeddedId: string | null = null;
  let original: ReturnType<typeof inspectCodeWindowHandle> | null = null;
  try {
    if (!projectPath)
      throw new Error("Overlay smoke requires an isolated project path");
    const id = await window.webContents.executeJavaScript(`(async () => {
      const bootstrap = await window.codemesh.bootstrap();
      const code = bootstrap.windows.find(item => item.id === ${JSON.stringify(targetId || "")} || item.title.includes(${JSON.stringify(targetId || "__no_test_window__")}));
      if (!code) throw new Error('No VS Code window available for overlay smoke');
      const state = await window.codemesh.addProject(${JSON.stringify(projectPath)});
      const project = state.projects.find(item => item.path.toLowerCase() === ${JSON.stringify(projectPath.toLowerCase())});
      if (!project) throw new Error('Overlay smoke project was not added');
      await window.codemesh.setWindowRule(code.id, { projectId: project.id, role: 'other' });
      for (let attempt = 0; attempt < 40; attempt++) {
        const nav = [...document.querySelectorAll('.project-nav')].find(item => item.title.toLowerCase() === ${JSON.stringify(projectPath.toLowerCase())});
        if (nav) { nav.click(); break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      let row;
      for (let attempt = 0; attempt < 40; attempt++) {
        row = [...document.querySelectorAll('.workspace-window-action')].find(item => item.dataset.windowId === code.id);
        if (row) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const button = row?.querySelector(${JSON.stringify(native ? 'button[title="将 VS Code 作为真正的原生子窗口嵌入工作区"]' : 'button[title="把独立的 VS Code 窗口贴合到面板位置（非真正内嵌）"]')});
      if (!button) throw new Error('Embed button missing');
      return code.id;
    })()`);
    embeddedId = id;
    if (startBounds) {
      placeCodeWindow(id, startBounds);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (maximizeCode) {
      maximizeSmokeCodeWindow(id);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (native) original = inspectCodeWindowHandle(id);
    await window.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('.workspace-window-action')].find(item => item.dataset.windowId === ${JSON.stringify(id)});
      const button = row?.querySelector(${JSON.stringify(native ? 'button[title="将 VS Code 作为真正的原生子窗口嵌入工作区"]' : 'button[title="把独立的 VS Code 窗口贴合到面板位置（非真正内嵌）"]')});
      if (!button) throw new Error('Embed button missing');
      button.click();
    })()`);
    let state = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      state = native ? inspectNativeCodeWindow() : inspectOverlayCodeWindow();
      if (state?.id === id) break;
    }
    if (!state || state.id !== id) {
      const diagnostic = await window.webContents.executeJavaScript(`({
        className: document.querySelector('.app')?.className,
        toast: document.querySelector('.toast')?.textContent,
        codePane: document.querySelector('.workspace-pane-body')?.getBoundingClientRect().toJSON(),
        codeButtons: [...document.querySelectorAll(${JSON.stringify(native ? 'button[title="将 VS Code 作为真正的原生子窗口嵌入工作区"]' : 'button[title="把独立的 VS Code 窗口贴合到面板位置（非真正内嵌）"]')})].length
      })`);
      throw new Error(
        `VS Code was not positioned over its workspace pane: ${JSON.stringify(diagnostic)}`,
      );
    }
    if (native && maximizeHost) {
      window.unmaximize();
      window.setSize(1480, 900);
      await new Promise((resolve) => setTimeout(resolve, 850));
      const smaller = inspectNativeCodeWindow();
      if (!smaller) {
        const diagnostic = await window.webContents.executeJavaScript(
          `({toast: document.querySelector('.toast')?.textContent, app: document.querySelector('.app')?.className, pane: document.querySelector('.workspace-pane-body')?.getBoundingClientRect().toJSON()})`,
        );
        throw new Error(
          `VS Code 子窗口在缩小后丢失：${JSON.stringify(diagnostic)}`,
        );
      }
      const smallerHost = window.getBounds();
      const smallerPane = await window.webContents.executeJavaScript(
        `({hidden: document.hidden, innerWidth, width: document.querySelector('.workspace-pane-body')?.getBoundingClientRect().width, grid: getComputedStyle(document.querySelector('.workspace-panes')).gridTemplateColumns, observer: document.querySelector('.workspace-pane-body')?.dataset})`,
      );
      window.maximize();
      await new Promise((resolve) => setTimeout(resolve, 850));
      state = inspectNativeCodeWindow();
      const largerPane = await window.webContents.executeJavaScript(
        `({hidden: document.hidden, innerWidth, width: document.querySelector('.workspace-pane-body')?.getBoundingClientRect().width, grid: getComputedStyle(document.querySelector('.workspace-panes')).gridTemplateColumns, observer: document.querySelector('.workspace-pane-body')?.dataset})`,
      );
      if (!state || state.expected.width <= smaller.expected.width + 25) {
        await window.webContents.executeJavaScript(
          `window.dispatchEvent(new Event('resize'))`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        const forced = inspectNativeCodeWindow();
        throw new Error(
          `VS Code 子窗口未随 CodeMesh 最大化而扩大：${smaller.expected.width} -> ${state?.expected.width ?? "missing"}; forced=${forced?.expected.width}; host=${JSON.stringify(smallerHost)} -> ${JSON.stringify(window.getBounds())}; pane=${JSON.stringify(smallerPane)} -> ${JSON.stringify(largerPane)}`,
        );
      }
    }
    if (native && !("parented" in state && state.parented))
      throw new Error("VS Code was not a native child of CodeMesh");
    if (
      Math.abs(state.actual.x - state.expected.x) > 24 ||
      Math.abs(state.actual.y - state.expected.y) > 24 ||
      Math.abs(state.actual.width - state.expected.width) > 24 ||
      Math.abs(state.actual.height - state.expected.height) > 24
    )
      throw new Error(`VS Code pane bounds mismatch: ${JSON.stringify(state)}`);
    const result = await window.webContents.executeJavaScript(`({
      embedMode: !!document.querySelector('.app.embed-mode'),
      sidebarToggle: !!document.querySelector('.breadcrumb-workspace'),
      codePane: !!document.querySelector('.workspace-pane-body .workspace-empty'),
      terminalList: !!document.querySelector('.terminal-library')
    })`);
    if (!result.embedMode || !result.codePane || !result.terminalList)
      throw new Error("Embedded workspace layout did not render");
    if (screenshot) {
      window.setAlwaysOnTop(true);
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const displays = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (displays[0]?.thumbnail)
        fs.writeFileSync(screenshot, displays[0].thumbnail.toPNG());
    }
    fs.writeFileSync(
      output,
      JSON.stringify({ ok: true, state, result }, null, 2),
      "utf8",
    );
  } catch (error) {
    fs.writeFileSync(
      output,
      JSON.stringify({ ok: false, error: String(error) }, null, 2),
      "utf8",
    );
  } finally {
    if (native) {
      if (!quitWhileAttached) await releaseNativeCodeWindow();
    } else await releaseOverlayCodeWindow();
    window.setAlwaysOnTop(false);
    if (native && embeddedId && !quitWhileAttached) {
      // Give the foreign Electron window time to process the DPI/parent change
      // before this CodeMesh host exits.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const released = inspectCodeWindowHandle(embeddedId);
      const safe =
        released.exists &&
        !released.parented &&
        !released.childStyle &&
        released.visible &&
        released.maximized === original?.maximized &&
        !!original?.bounds &&
        !!released.bounds &&
        Math.abs(original.bounds.x - released.bounds.x) <= 24 &&
        Math.abs(original.bounds.y - released.bounds.y) <= 24 &&
        Math.abs(original.bounds.width - released.bounds.width) <= 24 &&
        Math.abs(original.bounds.height - released.bounds.height) <= 24;
      const prior = JSON.parse(fs.readFileSync(output, "utf8"));
      fs.writeFileSync(
        output,
        JSON.stringify(
          { ...prior, ok: prior.ok && safe, original, released },
          null,
          2,
        ),
        "utf8",
      );
    }
  }
}

import fs from "node:fs";
import { desktopCapturer, type BrowserWindow } from "electron";
import { inspectOverlayCodeWindow, releaseOverlayCodeWindow } from "./windows";

/** Exercises an isolated, disposable VS Code window and always restores it. */
export async function runOverlaySmoke(
  window: BrowserWindow,
  output: string,
  screenshot?: string,
  targetId?: string,
  projectPath?: string,
): Promise<void> {
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
      const button = row?.querySelector('button[title="把独立的 VS Code 窗口贴合到面板位置（非真正内嵌）"]');
      if (!button) throw new Error('Embed button missing');
      button.click();
      return code.id;
    })()`);
    let state = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      state = inspectOverlayCodeWindow();
      if (state?.id === id) break;
    }
    if (!state || state.id !== id) {
      const diagnostic = await window.webContents.executeJavaScript(`({
        className: document.querySelector('.app')?.className,
        toast: document.querySelector('.toast')?.textContent,
        codePane: document.querySelector('.workspace-pane-body')?.getBoundingClientRect().toJSON(),
        codeButtons: [...document.querySelectorAll('button[title="把独立的 VS Code 窗口贴合到面板位置（非真正内嵌）"]')].length
      })`);
      throw new Error(
        `VS Code was not positioned over its workspace pane: ${JSON.stringify(diagnostic)}`,
      );
    }
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
    await releaseOverlayCodeWindow();
  }
}

import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

/** Runs against the actual packaged renderer and preload bridge. */
export async function runSmoke(
  window: BrowserWindow,
  output: string,
  cwd: string,
): Promise<void> {
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const api = window.codemesh;
      await new Promise(resolve => setTimeout(resolve, 300));
      const heading = document.querySelector('h1')?.textContent || '';
      const bootstrap = await api.bootstrap();
      if (!bootstrap.state.settings.terminalFontFamily.includes('MesloLGM Nerd Font Mono')) throw new Error('Nerd Font default not applied');
      const directory = await api.listDirectory(${JSON.stringify(cwd)});
      const withProject = await api.addProject(${JSON.stringify(cwd)});
      const addedProject = withProject.projects.find(item => item.path.toLowerCase() === ${JSON.stringify(cwd.toLowerCase())});
      if (!addedProject) throw new Error('Project was not saved');
      const editorFile = await api.readEditableFile(${JSON.stringify(path.join(cwd, "package.json"))});
      if (!editorFile.content.includes('codemesh') || !editorFile.revision) throw new Error('Editor could not read a project file');
      let projectNav = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        projectNav = [...document.querySelectorAll('.project-nav')].find(item => item.title.toLowerCase() === ${JSON.stringify(cwd.toLowerCase())});
        if (projectNav) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!projectNav) throw new Error('Project navigation missing');
      projectNav.click();
      let fileButton = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        fileButton = [...document.querySelectorAll('.file-row')].find(item => item.title.includes('package.json'));
        if (fileButton) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!fileButton) throw new Error('File browser did not show package.json');
      fileButton.click();
      let editor = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        editor = document.querySelector('.workspace-pane.selected .editor-host .cm-content');
        if (editor?.textContent?.includes('codemesh')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!editor?.textContent?.includes('codemesh')) throw new Error('Editable file did not appear in workspace');
      const withFavorite = await api.addFavorite(${JSON.stringify(cwd)});
      if (!withFavorite.favorites.some(item => item.toLowerCase() === ${JSON.stringify(cwd.toLowerCase())})) throw new Error('Favorite was not saved');
      let windowRule = null;
      if (bootstrap.windows.length) {
        const tagged = await api.setWindowRule(bootstrap.windows[0].id, { projectId: addedProject.id, role: 'view' });
        windowRule = tagged.find(item => item.id === bootstrap.windows[0].id);
        if (windowRule?.projectId !== addedProject.id || windowRule.role !== 'view') throw new Error('Window rule was not applied');
      }
      await api.removeFavorite(${JSON.stringify(cwd)});
      async function checkShell(shell, command, marker) {
        const session = await api.createTerminal({ projectId: null, cwd: ${JSON.stringify(cwd)}, shell });
        let unsubscribe;
        try {
          const output = new Promise((resolve, reject) => {
            let text = '';
            const timer = setTimeout(() => { unsubscribe?.(); reject(new Error(shell + ' timed out: ' + text.slice(-500))); }, 15000);
            unsubscribe = api.onTerminalData(event => {
              if (event.id !== session.id) return;
              text += event.data;
              if (text.includes(marker)) { clearTimeout(timer); unsubscribe?.(); resolve(text); }
            });
          });
          await api.writeTerminal(session.id, command + '\\r');
          return { alive: session.alive, output: (await output).slice(-500) };
        } finally { unsubscribe?.(); await api.closeTerminal(session.id); }
      }
      const powershell = await checkShell('powershell', "Write-Output ('CM_' + 'POWERSHELL_OK')", 'CM_POWERSHELL_OK');
      const cmd = await checkShell('cmd', 'echo CM_CMD_OK', 'CM_CMD_OK');
      const defaultTerminal = await api.createTerminal({ projectId: null, cwd: '', shell: 'cmd' });
      if (!defaultTerminal.alive || !defaultTerminal.cwd) throw new Error('Default terminal directory unavailable');
      await api.closeTerminal(defaultTerminal.id);
      const layoutButtons = document.querySelectorAll('.workspace-layout button');
      layoutButtons[2]?.click();
      await new Promise(resolve => setTimeout(resolve, 150));
      if (!document.querySelector('.workspace-panes.layout-rows')) throw new Error('Rows layout did not activate');
      const knownTerminals = new Set((await api.bootstrap()).terminals.map(item => item.id));
      const newName = document.querySelector('input[aria-label="新终端名称"]');
      const newProject = document.querySelector('select[aria-label="新终端关联项目"]');
      if (!newName || !newProject) throw new Error('New terminal metadata fields missing');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(newName, 'Initial terminal');
      newName.dispatchEvent(new Event('input', { bubbles: true }));
      newProject.value = addedProject.id;
      newProject.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      const newTerminal = document.querySelector('.workspace-add');
      if (!newTerminal || newTerminal.disabled) throw new Error('New terminal button unavailable without a project');
      newTerminal.click();
      let createdTerminal = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        createdTerminal = (await api.bootstrap()).terminals.find(item => !knownTerminals.has(item.id));
        if (createdTerminal && document.querySelector('.workspace-pane.selected .terminal-host')) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!createdTerminal || !document.querySelector('.workspace-pane.selected .terminal-host')) throw new Error('New terminal did not appear in a pane');
      if (createdTerminal.title !== 'Initial terminal' || createdTerminal.projectId !== addedProject.id) throw new Error('New terminal metadata was not applied');
      if (!document.querySelector('.workspace-pane:first-child .editor-host')) throw new Error('Editor was lost while opening split terminal');
      const renamedTerminal = await api.updateTerminal(createdTerminal.id, { title: 'Smoke terminal', projectId: addedProject.id });
      if (renamedTerminal.title !== 'Smoke terminal' || renamedTerminal.projectId !== addedProject.id) throw new Error('Terminal metadata did not update');
      const savedTerminal = (await api.bootstrap()).state.terminals.find(item => item.id === createdTerminal.id);
      if (savedTerminal?.title !== 'Smoke terminal' || savedTerminal.projectId !== addedProject.id) throw new Error('Terminal metadata was not persisted');
      const hidePaneButton = document.querySelector('.workspace-pane.selected button[title="关闭面板显示（终端继续运行）"]');
      if (!hidePaneButton) throw new Error('Hide pane button missing');
      hidePaneButton.click();
      if (!(await api.bootstrap()).terminals.some(item => item.id === createdTerminal.id)) throw new Error('Hiding a pane deleted its terminal');
      const reopenButton = [...document.querySelectorAll('.terminal-library-open')].find(item => item.title.includes('Smoke terminal'));
      if (!reopenButton) throw new Error('Terminal missing from persistent list');
      reopenButton.click();
      for (let attempt = 0; attempt < 40 && !document.querySelector('.workspace-pane.selected .terminal-host'); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!document.querySelector('.workspace-pane.selected .terminal-host')) throw new Error('Terminal did not reopen from list');
      await api.closeTerminal(createdTerminal.id);
      await api.removeProject(addedProject.id);
      return { heading, fontFamily: bootstrap.state.settings.terminalFontFamily, windows: bootstrap.windows.length, windowRuleApplied: !!windowRule, directoryPath: directory.path, directoryEntries: directory.entries.length, hasPackageJson: directory.entries.some(item => item.name === 'package.json'), editorFile: editorFile.path, powershell, cmd, defaultTerminal: defaultTerminal.cwd, uiTerminal: createdTerminal.cwd, terminalRenamed: renamedTerminal.title };
    })()`);
    fs.writeFileSync(
      output,
      JSON.stringify({ ok: true, result }, null, 2),
      "utf8",
    );
  } catch (error) {
    fs.writeFileSync(
      output,
      JSON.stringify({ ok: false, error: String(error) }, null, 2),
      "utf8",
    );
  }
}

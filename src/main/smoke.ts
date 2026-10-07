import fs from "node:fs";
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
      const directory = await api.listDirectory(${JSON.stringify(cwd)});
      const withProject = await api.addProject(${JSON.stringify(cwd)});
      const addedProject = withProject.projects.find(item => item.path.toLowerCase() === ${JSON.stringify(cwd.toLowerCase())});
      if (!addedProject) throw new Error('Project was not saved');
      const withFavorite = await api.addFavorite(${JSON.stringify(cwd)});
      if (!withFavorite.favorites.some(item => item.toLowerCase() === ${JSON.stringify(cwd.toLowerCase())})) throw new Error('Favorite was not saved');
      let windowRule = null;
      if (bootstrap.windows.length) {
        const tagged = await api.setWindowRule(bootstrap.windows[0].id, { projectId: addedProject.id, role: 'view' });
        windowRule = tagged.find(item => item.id === bootstrap.windows[0].id);
        if (windowRule?.projectId !== addedProject.id || windowRule.role !== 'view') throw new Error('Window rule was not applied');
      }
      await api.removeFavorite(${JSON.stringify(cwd)});
      await api.removeProject(addedProject.id);
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
      return { heading, windows: bootstrap.windows.length, windowRuleApplied: !!windowRule, directoryPath: directory.path, directoryEntries: directory.entries.length, hasPackageJson: directory.entries.some(item => item.name === 'package.json'), powershell, cmd };
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

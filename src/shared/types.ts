export type ShellKind = "powershell" | "cmd";
export type WindowRole = "view" | "claude" | "other";
export type Palette = "midnight" | "graphite" | "aurora";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface WindowRule {
  projectId: string | null;
  role: WindowRole;
}

export interface Settings {
  terminalFontSize: number;
  terminalFontFamily: string;
  palette: Palette;
}

export interface TerminalDefinition {
  id: string;
  projectId: string | null;
  cwd: string;
  shell: ShellKind;
  title: string;
}

export interface StoredState {
  version: 1;
  projects: Project[];
  favorites: string[];
  windowRules: Record<string, WindowRule>;
  terminals: TerminalDefinition[];
  settings: Settings;
}

export interface CodeWindow {
  id: string;
  title: string;
  processId: number;
  projectId: string | null;
  role: WindowRole;
  association: "manual" | "matched" | "none";
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
}

export interface DirectoryResult {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

export interface TerminalSnapshot extends TerminalDefinition {
  buffer: string;
  alive: boolean;
}

export interface Bootstrap {
  state: StoredState;
  windows: CodeWindow[];
  terminals: TerminalSnapshot[];
}

export interface CodeMeshApi {
  bootstrap(): Promise<Bootstrap>;
  chooseDirectory(): Promise<string | null>;
  addProject(path: string): Promise<StoredState>;
  removeProject(id: string): Promise<StoredState>;
  addFavorite(path: string): Promise<StoredState>;
  removeFavorite(path: string): Promise<StoredState>;
  updateSettings(settings: Partial<Settings>): Promise<StoredState>;
  setWindowRule(id: string, rule: WindowRule): Promise<CodeWindow[]>;
  listWindows(): Promise<CodeWindow[]>;
  focusWindow(id: string): Promise<boolean>;
  openCode(path: string): Promise<void>;
  listDirectory(path: string): Promise<DirectoryResult>;
  openFile(path: string): Promise<void>;
  createTerminal(input: {
    projectId: string | null;
    cwd: string;
    shell: ShellKind;
  }): Promise<TerminalSnapshot>;
  closeTerminal(id: string): Promise<void>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  onWindowsChanged(callback: (windows: CodeWindow[]) => void): () => void;
  onTerminalData(
    callback: (event: { id: string; data: string }) => void,
  ): () => void;
  onTerminalExit(callback: (id: string) => void): () => void;
  onStateChanged(callback: (state: StoredState) => void): () => void;
}

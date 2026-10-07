import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Palette,
  Project,
  Settings,
  StoredState,
  TerminalDefinition,
  WindowRule,
} from "../shared/types";
import { normalizePath, titleKey } from "../shared/matching";
import {
  DEFAULT_TERMINAL_FONT,
  migrateTerminalFont,
} from "../shared/terminal-font";

const defaults: StoredState = {
  version: 1,
  projects: [],
  favorites: [],
  windowRules: {},
  terminals: [],
  settings: {
    terminalFontSize: 14,
    terminalFontFamily: DEFAULT_TERMINAL_FONT,
    palette: "midnight",
  },
};

function isDirectory(value: string): boolean {
  try {
    return path.isAbsolute(value) && fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

export class Store {
  private file: string;
  private data: StoredState;

  constructor() {
    const directory = app.getPath("userData");
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "state.json");
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.file, "utf8"),
      ) as Partial<StoredState>;
      if (parsed.version !== 1) throw new Error("Unsupported state version");
      this.data = {
        ...defaults,
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        windowRules:
          parsed.windowRules && typeof parsed.windowRules === "object"
            ? parsed.windowRules
            : {},
        terminals: Array.isArray(parsed.terminals) ? parsed.terminals : [],
        settings: {
          ...defaults.settings,
          ...parsed.settings,
          terminalFontFamily: migrateTerminalFont(
            parsed.settings?.terminalFontFamily,
          ),
        },
      };
    } catch {
      this.data = structuredClone(defaults);
    }
  }

  get(): StoredState {
    return structuredClone(this.data);
  }

  private save(): StoredState {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(temporary, this.file);
    return this.get();
  }

  addProject(folder: string): StoredState {
    if (!isDirectory(folder)) throw new Error("请选择存在的文件夹");
    const canonical = fs.realpathSync.native(folder);
    if (
      !this.data.projects.some(
        (item) => normalizePath(item.path) === normalizePath(canonical),
      )
    ) {
      const project: Project = {
        id: randomUUID(),
        name: path.basename(canonical),
        path: canonical,
        createdAt: Date.now(),
      };
      this.data.projects.push(project);
    }
    return this.save();
  }

  removeProject(id: string): StoredState {
    this.data.projects = this.data.projects.filter((item) => item.id !== id);
    this.data.terminals = this.data.terminals.map((item) =>
      item.projectId === id ? { ...item, projectId: null } : item,
    );
    for (const rule of Object.values(this.data.windowRules))
      if (rule.projectId === id) rule.projectId = null;
    return this.save();
  }

  addFavorite(folder: string): StoredState {
    if (!isDirectory(folder)) throw new Error("请选择存在的文件夹");
    const canonical = fs.realpathSync.native(folder);
    if (
      !this.data.favorites.some(
        (item) => normalizePath(item) === normalizePath(canonical),
      )
    ) {
      this.data.favorites.push(canonical);
    }
    return this.save();
  }

  removeFavorite(folder: string): StoredState {
    this.data.favorites = this.data.favorites.filter(
      (item) => normalizePath(item) !== normalizePath(folder),
    );
    return this.save();
  }

  updateSettings(input: Partial<Settings>): StoredState {
    const next = { ...this.data.settings };
    if (
      typeof input.terminalFontSize === "number" &&
      Number.isFinite(input.terminalFontSize)
    ) {
      next.terminalFontSize = Math.max(
        10,
        Math.min(24, Math.round(input.terminalFontSize)),
      );
    }
    if (
      typeof input.terminalFontFamily === "string" &&
      input.terminalFontFamily.length <= 120
    ) {
      next.terminalFontFamily =
        input.terminalFontFamily.trim() || defaults.settings.terminalFontFamily;
    }
    if (["midnight", "graphite", "aurora"].includes(input.palette as Palette))
      next.palette = input.palette as Palette;
    this.data.settings = next;
    return this.save();
  }

  setWindowRule(title: string, input: WindowRule): StoredState {
    const projectId =
      input.projectId &&
      this.data.projects.some((item) => item.id === input.projectId)
        ? input.projectId
        : null;
    const role = ["view", "claude", "other"].includes(input.role)
      ? input.role
      : "other";
    this.data.windowRules[titleKey(title)] = { projectId, role };
    return this.save();
  }

  addTerminal(definition: TerminalDefinition): StoredState {
    this.data.terminals.push(definition);
    return this.save();
  }

  removeTerminal(id: string): StoredState {
    this.data.terminals = this.data.terminals.filter((item) => item.id !== id);
    return this.save();
  }
}

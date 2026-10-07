import type { CodeWindow, Project, WindowRule, WindowRole } from "./types";

export function windowsForProject(
  windows: CodeWindow[],
  projectId: string | null,
): CodeWindow[] {
  return projectId
    ? windows.filter((window) => window.projectId === projectId)
    : [];
}

export function normalizePath(path: string): string {
  return path
    .replace(/[\\/]+$/, "")
    .replace(/\//g, "\\")
    .toLocaleLowerCase();
}

export function titleKey(title: string): string {
  return title.trim().toLocaleLowerCase();
}

export function matchWindow(
  title: string,
  projects: Project[],
  rule?: WindowRule,
): {
  projectId: string | null;
  role: WindowRole;
  association: "manual" | "matched" | "none";
} {
  if (rule) {
    return {
      projectId: rule.projectId,
      role: rule.role,
      association: "manual",
    };
  }

  const lower = title.toLocaleLowerCase();
  const candidates = projects.filter((project) => {
    const name = project.name.toLocaleLowerCase();
    const folder = project.path
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1)
      ?.toLocaleLowerCase();
    return [name, folder].some(
      (value) =>
        value &&
        new RegExp(`(^|[\\s—–-])${escapeRegex(value)}($|[\\s—–-])`, "i").test(
          lower,
        ),
    );
  });
  return {
    projectId: candidates.length === 1 ? candidates[0].id : null,
    role: "other",
    association: candidates.length === 1 ? "matched" : "none",
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

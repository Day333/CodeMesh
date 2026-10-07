import { describe, expect, it } from "vitest";
import {
  matchWindow,
  normalizePath,
  titleKey,
  windowsForProject,
} from "./matching";
import type { CodeWindow, Project } from "./types";

const projects: Project[] = [
  { id: "one", name: "Alpha", path: "C:\\Projects\\Alpha", createdAt: 0 },
  { id: "two", name: "Beta", path: "C:\\Projects\\Beta", createdAt: 0 },
];

describe("window association", () => {
  it("only offers the selected project's VS Code windows", () => {
    const windows: CodeWindow[] = [
      {
        id: "a",
        title: "Alpha",
        processId: 1,
        projectId: "one",
        role: "other",
        association: "manual",
      },
      {
        id: "b",
        title: "Beta",
        processId: 2,
        projectId: "two",
        role: "other",
        association: "manual",
      },
      {
        id: "c",
        title: "Unknown",
        processId: 3,
        projectId: null,
        role: "other",
        association: "none",
      },
    ];
    expect(windowsForProject(windows, "one").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(windowsForProject(windows, "two").map((item) => item.id)).toEqual([
      "b",
    ]);
    expect(windowsForProject(windows, null)).toEqual([]);
  });

  it("matches an unambiguous project name from a VS Code title", () => {
    expect(matchWindow("Alpha - Visual Studio Code", projects).projectId).toBe(
      "one",
    );
  });

  it("does not guess when a title could refer to two projects", () => {
    const duplicate = {
      ...projects[1],
      id: "three",
      name: "Alpha",
      path: "E:\\Alpha",
    };
    expect(
      matchWindow("Alpha - Visual Studio Code", [...projects, duplicate])
        .projectId,
    ).toBeNull();
  });

  it("respects a manual association and role", () => {
    expect(
      matchWindow("Alpha - Visual Studio Code", projects, {
        projectId: "two",
        role: "claude",
      }),
    ).toEqual({ projectId: "two", role: "claude", association: "manual" });
  });

  it("normalizes paths and title keys for persisted rules", () => {
    expect(normalizePath("C:/Projects/Alpha/")).toBe(
      normalizePath("c:\\projects\\alpha"),
    );
    expect(titleKey("  Alpha - Visual Studio Code  ")).toBe(
      "alpha - visual studio code",
    );
  });
});

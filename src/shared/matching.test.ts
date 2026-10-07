import { describe, expect, it } from "vitest";
import { matchWindow, normalizePath, titleKey } from "./matching";
import type { Project } from "./types";

const projects: Project[] = [
  { id: "one", name: "Alpha", path: "C:\\Projects\\Alpha", createdAt: 0 },
  { id: "two", name: "Beta", path: "C:\\Projects\\Beta", createdAt: 0 },
];

describe("window association", () => {
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

import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_FONT, migrateTerminalFont } from "./terminal-font";

describe("terminal font migration", () => {
  it("defaults new and legacy profiles to Nerd Font", () => {
    expect(migrateTerminalFont(undefined)).toBe(DEFAULT_TERMINAL_FONT);
    expect(migrateTerminalFont("Cascadia Code, Consolas, monospace")).toBe(
      DEFAULT_TERMINAL_FONT,
    );
  });

  it("preserves a custom font", () => {
    expect(migrateTerminalFont("My Custom Font")).toBe("My Custom Font");
  });
});

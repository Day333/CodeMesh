export const DEFAULT_TERMINAL_FONT =
  '"MesloLGM Nerd Font Mono", "Microsoft YaHei UI", monospace';

const LEGACY_TERMINAL_FONT = "Cascadia Code, Consolas, monospace";

export function migrateTerminalFont(value: string | undefined): string {
  return value && value !== LEGACY_TERMINAL_FONT
    ? value
    : DEFAULT_TERMINAL_FONT;
}

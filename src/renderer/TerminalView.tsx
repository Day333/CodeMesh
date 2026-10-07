import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Palette, TerminalSnapshot } from "../shared/types";

const themes: Record<Palette, Record<string, string>> = {
  midnight: {
    background: "#0a1324",
    foreground: "#dce8f8",
    cursor: "#6de4c6",
    selectionBackground: "#5b8cff50",
    black: "#19283f",
    red: "#ff6b82",
    green: "#6de4c6",
    yellow: "#f9cc77",
    blue: "#73a7ff",
    magenta: "#ca9bff",
    cyan: "#70d6e6",
    white: "#dce8f8",
  },
  graphite: {
    background: "#17191e",
    foreground: "#e1e1e8",
    cursor: "#f5a66c",
    selectionBackground: "#a6a6b050",
    black: "#282b34",
    red: "#ff7c84",
    green: "#b4df8c",
    yellow: "#f2ce83",
    blue: "#92b2ef",
    magenta: "#cca9e9",
    cyan: "#94d8d4",
    white: "#e1e1e8",
  },
  aurora: {
    background: "#101b20",
    foreground: "#e0f1ec",
    cursor: "#b5f399",
    selectionBackground: "#62caba50",
    black: "#183137",
    red: "#ff8c9b",
    green: "#b5f399",
    yellow: "#e8d796",
    blue: "#8bc9f4",
    magenta: "#c7aff4",
    cyan: "#75dfcd",
    white: "#e0f1ec",
  },
};

export function TerminalView({
  snapshot,
  active,
  fontSize,
  fontFamily,
  palette,
}: {
  snapshot: TerminalSnapshot;
  active: boolean;
  fontSize: number;
  fontFamily: string;
  palette: Palette;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      allowTransparency: false,
      fontFamily,
      fontSize,
      lineHeight: 1.18,
      theme: themes[palette],
    });
    const fitter = new FitAddon();
    instance.loadAddon(fitter);
    instance.open(host.current);
    if (snapshot.buffer) instance.write(snapshot.buffer);
    terminal.current = instance;
    fit.current = fitter;
    const input = instance.onData((data) => {
      void window.codemesh
        .writeTerminal(snapshot.id, data)
        .catch(() => undefined);
    });
    const unsubscribeData = window.codemesh.onTerminalData((event) => {
      if (event.id === snapshot.id) instance.write(event.data);
    });
    const unsubscribeExit = window.codemesh.onTerminalExit((id) => {
      if (id === snapshot.id)
        instance.write("\r\n\x1b[38;5;244m[会话已结束]\x1b[0m\r\n");
    });
    const observer = new ResizeObserver(() => {
      if (host.current?.clientWidth && host.current?.clientHeight) {
        try {
          fitter.fit();
          void window.codemesh.resizeTerminal(
            snapshot.id,
            instance.cols,
            instance.rows,
          );
        } catch {
          /* Resize during teardown. */
        }
      }
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      unsubscribeData();
      unsubscribeExit();
      input.dispose();
      instance.dispose();
      host.current?.replaceChildren();
      terminal.current = null;
      fit.current = null;
    };
    // The terminal instance belongs to its session ID; changing appearance is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.id]);

  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      terminal.current.options.fontFamily = fontFamily;
      terminal.current.options.theme = themes[palette];
      if (active) requestAnimationFrame(() => fit.current?.fit());
    }
  }, [fontSize, fontFamily, palette, active]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fit.current?.fit();
        terminal.current?.focus();
      });
    }
  }, [active]);

  return (
    <div
      className="terminal-host"
      ref={host}
      style={{ display: active ? "block" : "none" }}
    />
  );
}

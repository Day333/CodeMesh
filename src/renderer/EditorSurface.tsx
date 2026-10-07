import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";

function languageFor(filename: string) {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(extension || ""))
    return javascript({
      typescript: extension === "ts" || extension === "tsx",
      jsx: extension === "jsx" || extension === "tsx",
    });
  if (extension === "py") return python();
  if (extension === "json" || extension === "jsonc") return json();
  if (extension === "md" || extension === "markdown") return markdown();
  if (extension === "html" || extension === "htm") return html();
  if (extension === "css" || extension === "scss") return css();
  return [];
}

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#0a1324",
      color: "#d9e7fa",
      fontSize: "13px",
    },
    ".cm-content": {
      fontFamily: "Cascadia Code, Consolas, monospace",
      padding: "12px 0",
    },
    ".cm-gutters": {
      backgroundColor: "#101d30",
      color: "#6f86a5",
      borderRight: "1px solid #253850",
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#20314988" },
    ".cm-cursor": { borderLeftColor: "#9cc5ff" },
    ".cm-selectionBackground": { backgroundColor: "#355781 !important" },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "#355781 !important",
    },
  },
  { dark: true },
);

export function EditorSurface({
  filename,
  initialContent,
  onChange,
  onSave,
}: {
  filename: string;
  initialContent: string;
  onChange: (content: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      doc: initialContent,
      parent: host.current,
      extensions: [
        basicSetup,
        editorTheme,
        languageFor(filename),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              handlers.current.onSave();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            handlers.current.onChange(update.state.doc.toString());
        }),
      ],
    });
    return () => view.destroy();
    // The editor is recreated only when a different document is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  return (
    <div className="editor-host" ref={host} aria-label={`编辑 ${filename}`} />
  );
}

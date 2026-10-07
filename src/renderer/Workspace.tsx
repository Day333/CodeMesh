import { useCallback, useEffect, useRef, useState } from "react";
import {
  Code2,
  Command,
  ExternalLink,
  FileText,
  Plus,
  Save,
  SquareTerminal,
  X,
} from "lucide-react";
import type {
  CodeWindow,
  EditableFile,
  Project,
  Settings,
  ShellKind,
  TerminalSnapshot,
} from "../shared/types";
import { TerminalView } from "./TerminalView";
import { EditorSurface } from "./EditorSurface";

type Target = { kind: "file" | "terminal"; id: string } | null;
type Layout = "single" | "columns" | "rows";

type OpenDocument = EditableFile & { savedContent: string };

export function Workspace({
  windows,
  terminals,
  projects,
  selectedProjectId,
  requestedTerminalId,
  requestedFile,
  settings,
  onCreateTerminal,
  onDeleteTerminal,
  onUpdateTerminal,
  onTileWindow,
  onError,
}: {
  windows: CodeWindow[];
  terminals: TerminalSnapshot[];
  projects: Project[];
  selectedProjectId: string | null;
  requestedTerminalId: string | null;
  requestedFile: { path: string; token: number } | null;
  settings: Settings;
  onCreateTerminal: (
    shell: ShellKind,
    projectId: string | null,
    title?: string,
  ) => void;
  onDeleteTerminal: (id: string) => void;
  onUpdateTerminal: (
    id: string,
    input: { title?: string; projectId?: string | null },
  ) => void;
  onTileWindow: (id: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [layout, setLayout] = useState<Layout>("columns");
  const [panes, setPanes] = useState<[Target, Target]>([null, null]);
  const [activePane, setActivePane] = useState<0 | 1>(0);
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [newTerminalProjectId, setNewTerminalProjectId] = useState<
    string | null
  >(selectedProjectId);
  const [newTerminalTitle, setNewTerminalTitle] = useState("");
  const savingPaths = useRef(new Set<string>());
  const wasNarrow = useRef(false);

  useEffect(
    () => setNewTerminalProjectId(selectedProjectId),
    [selectedProjectId],
  );

  useEffect(() => {
    const adjust = () => {
      const narrow = window.innerWidth <= 950;
      if (narrow && !wasNarrow.current)
        setLayout((current) => (current === "columns" ? "rows" : current));
      wasNarrow.current = narrow;
    };
    adjust();
    window.addEventListener("resize", adjust);
    return () => window.removeEventListener("resize", adjust);
  }, []);

  const saveDocument = useCallback(
    async (filename: string) => {
      const document = documents.find((item) => item.path === filename);
      if (
        !document ||
        document.content === document.savedContent ||
        savingPaths.current.has(filename)
      )
        return;
      savingPaths.current.add(filename);
      try {
        const saved = await window.codemesh.saveEditableFile(
          document.path,
          document.content,
          document.revision,
        );
        setDocuments((items) =>
          items.map((item) =>
            item.path === filename
              ? {
                  ...item,
                  revision: saved.revision,
                  savedContent: saved.content,
                }
              : item,
          ),
        );
      } catch (error) {
        onError(error);
      } finally {
        savingPaths.current.delete(filename);
      }
    },
    [documents, onError],
  );

  useEffect(() => {
    if (!documents.some((item) => item.content !== item.savedContent)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [documents]);

  useEffect(() => {
    if (!requestedFile) return;
    let cancelled = false;
    const existing = documents.find(
      (item) => item.path.toLowerCase() === requestedFile.path.toLowerCase(),
    );
    if (existing) {
      select({ kind: "file", id: existing.path });
      return;
    }
    void window.codemesh
      .readEditableFile(requestedFile.path)
      .then((opened) => {
        if (cancelled) return;
        setDocuments((items) => [
          ...items,
          { ...opened, savedContent: opened.content },
        ]);
        select({ kind: "file", id: opened.path });
      })
      .catch((error) => {
        if (!cancelled) onError(error);
      });
    return () => {
      cancelled = true;
    };
    // File requests are one-shot actions. Selecting a tab does not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFile]);

  useEffect(() => {
    if (!requestedTerminalId) return;
    const destination: 0 | 1 =
      layout !== "single" &&
      panes[activePane] &&
      !panes[activePane === 0 ? 1 : 0]
        ? activePane === 0
          ? 1
          : 0
        : activePane;
    setPanes((items) => {
      const next: [Target, Target] = [...items];
      next[destination] = { kind: "terminal", id: requestedTerminalId };
      return next;
    });
    setActivePane(destination);
    // A new requested ID is a one-shot navigation action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTerminalId]);

  useEffect(() => {
    setPanes(([left, right]) => [
      left?.kind === "terminal" &&
      !terminals.some((item) => item.id === left.id)
        ? null
        : left,
      right?.kind === "terminal" &&
      !terminals.some((item) => item.id === right.id)
        ? null
        : right,
    ]);
  }, [terminals]);

  function select(target: Target) {
    const other = activePane === 0 ? 1 : 0;
    if (
      target &&
      panes[other]?.kind === target.kind &&
      panes[other]?.id === target.id
    ) {
      setActivePane(other);
      return;
    }
    setPanes(([left, right]) => {
      const next: [Target, Target] = [left, right];
      next[activePane] = target;
      return next;
    });
  }

  function closeDocument(filename: string) {
    const document = documents.find((item) => item.path === filename);
    if (
      document?.content !== document?.savedContent &&
      !window.confirm(`“${filename}”有未保存的修改，确定关闭吗？`)
    )
      return;
    setDocuments((items) => items.filter((item) => item.path !== filename));
    setPanes(([left, right]) => [
      left?.kind === "file" && left.id === filename ? null : left,
      right?.kind === "file" && right.id === filename ? null : right,
    ]);
  }

  return (
    <section className="workspace panel">
      <div className="workspace-heading">
        <div className="workspace-heading-title">
          <Code2 size={18} />
          <h2>工作区</h2>
          <span>在这里编辑文件，并与终端分屏</span>
        </div>
        <div className="workspace-layout" aria-label="分屏布局">
          <button
            className={layout === "single" ? "active" : ""}
            onClick={() => {
              setLayout("single");
              setActivePane(0);
            }}
          >
            单屏
          </button>
          <button
            className={layout === "columns" ? "active" : ""}
            onClick={() => setLayout("columns")}
          >
            左右分屏
          </button>
          <button
            className={layout === "rows" ? "active" : ""}
            onClick={() => setLayout("rows")}
          >
            上下分屏
          </button>
        </div>
      </div>
      <div className="workspace-switcher">
        <div className="workspace-switcher-row">
          <span>VS Code</span>
          {windows.map((item) => (
            <div className="workspace-window-action" key={item.id}>
              <button
                title={`切换到 ${item.title}`}
                onClick={() =>
                  void window.codemesh.focusWindow(item.id).catch(onError)
                }
              >
                <ExternalLink size={14} /> {item.title}
              </button>
              <button
                title="原生 VS Code 在右侧、CodeMesh 工作区在左侧"
                onClick={() => {
                  void onTileWindow(item.id)
                    .then(() => {
                      const visibleTerminal = panes.find(
                        (target) => target?.kind === "terminal",
                      );
                      if (visibleTerminal)
                        setPanes(([left, right]) => [visibleTerminal, right]);
                      setActivePane(0);
                      setLayout("single");
                    })
                    .catch(onError);
                }}
              >
                同屏
              </button>
            </div>
          ))}
          {!windows.length && <small>暂无窗口；从项目可新建 VS Code</small>}
        </div>
        <div className="workspace-switcher-row">
          <span>编辑文件</span>
          {documents.map((item) => (
            <div className="workspace-file-tab" key={item.path}>
              <button
                title={item.path}
                className={
                  panes[activePane]?.kind === "file" &&
                  panes[activePane]?.id === item.path
                    ? "active"
                    : ""
                }
                onClick={() => select({ kind: "file", id: item.path })}
              >
                <FileText size={14} /> {item.path.split(/[\\/]/).at(-1)}
                {item.content !== item.savedContent ? " ●" : ""}
              </button>
              <button
                title="关闭文件"
                className="workspace-tab-close"
                onClick={() => closeDocument(item.path)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {!documents.length && <small>从下方文件浏览区点击文件即可编辑</small>}
        </div>
      </div>
      <div className="workspace-body">
        <aside className="terminal-library" aria-label="终端列表">
          <div className="terminal-library-heading">
            <SquareTerminal size={15} />
            <strong>终端列表</strong>
            <span>{terminals.length}</span>
          </div>
          <div className="terminal-library-create">
            <input
              aria-label="新终端名称"
              placeholder="名称（可选）"
              maxLength={80}
              value={newTerminalTitle}
              onChange={(event) => setNewTerminalTitle(event.target.value)}
            />
            <select
              aria-label="新终端关联项目"
              value={newTerminalProjectId ?? ""}
              onChange={(event) =>
                setNewTerminalProjectId(event.target.value || null)
              }
            >
              <option value="">不关联项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="terminal-library-create-actions">
              {(["powershell", "cmd"] as const).map((shell) => (
                <button
                  key={shell}
                  className="workspace-add"
                  onClick={() => {
                    onCreateTerminal(
                      shell,
                      newTerminalProjectId,
                      newTerminalTitle.trim() || undefined,
                    );
                    setNewTerminalTitle("");
                  }}
                >
                  {shell === "cmd" ? <Command size={14} /> : <Plus size={14} />}
                  {shell === "cmd" ? "cmd" : "PowerShell"}
                </button>
              ))}
            </div>
          </div>
          <div className="terminal-library-list">
            {terminals.map((item) => (
              <div className="terminal-library-item" key={item.id}>
                <button
                  className={`terminal-library-open ${panes[activePane]?.kind === "terminal" && panes[activePane]?.id === item.id ? "active" : ""}`}
                  title={`在选中面板打开 ${item.title}`}
                  onClick={() => select({ kind: "terminal", id: item.id })}
                >
                  <span
                    className={item.alive ? "live-dot" : "terminal-dead-dot"}
                  />
                  <strong>{item.title}</strong>
                </button>
                <input
                  key={`${item.id}:${item.title}`}
                  aria-label={`重命名 ${item.title}`}
                  title="修改终端名称，按 Enter 保存"
                  maxLength={80}
                  defaultValue={item.title}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (title && title !== item.title)
                      onUpdateTerminal(item.id, { title });
                    else event.currentTarget.value = item.title;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = item.title;
                      event.currentTarget.blur();
                    }
                  }}
                />
                <select
                  aria-label={`${item.title} 关联项目`}
                  title="只修改项目归类，不改变当前 shell 目录"
                  value={item.projectId ?? ""}
                  onChange={(event) =>
                    onUpdateTerminal(item.id, {
                      projectId: event.target.value || null,
                    })
                  }
                >
                  <option value="">未关联项目</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <div className="terminal-library-bottom">
                  <small title={item.cwd}>
                    {item.cwd.split(/[\\/]/).filter(Boolean).at(-1) || item.cwd}
                  </small>
                  <button
                    title="删除并关闭终端"
                    aria-label={`删除 ${item.title}`}
                    onClick={() => onDeleteTerminal(item.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            {!terminals.length && (
              <p className="terminal-library-empty">
                新建终端后会一直列在这里。
              </p>
            )}
          </div>
        </aside>
        <div className={`workspace-panes layout-${layout}`}>
          {([0, 1] as const).map((index) => {
            const target = panes[index];
            const document =
              target?.kind === "file"
                ? documents.find((item) => item.path === target.id)
                : null;
            const terminal =
              target?.kind === "terminal"
                ? terminals.find((item) => item.id === target.id)
                : null;
            return (
              <div
                key={index}
                className={`workspace-pane ${activePane === index ? "selected" : ""}`}
                onMouseDown={() => setActivePane(index)}
              >
                <div className="workspace-pane-head">
                  <button onClick={() => setActivePane(index)}>
                    面板 {index + 1}
                  </button>
                  <strong title={document?.path || terminal?.cwd}>
                    {document?.path || terminal?.title || "选择文件或终端"}
                  </strong>
                  {document && (
                    <button
                      title="保存文件 (Ctrl+S)"
                      disabled={document.content === document.savedContent}
                      onClick={() => void saveDocument(document.path)}
                    >
                      <Save size={14} />
                    </button>
                  )}
                  {target && (
                    <button
                      title="关闭面板显示（终端继续运行）"
                      onClick={() => {
                        setActivePane(index);
                        setPanes((items) =>
                          index === 0 ? [null, items[1]] : [items[0], null],
                        );
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="workspace-pane-body">
                  {document && (
                    <EditorSurface
                      key={document.path}
                      filename={document.path}
                      initialContent={document.content}
                      onChange={(content) =>
                        setDocuments((items) =>
                          items.map((item) =>
                            item.path === document.path
                              ? { ...item, content }
                              : item,
                          ),
                        )
                      }
                      onSave={() => void saveDocument(document.path)}
                    />
                  )}
                  {terminal && (
                    <TerminalView
                      snapshot={terminal}
                      active={true}
                      fontSize={settings.terminalFontSize}
                      fontFamily={settings.terminalFontFamily}
                      palette={settings.palette}
                    />
                  )}
                  {!document && !terminal && (
                    <div className="workspace-empty">
                      <FileText size={26} />
                      <span>从文件浏览区打开文件，或从上方选择终端</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="workspace-hint">
        CodeMesh 内可直接编辑并保存本地文本文件；VS Code 和 Claude Code
        插件仍在原生窗口中运行，点击上方窗口标签切换。
      </p>
    </section>
  );
}

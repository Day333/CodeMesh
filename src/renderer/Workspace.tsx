import { useEffect, useRef, useState } from "react";
import {
  Code2,
  Command,
  ExternalLink,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import type {
  CodeWindow,
  Settings,
  ShellKind,
  TerminalSnapshot,
} from "../shared/types";
import { TerminalView } from "./TerminalView";

type Target = { kind: "code" | "terminal"; id: string } | null;
type Layout = "single" | "columns" | "rows";

function CodeSurface({
  id,
  onError,
}: {
  id: string;
  onError: (error: unknown) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | null = null;
    setFailed(false);
    void window.codemesh
      .captureWindow(id)
      .then((sourceId) =>
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
            },
          } as unknown as MediaTrackConstraints,
        }),
      )
      .then((captured) => {
        if (disposed) {
          captured.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = captured;
        if (video.current) {
          video.current.srcObject = captured;
          void video.current.play().catch(onError);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setFailed(true);
          onError(error);
        }
      });
    return () => {
      disposed = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [id, onError]);
  return (
    <div className="code-surface" aria-label="VS Code 实时预览">
      {failed ? (
        <div className="workspace-empty">预览暂不可用，请在 VS Code 中打开</div>
      ) : (
        <video ref={video} autoPlay muted playsInline />
      )}
      <span className="code-preview-label">
        实时预览 · 编辑请用面板右上角按钮
      </span>
    </div>
  );
}

export function Workspace({
  windows,
  terminals,
  requestedTerminalId,
  settings,
  onCreateTerminal,
  onCloseTerminal,
  onError,
}: {
  windows: CodeWindow[];
  terminals: TerminalSnapshot[];
  requestedTerminalId: string | null;
  settings: Settings;
  onCreateTerminal: (shell: ShellKind) => void;
  onCloseTerminal: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [layout, setLayout] = useState<Layout>("columns");
  const [panes, setPanes] = useState<[Target, Target]>([null, null]);
  const [activePane, setActivePane] = useState<0 | 1>(0);

  useEffect(() => {
    if (!requestedTerminalId) return;
    const destination: 0 | 1 =
      panes[activePane] && !panes[activePane === 0 ? 1 : 0]
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
      left?.kind === "code" && !windows.some((item) => item.id === left.id)
        ? null
        : left,
      right?.kind === "code" && !windows.some((item) => item.id === right.id)
        ? null
        : right,
    ]);
  }, [windows]);
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

  return (
    <section className="workspace panel">
      <div className="workspace-heading">
        <div className="workspace-heading-title">
          <Code2 size={18} />
          <h2>工作区</h2>
          <span>点击资源放入选中面板</span>
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
            <button
              key={item.id}
              data-window-id={item.id}
              title={item.title}
              className={
                panes[activePane]?.kind === "code" &&
                panes[activePane]?.id === item.id
                  ? "active"
                  : ""
              }
              onClick={() => select({ kind: "code", id: item.id })}
            >
              <Code2 size={14} />
              {item.title}
            </button>
          ))}
          {!windows.length && <small>暂无窗口；从项目新建后可预览</small>}
        </div>
        <div className="workspace-switcher-row">
          <span>终端</span>
          {terminals.map((item) => (
            <button
              key={item.id}
              className={
                panes[activePane]?.kind === "terminal" &&
                panes[activePane]?.id === item.id
                  ? "active"
                  : ""
              }
              onClick={() => select({ kind: "terminal", id: item.id })}
            >
              <SquareTerminal size={14} />
              {item.title} · {item.cwd.split(/[\\/]/).filter(Boolean).at(-1)}
            </button>
          ))}
          <button
            className="workspace-add"
            onClick={() => onCreateTerminal("powershell")}
          >
            <Plus size={14} /> PowerShell
          </button>
          <button
            className="workspace-add"
            onClick={() => onCreateTerminal("cmd")}
          >
            <Command size={14} /> cmd
          </button>
        </div>
      </div>
      <div className={`workspace-panes layout-${layout}`}>
        {([0, 1] as const).map((index) => {
          const target = panes[index];
          const code =
            target?.kind === "code"
              ? windows.find((item) => item.id === target.id)
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
                <strong title={code?.title || terminal?.cwd}>
                  {code?.title || terminal?.title || "选择 VS Code 或终端"}
                </strong>
                {code && (
                  <button
                    title="在 VS Code 中编辑"
                    onClick={() =>
                      void window.codemesh.focusWindow(code.id).catch(onError)
                    }
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                {terminal && (
                  <button
                    title="关闭终端"
                    onClick={() => onCloseTerminal(terminal.id)}
                  >
                    <X size={14} />
                  </button>
                )}
                {target && (
                  <button
                    title="清空面板"
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
                {code && <CodeSurface id={code.id} onError={onError} />}
                {terminal && (
                  <TerminalView
                    snapshot={terminal}
                    active={true}
                    fontSize={settings.terminalFontSize}
                    fontFamily={settings.terminalFontFamily}
                    palette={settings.palette}
                  />
                )}
                {!code && !terminal && (
                  <div className="workspace-empty">
                    <Code2 size={26} />
                    <span>从上方选择窗口或终端</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="workspace-hint">
        VS Code
        在面板中显示实时预览；点击面板右上角按钮可切换到原窗口编辑。终端可直接输入。
      </p>
    </section>
  );
}

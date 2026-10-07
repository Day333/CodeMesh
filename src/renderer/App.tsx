import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  CircleHelp,
  Code2,
  ExternalLink,
  File,
  FileCode2,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SquareTerminal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type {
  CodeWindow,
  DirectoryEntry,
  DirectoryResult,
  Project,
  Settings,
  ShellKind,
  StoredState,
  TerminalSnapshot,
  WindowRole,
} from "../shared/types";
import { windowsForProject } from "../shared/matching";
import { Workspace } from "./Workspace";

const roleLabels: Record<WindowRole, string> = {
  view: "查看",
  claude: "Claude Code",
  other: "其他",
};
const shellLabels: Record<ShellKind, string> = {
  powershell: "PowerShell",
  cmd: "命令提示符",
};
const palettes = {
  midnight: "深空蓝",
  graphite: "石墨灰",
  aurora: "极光绿",
} as const;

function filename(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) || folder;
}
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : String(error);
}

export function App() {
  const [state, setState] = useState<StoredState | null>(null);
  const [windows, setWindows] = useState<CodeWindow[]>([]);
  const [terminals, setTerminals] = useState<TerminalSnapshot[]>([]);
  const [requestedTerminalId, setRequestedTerminalId] = useState<string | null>(
    null,
  );
  const [requestedFile, setRequestedFile] = useState<{
    path: string;
    token: number;
  } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [browserPath, setBrowserPath] = useState<string | null>(null);
  const [directory, setDirectory] = useState<DirectoryResult | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [embedMode, setEmbedMode] = useState(false);
  const [embeddedWindowId, setEmbeddedWindowId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedProject =
    state?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedPath = browserPath ?? selectedProject?.path ?? null;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(
      () => setToast((current) => (current === message ? null : current)),
      4500,
    );
  }, []);
  const reportError = useCallback(
    (error: unknown) => notify(errorMessage(error)),
    [notify],
  );
  const leaveEmbed = useCallback(() => {
    void window.codemesh.releaseOverlayWindow().catch(reportError);
    setEmbedMode(false);
    setEmbeddedWindowId(null);
    setFocusMode(false);
  }, [reportError]);

  useEffect(() => {
    if (
      embedMode &&
      !windowsForProject(windows, selectedProjectId).some(
        (item) => item.id === embeddedWindowId,
      )
    )
      leaveEmbed();
  }, [embedMode, embeddedWindowId, selectedProjectId, windows, leaveEmbed]);

  const run = useCallback(
    async <T,>(
      task: () => Promise<T>,
      success?: string,
    ): Promise<T | undefined> => {
      try {
        const result = await task();
        if (success) notify(success);
        return result;
      } catch (error) {
        notify(errorMessage(error));
        return undefined;
      }
    },
    [notify],
  );

  useEffect(() => {
    let mounted = true;
    const unsubWindows = window.codemesh.onWindowsChanged(setWindows);
    const unsubState = window.codemesh.onStateChanged((next) => {
      setState(next);
      setTerminals((items) =>
        items.flatMap((item) => {
          const definition = next.terminals.find(
            (terminal) => terminal.id === item.id,
          );
          return definition ? [{ ...item, ...definition }] : [];
        }),
      );
    });
    const unsubExit = window.codemesh.onTerminalExit((id) =>
      setTerminals((items) =>
        items.map((item) =>
          item.id === id ? { ...item, alive: false } : item,
        ),
      ),
    );
    const unsubData = window.codemesh.onTerminalData(({ id, data }) =>
      setTerminals((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, buffer: (item.buffer + data).slice(-120000) }
            : item,
        ),
      ),
    );
    void window.codemesh
      .bootstrap()
      .then((data) => {
        if (!mounted) return;
        setState(data.state);
        setWindows(data.windows);
        setTerminals(data.terminals);
        setSelectedProjectId(data.state.projects[0]?.id ?? null);
        setBrowserPath(
          data.state.projects[0]?.path ?? data.state.favorites[0] ?? null,
        );
        setLoading(false);
      })
      .catch((error) => {
        if (mounted) {
          setLoading(false);
          notify(errorMessage(error));
        }
      });
    return () => {
      mounted = false;
      unsubWindows();
      unsubState();
      unsubExit();
      unsubData();
    };
  }, [notify]);

  useEffect(() => {
    if (!selectedPath) {
      setDirectory(null);
      setDirectoryError(null);
      return;
    }
    let current = true;
    void window.codemesh
      .listDirectory(selectedPath)
      .then((result) => {
        if (current) {
          setDirectory(result);
          setDirectoryError(null);
        }
      })
      .catch((error) => {
        if (current) {
          setDirectory(null);
          setDirectoryError(errorMessage(error));
        }
      });
    return () => {
      current = false;
    };
  }, [selectedPath]);

  const filteredProjects = useMemo(
    () =>
      state?.projects.filter((project) =>
        `${project.name} ${project.path}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ) ?? [],
    [state, query],
  );
  const filteredFavorites = useMemo(
    () =>
      state?.favorites.filter((folder) =>
        folder.toLowerCase().includes(query.toLowerCase()),
      ) ?? [],
    [state, query],
  );
  const filteredWindows = useMemo(
    () =>
      windows.filter((item) =>
        `${item.title} ${roleLabels[item.role]}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [windows, query],
  );
  const currentWindows = filteredWindows.filter(
    (item) =>
      item.projectId === selectedProjectId && selectedProjectId !== null,
  );
  const unassignedWindows = filteredWindows.filter((item) => !item.projectId);
  const currentFiles =
    directory?.entries.filter((entry) =>
      entry.name.toLowerCase().includes(fileQuery.toLowerCase()),
    ) ?? [];

  async function addProject() {
    const folder = await run(() => window.codemesh.chooseDirectory());
    if (!folder) return;
    const next = await run(
      () => window.codemesh.addProject(folder),
      "项目已添加",
    );
    if (next) {
      setState(next);
      setSelectedProjectId(
        next.projects.find(
          (project) => project.path.toLowerCase() === folder.toLowerCase(),
        )?.id ??
          next.projects.at(-1)?.id ??
          null,
      );
      setBrowserPath(folder);
    }
  }

  async function addFavorite() {
    const folder = await run(() => window.codemesh.chooseDirectory());
    if (!folder) return;
    const next = await run(
      () => window.codemesh.addFavorite(folder),
      "文件夹已收藏",
    );
    if (next) {
      setState(next);
      setBrowserPath(folder);
    }
  }

  async function removeProject(project: Project) {
    const next = await run(
      () => window.codemesh.removeProject(project.id),
      "已从工作台移除项目",
    );
    if (!next) return;
    setState(next);
    setTerminals((items) =>
      items.map((item) =>
        item.projectId === project.id ? { ...item, projectId: null } : item,
      ),
    );
    if (selectedProjectId === project.id) {
      setSelectedProjectId(null);
      setBrowserPath(next.projects[0]?.path ?? next.favorites[0] ?? null);
    }
  }

  async function removeFavorite(folder: string) {
    const next = await run(
      () => window.codemesh.removeFavorite(folder),
      "已移除收藏",
    );
    if (!next) return;
    setState(next);
    if (browserPath?.toLowerCase() === folder.toLowerCase())
      setBrowserPath(selectedProject?.path ?? next.favorites[0] ?? null);
  }

  async function addTerminal(
    shell: ShellKind,
    cwd = selectedPath,
    projectId = selectedProjectId,
    title?: string,
  ) {
    const result = await run(() =>
      window.codemesh.createTerminal({
        projectId,
        cwd: cwd ?? "",
        shell,
        title,
      }),
    );
    if (result) {
      setTerminals((items) => [...items, result]);
      setRequestedTerminalId(result.id);
    }
  }

  async function deleteTerminal(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    if (
      !window.confirm(
        `删除终端“${terminal?.title ?? "终端"}”？这会结束当前 shell；项目关联和名称也会移除。`,
      )
    )
      return;
    try {
      await window.codemesh.closeTerminal(id);
      setTerminals((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      reportError(error);
    }
  }

  async function updateTerminal(
    id: string,
    input: { title?: string; projectId?: string | null },
  ) {
    const updated = await run(() => window.codemesh.updateTerminal(id, input));
    if (updated)
      setTerminals((items) =>
        items.map((item) => (item.id === id ? updated : item)),
      );
  }

  function selectProject(project: Project) {
    setSelectedProjectId(project.id);
    setBrowserPath(project.path);
    setFileQuery("");
  }
  function openFolder(folder: string) {
    setBrowserPath(folder);
    setFileQuery("");
  }

  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <LayoutGrid size={25} />
        </div>
        <p>正在打开 CodeMesh…</p>
      </div>
    );
  if (!state)
    return (
      <div className="loading-screen">无法读取本地数据。请重启 CodeMesh。</div>
    );

  return (
    <div
      className={`app theme-${state.settings.palette}${focusMode ? " focus-mode" : ""}${embedMode ? " embed-mode" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <LayoutGrid size={22} strokeWidth={2.5} />
          </div>
          <div>
            <strong>CodeMesh</strong>
            <span>你的工作空间</span>
          </div>
        </div>
        <button
          className="sidebar-label top-label sidebar-collapse-button"
          title="收起左侧列表"
          onClick={() => setSidebarCollapsed(true)}
        >
          工作台 <ChevronRight size={13} />
        </button>
        <button
          className={`nav-item ${selectedProjectId === null ? "selected" : ""}`}
          onClick={() => {
            setSelectedProjectId(null);
            setBrowserPath(
              state.projects[0]?.path ?? state.favorites[0] ?? null,
            );
          }}
        >
          <LayoutGrid size={18} /> 总览{" "}
          <span className="nav-count">{windows.length}</span>
        </button>
        <div className="sidebar-heading">
          <span>项目</span>
          <button
            className="icon-button quiet"
            title="添加项目"
            onClick={() => void addProject()}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-scroll">
          {filteredProjects.map((project) => (
            <div className="nav-entry" key={project.id}>
              <button
                className={`project-nav ${selectedProjectId === project.id ? "active" : ""}`}
                onClick={() => selectProject(project)}
                title={project.path}
              >
                <span className="project-glyph">
                  <FolderClosed size={17} />
                </span>
                <span className="nav-project-text">
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
                <span className="project-window-count">
                  {
                    windows.filter((item) => item.projectId === project.id)
                      .length
                  }
                </span>
              </button>
              <button
                className="nav-remove"
                title="从工作台移除项目"
                onClick={() => void removeProject(project)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {!state.projects.length && (
            <div className="sidebar-empty">还没有项目</div>
          )}
        </div>
        <div className="sidebar-heading">
          <span>常用文件夹</span>
          <button
            className="icon-button quiet"
            title="收藏文件夹"
            onClick={() => void addFavorite()}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="favorite-list">
          {filteredFavorites.map((folder) => (
            <div key={folder} className="nav-entry">
              <button
                className={`favorite-nav ${browserPath === folder ? "active" : ""}`}
                onClick={() => openFolder(folder)}
                title={folder}
              >
                <Star size={15} />
                <span>{filename(folder)}</span>
              </button>
              <button
                className="nav-remove"
                title="移除收藏"
                onClick={() => void removeFavorite(folder)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {!state.favorites.length && (
            <div className="sidebar-empty">收藏后可快速浏览</div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="status-dot" /> 本地工作台 · Windows
          </div>
          <button
            className="icon-button"
            title="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="breadcrumb-workspace"
              title={sidebarCollapsed ? "展开左侧列表" : "收起左侧列表"}
              aria-label={sidebarCollapsed ? "展开左侧列表" : "收起左侧列表"}
              aria-expanded={!sidebarCollapsed && !focusMode}
              onClick={() => {
                if (focusMode) {
                  if (embedMode) leaveEmbed();
                  else setFocusMode(false);
                  setSidebarCollapsed(false);
                } else setSidebarCollapsed((current) => !current);
              }}
            >
              工作台
            </button>
            <ChevronRight size={14} />
            <strong>{selectedProject?.name ?? "总览"}</strong>
          </div>
          <div className="topbar-actions">
            {focusMode && (
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  if (embedMode) leaveEmbed();
                  else setFocusMode(false);
                }}
              >
                显示概览
              </button>
            )}
            <div className="global-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目、窗口、文件夹"
                aria-label="全局搜索"
              />
              <kbd>⌕</kbd>
            </div>
            <button
              className="icon-button refresh"
              title="刷新 VS Code 窗口"
              onClick={() =>
                void run(async () =>
                  setWindows(await window.codemesh.listWindows()),
                )
              }
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>

        <div className="content-scroll">
          <div className="content-wrap">
            <section className="welcome">
              <div>
                <h1>{selectedProject ? selectedProject.name : "工作台"}</h1>
                {selectedProject && <p>{selectedProject.path}</p>}
              </div>
              <div className="welcome-actions">
                {selectedProject && (
                  <button
                    className="button button-secondary"
                    onClick={() =>
                      void run(
                        () => window.codemesh.openCode(selectedProject.path),
                        "正在打开 VS Code",
                      )
                    }
                  >
                    <Code2 size={16} /> 新窗口打开
                  </button>
                )}
                <button
                  className="button button-primary"
                  onClick={() => void addProject()}
                >
                  <FolderPlus size={17} /> 添加项目
                </button>
              </div>
            </section>

            <div className="stats">
              <div className="stat">
                <span className="stat-icon blue">
                  <Folder size={18} />
                </span>
                <div>
                  <strong>{state.projects.length}</strong>
                  <small>收藏项目</small>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon teal">
                  <Code2 size={18} />
                </span>
                <div>
                  <strong>{windows.length}</strong>
                  <small>VS Code 窗口</small>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon amber">
                  <SquareTerminal size={18} />
                </span>
                <div>
                  <strong>
                    {terminals.filter((item) => item.alive).length}
                  </strong>
                  <small>运行中终端</small>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon purple">
                  <Star size={18} />
                </span>
                <div>
                  <strong>{state.favorites.length}</strong>
                  <small>常用文件夹</small>
                </div>
              </div>
            </div>

            <Workspace
              windows={windows}
              terminals={terminals}
              projects={state.projects}
              selectedProjectId={selectedProjectId}
              requestedTerminalId={requestedTerminalId}
              requestedFile={requestedFile}
              settings={state.settings}
              onCreateTerminal={(shell, projectId, title) => {
                const project = state.projects.find(
                  (item) => item.id === projectId,
                );
                void addTerminal(
                  shell,
                  project?.path ?? selectedPath,
                  projectId,
                  title,
                );
              }}
              onDeleteTerminal={(id) => void deleteTerminal(id)}
              onUpdateTerminal={(id, input) => void updateTerminal(id, input)}
              onTileWindow={async (id) => {
                if (embedMode) await window.codemesh.releaseOverlayWindow();
                setEmbedMode(false);
                setEmbeddedWindowId(null);
                await window.codemesh.tileWindow(id);
                setFocusMode(true);
              }}
              embedMode={embedMode}
              onEmbedCode={async (id) => {
                if (
                  !selectedProjectId ||
                  !windowsForProject(windows, selectedProjectId).some(
                    (item) => item.id === id,
                  )
                )
                  throw new Error("先将此 VS Code 窗口关联到当前项目");
                await window.codemesh.prepareOverlayWindow(
                  id,
                  selectedProjectId,
                );
                setFocusMode(true);
                setEmbedMode(true);
                setEmbeddedWindowId(id);
              }}
              onLeaveEmbed={leaveEmbed}
              onError={reportError}
            />

            <div className="panels">
              <section className="panel windows-panel">
                <div className="panel-heading">
                  <div>
                    <span className="heading-icon">
                      <Code2 size={17} />
                    </span>
                    <h2>VS Code 窗口</h2>
                    <span className="pill">
                      {selectedProjectId
                        ? currentWindows.length
                        : filteredWindows.length}
                    </span>
                  </div>
                  <button
                    className="subtle-link"
                    onClick={() =>
                      void run(async () =>
                        setWindows(await window.codemesh.listWindows()),
                      )
                    }
                  >
                    刷新 <RefreshCw size={14} />
                  </button>
                </div>
                <div className="window-list">
                  {(selectedProjectId
                    ? currentWindows
                    : filteredWindows.filter((item) => item.projectId)
                  ).map((item) => (
                    <WindowCard
                      key={item.id}
                      item={item}
                      projects={state.projects}
                      onFocus={() =>
                        void run(async () => {
                          if (!(await window.codemesh.focusWindow(item.id)))
                            throw new Error(
                              "Windows 未允许切换到该窗口，请从任务栏选择。",
                            );
                        })
                      }
                      onRule={(rule) =>
                        void run(async () =>
                          setWindows(
                            await window.codemesh.setWindowRule(item.id, rule),
                          ),
                        )
                      }
                    />
                  ))}
                  {selectedProjectId && !currentWindows.length && (
                    <div className="empty-small">
                      <Code2 size={22} />
                      <strong>这个项目还没有关联的窗口</strong>
                      <span>打开新窗口，或在下方关联已有窗口</span>
                    </div>
                  )}
                  {!!unassignedWindows.length && (
                    <div className="unassigned">
                      <div className="list-divider">
                        <span>未关联窗口</span>
                        <span>{unassignedWindows.length}</span>
                      </div>
                      {unassignedWindows.map((item) => (
                        <WindowCard
                          key={item.id}
                          item={item}
                          projects={state.projects}
                          onFocus={() =>
                            void run(async () => {
                              if (!(await window.codemesh.focusWindow(item.id)))
                                throw new Error(
                                  "Windows 未允许切换到该窗口，请从任务栏选择。",
                                );
                            })
                          }
                          onRule={(rule) =>
                            void run(async () =>
                              setWindows(
                                await window.codemesh.setWindowRule(
                                  item.id,
                                  rule,
                                ),
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                  {!windows.length && (
                    <div className="empty-small">
                      <Code2 size={22} />
                      <strong>暂无打开的 VS Code 窗口</strong>
                      <span>从项目中打开，窗口会自动出现在这里</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="panel files-panel">
                <div className="panel-heading">
                  <div>
                    <span className="heading-icon">
                      <FolderOpen size={17} />
                    </span>
                    <h2>文件浏览</h2>
                  </div>
                  <div className="file-heading-actions">
                    <button
                      className="icon-button quiet"
                      title="收藏当前文件夹"
                      disabled={!selectedPath}
                      onClick={() =>
                        selectedPath &&
                        void run(
                          async () =>
                            setState(
                              await window.codemesh.addFavorite(selectedPath),
                            ),
                          "已加入常用文件夹",
                        )
                      }
                    >
                      <Star size={16} />
                    </button>
                    <button
                      className="icon-button quiet"
                      title="刷新文件夹"
                      disabled={!selectedPath}
                      onClick={() =>
                        selectedPath &&
                        void run(async () =>
                          setDirectory(
                            await window.codemesh.listDirectory(selectedPath),
                          ),
                        )
                      }
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                </div>
                {selectedPath ? (
                  <>
                    <div className="pathbar">
                      <button
                        className="icon-button quiet"
                        title="上一级"
                        disabled={!directory?.parent}
                        onClick={() =>
                          directory?.parent && openFolder(directory.parent)
                        }
                      >
                        <ArrowUp size={16} />
                      </button>
                      <span title={selectedPath}>{selectedPath}</span>
                    </div>
                    <div className="file-toolbar">
                      <div className="file-search">
                        <Search size={15} />
                        <input
                          value={fileQuery}
                          onChange={(event) => setFileQuery(event.target.value)}
                          placeholder="筛选当前文件夹"
                          aria-label="筛选文件"
                        />
                      </div>
                      <button
                        title="在 VS Code 打开此文件夹"
                        onClick={() =>
                          void run(
                            () => window.codemesh.openCode(selectedPath),
                            "正在打开 VS Code",
                          )
                        }
                      >
                        <Code2 size={16} />
                      </button>
                      <button
                        title="在终端打开此文件夹"
                        onClick={() =>
                          void addTerminal(
                            "powershell",
                            selectedPath,
                            selectedProjectId,
                          )
                        }
                      >
                        <SquareTerminal size={16} />
                      </button>
                    </div>
                    {directoryError ? (
                      <div className="empty-small error-text">
                        <CircleHelp size={22} />
                        <span>{directoryError}</span>
                      </div>
                    ) : (
                      <div className="file-list">
                        {currentFiles.map((entry) => (
                          <FileRow
                            key={entry.path}
                            entry={entry}
                            onOpen={() => {
                              if (entry.isDirectory) {
                                openFolder(entry.path);
                              } else {
                                setRequestedFile((previous) => ({
                                  path: entry.path,
                                  token: (previous?.token ?? 0) + 1,
                                }));
                                document
                                  .querySelector(".workspace")
                                  ?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start",
                                  });
                              }
                            }}
                            onExternalOpen={() =>
                              void run(() =>
                                window.codemesh.openFile(entry.path),
                              )
                            }
                          />
                        ))}
                        {directory && !currentFiles.length && (
                          <div className="empty-small">
                            <Folder size={22} />
                            <span>
                              {fileQuery ? "没有匹配的文件" : "此文件夹为空"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-small file-empty">
                    <FolderOpen size={28} />
                    <strong>选择一个项目或文件夹</strong>
                    <span>就可以从这里直接浏览内容</span>
                    <button
                      className="button button-secondary"
                      onClick={() => void addFavorite()}
                    >
                      <FolderPlus size={16} /> 收藏文件夹
                    </button>
                  </div>
                )}
              </section>
            </div>

            <footer className="footer">
              <span>CodeMesh · 专注本地工作流</span>
              <span>项目配置仅保存在这台电脑</span>
            </footer>
          </div>
        </div>
      </main>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="settings-modal">
            <div className="modal-header">
              <div>
                <Settings2 size={19} />
                <h2>工作台设置</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="settings-body">
              <label>
                终端配色
                <select
                  value={state.settings.palette}
                  onChange={(event) =>
                    void run(async () =>
                      setState(
                        await window.codemesh.updateSettings({
                          palette: event.target.value as Settings["palette"],
                        }),
                      ),
                    )
                  }
                >
                  {Object.entries(palettes).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                终端字号 <span>{state.settings.terminalFontSize}px</span>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={state.settings.terminalFontSize}
                  onChange={(event) =>
                    void run(async () =>
                      setState(
                        await window.codemesh.updateSettings({
                          terminalFontSize: Number(event.target.value),
                        }),
                      ),
                    )
                  }
                />
              </label>
              <label>
                终端字体
                <input
                  type="text"
                  value={state.settings.terminalFontFamily}
                  onChange={(event) =>
                    setState({
                      ...state,
                      settings: {
                        ...state.settings,
                        terminalFontFamily: event.target.value,
                      },
                    })
                  }
                  onBlur={(event) =>
                    void run(async () =>
                      setState(
                        await window.codemesh.updateSettings({
                          terminalFontFamily: event.target.value,
                        }),
                      ),
                    )
                  }
                />
                <span>
                  含图标的 PowerShell 提示符推荐使用 MesloLGM Nerd Font Mono。
                </span>
              </label>
              <p className="settings-note">
                项目、收藏夹和窗口标签保存在本机应用数据目录，不会上传到
                GitHub。
              </p>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast">
          <span>{toast}</span>
          <button onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function WindowCard({
  item,
  projects,
  onFocus,
  onRule,
}: {
  item: CodeWindow;
  projects: Project[];
  onFocus: () => void;
  onRule: (rule: { projectId: string | null; role: WindowRole }) => void;
}) {
  return (
    <div className="window-card">
      <div className="window-symbol">
        <Code2 size={20} />
      </div>
      <div className="window-details">
        <button className="window-name" onClick={onFocus} title={item.title}>
          {item.title}
        </button>
        <div className="window-meta">
          <span className="live-dot" /> 运行中{" "}
          <span className="meta-separator">·</span>{" "}
          {item.association === "none"
            ? "未关联"
            : item.association === "manual"
              ? "手动关联"
              : "自动匹配"}
        </div>
        <div className="window-controls">
          <select
            aria-label="关联项目"
            value={item.projectId ?? ""}
            onChange={(event) =>
              onRule({ projectId: event.target.value || null, role: item.role })
            }
          >
            <option value="">未关联项目</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            aria-label="窗口用途"
            value={item.role}
            onChange={(event) =>
              onRule({
                projectId: item.projectId,
                role: event.target.value as WindowRole,
              })
            }
          >
            {Object.entries(roleLabels).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button className="open-window" title="切换到窗口" onClick={onFocus}>
        <ArrowRight size={17} />
      </button>
    </div>
  );
}

function FileRow({
  entry,
  onOpen,
  onExternalOpen,
}: {
  entry: DirectoryEntry;
  onOpen: () => void;
  onExternalOpen: () => void;
}) {
  const isCode = /\.(ts|tsx|js|jsx|py|json|md|html|css|rs|go|java|cs)$/i.test(
    entry.name,
  );
  return (
    <div className="file-row-wrap">
      <button
        className="file-row"
        onClick={onOpen}
        title={
          entry.isDirectory ? entry.path : `在 CodeMesh 编辑：${entry.path}`
        }
      >
        <span className={`file-icon ${entry.isDirectory ? "folder" : ""}`}>
          {entry.isDirectory ? (
            <Folder size={17} />
          ) : isCode ? (
            <FileCode2 size={17} />
          ) : (
            <File size={17} />
          )}
        </span>
        <span className="file-name">{entry.name}</span>
        <span className="file-size">
          {entry.isDirectory ? (
            <ChevronRight size={15} />
          ) : (
            formatSize(entry.size)
          )}
        </span>
      </button>
      {!entry.isDirectory && (
        <button
          className="file-external"
          title="用系统默认程序打开"
          onClick={onExternalOpen}
        >
          <ExternalLink size={14} />
        </button>
      )}
    </div>
  );
}

function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

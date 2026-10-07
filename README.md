# CodeMesh

CodeMesh 是一个仅面向 Windows 的本地工作台，用来组织项目文件夹、多个 VS Code 窗口、终端和常用目录。

## 功能

- 按项目显示已打开的 VS Code 窗口，可将窗口手动关联项目并标记为“查看”“Claude Code”或“其他”。点击工作区的窗口标签，可把该桌面窗口嵌入 CodeMesh。
- 工作区支持单屏、左右分屏和上下分屏；两个面板可分别显示 VS Code 或 PowerShell/cmd 终端，也可同时显示两个 VS Code 窗口或两个终端。
- 一键为项目或当前目录打开新的 VS Code 窗口。
- 内置 PowerShell 和 cmd 终端标签，支持配色、字体和字号；下次启动恢复标签及目录，但启动新的 shell。
- 收藏常用文件夹，在应用内浏览、筛选并用系统默认程序打开文件。
- 项目、收藏、标签和外观设置仅保存在本机，不同步到公开仓库。

## 使用

从 Windows 开始菜单打开 CodeMesh，点击“添加项目”选择常用项目目录。项目卡片可启动 VS Code 新窗口。在工作区先点击要使用的面板，再点击上方的 VS Code 或终端标签；右侧可选择单屏、左右或上下分屏。点击面板的“还原为独立窗口”或“清空面板”可取消嵌入。左侧“常用文件夹”的加号可收藏目录，点选后在文件浏览区查看。工作区的“+ PowerShell”和“+ cmd”会在当前项目或文件夹目录新建终端。

## 开发

要求：Windows 10 1809 或更新版本、Node.js 22 以上、npm、VS Code。`node-pty` 使用随包提供的 Windows x64 预编译模块，通常不需要额外安装 C++ 构建工具。

```powershell
npm ci
npm run dev
```

检查与打包：

```powershell
npm test
npm run build
npm run dist
```

安装包生成在 `release/`。VS Code 会从常见安装目录或 `PATH` 中自动查找；如果使用自定义安装位置，请将其 `bin` 目录加入 `PATH`。

## 本地数据与限制

设置写在 Electron 的 `app.getPath('userData')/state.json`。终端输出与命令历史不会保存到该文件；终端 shell 退出后不会保留运行中的进程。现有 VS Code 窗口通过 Windows 窗口信息识别，标题无法唯一对应文件夹时会显示“未关联”，可手动选择项目。窗口标题发生变化后，之前针对该标题的标签可能需要重新设置；同名窗口可分别关联，但这些临时关联不会跨应用重启恢复。

CodeMesh 通过 Windows 原生窗口 API 暂时嵌入 VS Code 桌面窗口，不读取 Claude Code 插件内容。正常清空面板或退出应用时会还原原窗口；Windows 的跨进程嵌入受 VS Code 版本、DPI 模式及窗口生命周期影响，若嵌入失败会显示错误，仍可通过窗口列表切换。应用意外崩溃时，已嵌入的窗口可能需要重新打开。第一版不提供文件复制、移动或删除。尚未配置代码签名，因此本地安装包可能显示 Windows 发布者提示。

## 技术结构

Electron 主进程负责 Windows 窗口 API、文件系统和 `node-pty` 会话；React 界面只通过受限的 preload API 调用这些功能。终端使用 xterm.js 显示。`node_modules/`、构建产物、本机数据和 `.env` 文件不纳入 Git。

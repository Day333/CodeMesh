# CodeMesh

CodeMesh 是一个仅面向 Windows 的本地工作台，用来组织项目文件夹、多个 VS Code 窗口、终端和常用目录。

## 功能

- 按项目显示已打开的 VS Code 窗口，可将窗口手动关联项目并标记为“查看”“Claude Code”或“其他”。点击工作区的窗口标签，可在面板内查看可缩放的实时画面。
- 工作区支持单屏、左右分屏和上下分屏；两个面板可分别显示 VS Code 预览或 PowerShell/cmd 终端，也可同时查看两个 VS Code 窗口或操作两个终端。
- 一键为项目或当前目录打开新的 VS Code 窗口。
- 内置 PowerShell 和 cmd 终端标签，支持配色、字体和字号；下次启动恢复标签及目录，但启动新的 shell。
- 收藏常用文件夹，在应用内浏览、筛选并用系统默认程序打开文件。
- 项目、收藏、标签和外观设置仅保存在本机，不同步到公开仓库。

## 使用

从 Windows 开始菜单打开 CodeMesh，点击“添加项目”选择常用项目目录。项目卡片可启动 VS Code 新窗口。在工作区先点击要使用的面板，再点击上方的 VS Code 或终端标签；右侧可选择单屏、左右或上下分屏。VS Code 在面板内只提供实时查看，点击面板右上角按钮切回原窗口编辑。左侧“常用文件夹”的加号可收藏目录，点选后在文件浏览区查看。工作区的“+ PowerShell”和“+ cmd”可直接新建终端；未选择项目或文件夹时使用用户目录。

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

CodeMesh 不改动 VS Code 窗口本身，也不读取 Claude Code 插件内容。VS Code 预览不能在面板中直接输入或点击编辑；请切换到原窗口操作。若窗口处于最小化状态而预览不可用，先还原 VS Code，再点击“重试预览”。预览只在本机显示，不录制或上传；关闭面板会停止画面捕获。第一版不提供文件复制、移动或删除。尚未配置代码签名，因此本地安装包可能显示 Windows 发布者提示。

## 技术结构

Electron 主进程负责 Windows 窗口 API、文件系统和 `node-pty` 会话；React 界面只通过受限的 preload API 调用这些功能。终端使用 xterm.js 显示。`node_modules/`、构建产物、本机数据和 `.env` 文件不纳入 Git。

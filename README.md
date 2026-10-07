# CodeMesh

CodeMesh 是一个仅面向 Windows 的本地工作台，用来组织项目文件夹、多个 VS Code 窗口、终端和常用目录。

## 功能

- 按项目显示已打开的 VS Code 窗口，可将窗口手动关联项目并标记为“查看”“Claude Code”或“其他”。点击窗口标签可切换到真实 VS Code；宽屏下可点“并排”，同时操作 VS Code 与 CodeMesh。
- CodeMesh 内置真正可输入和保存的本地文本编辑器，可同时打开多个文件；工作区支持单屏、左右和上下分屏，编辑器与终端可任意组合。
- 一键为项目或当前目录打开新的 VS Code 窗口。
- 内置 PowerShell 和 cmd 终端标签，支持配色、字体和字号；下次启动恢复标签及目录，但启动新的 shell。
- 收藏常用文件夹，在应用内浏览、筛选、编辑 UTF-8 文本文件；旁边的外链按钮仍可用系统默认程序打开文件。
- 项目、收藏、标签和外观设置仅保存在本机，不同步到公开仓库。

## 使用

从 Windows 开始菜单打开 CodeMesh，点击“添加项目”选择常用项目目录。点击文件浏览区中的文本文件，就能在上方工作区直接编辑；`Ctrl+S` 保存，未保存时标签显示圆点。先点目标面板，再点文件或终端标签，可将不同文件、终端左右或上下分屏。项目卡片可启动 VS Code 新窗口。需要 Claude Code 插件时，在工作区点击 VS Code 窗口标签进入原生窗口；如果屏幕工作区至少有 1680×700，点其“并排”按钮可将真实 VS Code 与 CodeMesh 放在屏幕两侧，两边都能正常输入。工作区的“+ PowerShell”和“+ cmd”可直接新建终端；未选择项目或文件夹时使用用户目录。

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

CodeMesh 不读取 Claude Code 插件内容，也不会把原生 VS Code 窗口伪装成内嵌窗口。CodeMesh 内的编辑器不是完整 VS Code：VS Code 扩展、远程 SSH 工作区和调试器仍在原生 VS Code 窗口中运行。内置编辑器仅支持已添加项目或收藏目录下不超过 2 MB 的 UTF-8 文本文件；二进制、大文件、其他编码请用 VS Code。保存前检查磁盘文件是否已被其他程序修改，若发生冲突会拒绝覆盖。未保存修改关闭标签时会提示。第一版不提供文件复制、移动或删除。尚未配置代码签名，因此本地安装包可能显示 Windows 发布者提示。

## 技术结构

Electron 主进程负责 Windows 窗口 API、文件系统和 `node-pty` 会话；React 界面只通过受限的 preload API 调用这些功能。终端使用 xterm.js 显示。`node_modules/`、构建产物、本机数据和 `.env` 文件不纳入 Git。

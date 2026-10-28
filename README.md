# QoderMod

给 Qoder CN 桌面端做本地功能增强的小工具：**一个极简控制台启动器 + Qoder 内置设置中心**。
A lightweight local-enhancement toolkit for the Qoder CN desktop app: **a minimal console launcher + an in-app settings center**.

> 本项目与 Qoder / 阿里巴巴官方无关，仅供本机个人学习与自用。
> This project is not affiliated with Qoder or Alibaba. For personal learning and local use only.

---

## 中文

### 简介

QoderMod 由两部分组成：

- **控制台启动器**（`QoderModLauncher.exe`）：自动定位并启动 Qoder，注入 `bridge.dll`，输出全过程日志；
- **设置中心**（注入到 Qoder 界面）：提供系统提示词、规则库、安全研究模式、方案库与主题/语言等设置，保存后热更新。

### 功能

- 控制台菜单：`[1]` 启动并注入 / `[2]` 关闭并重启 / `[3]` 重新定位 Qoder / `[0]` 退出
- 自动定位安装位置：相对路径 → 常见安装目录 → 注册表卸载项 → 全盘扫描（结果缓存 `bin\qoder-exe.txt`）
- 注入失败自动重试（单轮 5 次 + 整轮重试一次）
- 中英双语控制台（跟随 `qcmod.json` 的 `lang`，`auto` 时跟随系统）
- 设置中心：
  - 提示词注入：追加 / 前置 / 替换三种模式，支持 `{{date}}` / `{{datetime}}` 变量
  - 规则库：13 条内置 Agent 规则（中文优先、计划先行、批量编辑、补丁式写入、一次验证等）
  - 安全研究模式（授权测试 / CTF / CVE 分析场景的提示框架）
  - 方案库：保存 / 应用 / 删除 / 导入导出
  - 设置：主题（跟随系统 / 深色 / 浅色）、语言、界面模式（侧边栏 / 折叠 / 标签）、重置
- UI 细节：弹窗每次打开居中、打开/关闭动效、保存后 toast + ✓ 状态并自动关窗、面板可缩放并记忆尺寸
- 配置持久化到 `%USERPROFILE%\.qoder-cn\qcmod.json`，保存后约 2 秒内热更新到所有页面
- 构建产物使用唯一文件名（`bridge_<随机>.dll`），避免 DLL 被占用导致构建失败

### 目录结构

```
QoderMod/
├─ src/
│  ├─ Launcher/Launcher.cs    控制台启动器（定位/启动/注入/日志/i18n）
│  ├─ Bridge/bridge.cpp       bridge.dll（CDP 注入、配置热更新）
│  ├─ Payload/hook.js         渲染层功能层（请求提示词注入）
│  ├─ Payload/ui.js           Qoder 内置设置中心
│  └─ Assets/qmod.ico|png     应用图标
├─ build.bat                  一键构建
└─ bin/                       构建产物（不提交）
```

### 构建

依赖：

- x64 MinGW（默认 `D:\Dev-Cpp\mingw64\bin\g++.exe`，可在 `build.bat` 中修改）
- .NET Framework 4.x 自带 `csc.exe`（`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）

```bat
build.bat
```

产物在 `bin\`：`QoderModLauncher.exe`、`bridge_<随机>.dll`、`hook.js`、`ui.js`、`qmod.ico`。

### 使用

1. 双击 `bin\QoderModLauncher.exe`；
2. 选 `[1]` 启动并注入（Qoder 已运行则注入当前实例）；
3. Qoder 顶部菜单出现 **QoderMod**（或按 `Ctrl+Shift+M`）打开设置中心；
4. 所有配置在面板内修改并保存（写入 `qcmod.json`，2 秒内热更新）。

命令行：`QoderModLauncher.exe --launch`（启动并注入）/ `--inject`（仅注入）/ `--find`（定位安装位置）。

### 已知限制

- 聊天请求与文件工具调用运行在 Qoder **主进程**，渲染层钩子只能覆盖渲染进程发起的请求；因此提示词规则对部分聊天请求可能不生效。
- Qoder 禁用了 `--inspect`，且对 `app.asar` 有自愈/校验机制，主进程级补丁不可行（相关尝试已被移除）。
- 官方更新可能改变内部结构，导致注入失效。

### 免责声明

- 仅限本机个人使用，请勿分发修改后的 Qoder 程序；
- 修改第三方软件可能违反其许可协议，风险自负；
- 图标基于 Qoder 标志魔改，仅作个人项目标识，Qoder 商标归其权利人所有。

---

## English

### Overview

QoderMod has two parts:

- **Console launcher** (`QoderModLauncher.exe`): locates and starts Qoder, injects `bridge.dll`, logs everything;
- **Settings center** (injected into the Qoder UI): system prompt, rule library, security-research mode, presets, theme/language, hot-applied on save.

### Features

- Console menu: `[1]` launch & inject / `[2]` close & relaunch / `[3]` relocate Qoder / `[0]` exit
- Auto-discovery: relative paths → common install dirs → registry uninstall entries → full-drive scan (cached in `bin\qoder-exe.txt`)
- Automatic retry on injection failure (5 per round + one full retry)
- Bilingual console (follows `lang` in `qcmod.json`; `auto` follows the OS)
- Settings center:
  - Prompt injection: append / prepend / replace, with `{{date}}` / `{{datetime}}` variables
  - Rules: 13 built-in agent rules (Chinese-first, plan-first, batch edits, patch-style writes, verify-once, etc.)
  - Security-research mode (authorized testing, CTF, CVE analysis)
  - Presets: save / apply / delete / export-import
  - Settings: theme (system / dark / light), language, layout (sidebar / accordion / tabs), reset
- UI polish: centered dialog, open/close animations, save toast + ✓ state + auto-close, resizable with remembered size
- Config persisted at `%USERPROFILE%\.qoder-cn\qcmod.json`, hot-applied to all pages in ~2s
- Unique build artifact names (`bridge_<rand>.dll`) to avoid file-lock build failures

### Build

Requirements: x64 MinGW (default `D:\Dev-Cpp\mingw64\bin\g++.exe`) and the .NET Framework `csc.exe`. Run `build.bat`; artifacts land in `bin\`.

### Usage

1. Run `bin\QoderModLauncher.exe`
2. Choose `[1]` (injects the running instance if Qoder is already open)
3. Open **QoderMod** from Qoder's top menu (or `Ctrl+Shift+M`);
4. Edit and save settings (written to `qcmod.json`, hot-applied within ~2s).

CLI: `--launch`, `--inject`, `--find`.

### Known limitations

- Chat and file-tool traffic live in Qoder's **main process**; renderer hooks only cover renderer-originated requests, so some chat requests may bypass prompt rules.
- Qoder disables `--inspect` and self-heals `app.asar`, so main-process patching is not viable (those attempts were removed).
- App updates may break injection.

### Disclaimer

- Personal local use only; do not redistribute a modified Qoder build.
- Modifying third-party software may violate its EULA — use at your own risk.
- The icon is a derivative of the Qoder logo for project identification only; the Qoder trademark belongs to its owner.

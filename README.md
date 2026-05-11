
<div align="center">
  <a href="https://github.com/yeahhe365/gemini-nexus">
    <img src="https://github.com/user-attachments/assets/5c5c1f06-7fb2-43b7-b467-f08680d76e70" width="160" height="160" alt="Gemini Nexus Logo">
  </a>

  # Gemini Nexus
  ### 🚀 赋予浏览器原生 AI 灵魂：深度集成 Google Gemini 的全能助手

  <p>
    <img src="https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini">
    <img src="https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension">
    <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  </p>

  <img src="./assets/readme-hero.png" alt="Gemini Nexus browser assistant preview" width="900">

  ---
</div>

## 🌟 项目简介

**Gemini Nexus** 是一款深度集成 Google Gemini 能力的 Chrome 扩展程序。它不仅仅是一个侧边栏插件，而是通过注入式的**悬浮工具栏**、强大的**图像 AI 处理**以及前沿的**浏览器控制协议 (MCP)**，将 AI 的触角伸向网页浏览的每一个交互细节。

---

## 🔧 二开版本说明

这是基于原项目 [yeahhe365/gemini-nexus](https://github.com/yeahhe365/gemini-nexus) 的增强版本。相比原版，这个版本更偏向日常高频使用：支持更多模型渠道、更稳定的长对话、更完整的工具调用展示，以及更适合多标签页浏览场景的侧边栏体验。

### 这个版本适合谁？

*   想在浏览器侧边栏里长期使用 AI 对话，而不是只做一次性问答。
*   想接入自己的 **Gemini API**、**OpenAI Compatible API** 或第三方中转服务。
*   想在网页中直接划词翻译、总结、改写，或者对截图、图片、页面内容提问。
*   想使用 MCP 工具，让 AI 能调用外部工具完成搜索、读取网页、自动操作等任务。
*   想在多个标签页中使用侧边栏，但不希望不同页面之间互相串会话。

### 主要增强能力

#### 多模型与多渠道

*   支持三种使用方式：**Gemini Web Client**、**Gemini API**、**OpenAI Compatible API**。
*   OpenAI Compatible API 支持自定义 `Base URL`、`API Key` 和多个模型名称，适合接入第三方兼容服务。
*   OpenAI Compatible API 支持 **Chat Completions** 和 **Responses API** 两种模式。
*   Gemini API 和 OpenAI Compatible API 都可以使用独立的模型配置，切换渠道后会记住各自的模型选择。
*   支持联网搜索能力，回答中可以展示引用来源，方便核对信息。

#### 更适合长对话

*   支持历史用户消息编辑，可以从任意一条用户消息重新修改并继续生成。
*   支持上下文管理，长对话会自动压缩或只保留最近若干轮，降低超出模型上下文长度的概率。
*   生成中的会话可以在后台继续运行，切换到其他历史会话不会中断当前回复。
*   历史列表会标记正在生成的会话，方便回到对应对话查看结果。

#### 更稳定的侧边栏体验

*   支持按标签页管理侧边栏会话，减少多个标签页之间串会话、串回复的问题。
*   优化了侧边栏打开、关闭和恢复历史会话的流畅度。
*   流式输出时，如果你停留在底部，会自动跟随最新内容；如果你主动上滑阅读旧内容，不会强制把你拉回底部。
*   重新打开侧边栏后，会尽量恢复当前标签页对应的会话状态。

#### 工具调用与 MCP

*   支持连接外部 MCP 服务器，可以通过 SSE、可流式传输的 HTTP 或 WebSocket 使用外部工具。
*   可以保存多个 MCP 服务器，并选择当前活动服务器。
*   工具较多时，可以只向模型公开选定工具，减少干扰。
*   工具调用会以折叠信息框展示，参数、状态和结果都可以查看，但不会占满聊天正文。
*   工具调用过程中的 JSON 协议内容会被自动收纳，不会再频繁显示成普通代码块影响阅读。

#### 网页与图片场景

*   保留原有划词工具栏能力，支持翻译、总结、解释、改写等常用操作。
*   支持页面引用、截图、OCR、截图翻译和图片分析。
*   聊天中的外部链接会在浏览器新标签页打开，避免侧边栏中打开外站失败。
*   Markdown、代码块、公式和图片内容会在隔离环境中渲染，降低对当前网页的影响。

### 和原版的关系

这个版本仍然保留原项目的核心交互：侧边栏聊天、网页划词工具栏、图片分析和浏览器内 AI 助手体验。在此基础上，重点增强了 API 渠道、长对话、工具调用、多标签页侧边栏和稳定性体验。

---

## ⚙️ 多驱动核心对比 (services/providers)

项目内置了三种驱动方案，通过代码逻辑动态适配不同的使用场景：

| 驱动方案 | 逻辑入口 | 支持模型 | 核心优势 | 使用前提 |
| :--- | :--- | :--- | :--- | :--- |
| **Web Client** | `web.js` | Gemini 3 系列 | **完全免费**，支持联网插件 | 需保持 Google 账号登录 |
| **Official API** | `official.js` | Pro/Flash 预览版 | **极速响应**，原生支持 **Thinking** 模式 | 需 Google AI Studio Key |
| **OpenAI Compatible** | `openai_compatible.js` | GPT/Claude 等 | **高扩展性**，支持中转接口 | 需第三方服务密钥 |

---

## 🤖 浏览器控制 (MCP) 能力集

基于 `background/control/` 模块实现，AI 可以执行复杂的 Agent 任务：

| 分类 | 核心指令 | 代码实现逻辑 |
| :--- | :--- | :--- |
| **导航控制** | `navigate_page`, `new_page` | 调用 `chrome.tabs` 进行页面生命周期管理 |
| **页面交互** | `click`, `fill`, `drag` | 基于 **Accessibility Tree** 生成 UID 进行精准操控 |
| **数据观测** | `take_snapshot`, `get_logs` | 实时提取 DOM 结构、控制台日志及网络请求 |
| **脚本执行** | `evaluate_script` | 在网页 Context 中运行自定义 JavaScript |

---

## 外部 MCP 工具（远程服务器）

Gemini Nexus 可以选择连接到外部 MCP 服务器（通过 **SSE**、**可流式传输的 HTTP** 或 **WebSocket**），并在现有的工具循环（Tool Loop）中执行其工具。

### 推荐方案：使用本地代理（支持 stdio 服务器）

由于 Chrome 扩展程序无法直接运行基于 stdio 的 MCP 服务器，推荐的设置方案是运行一个本地代理（例如 [MCP SuperAssistant](https://github.com/srbhptl39/MCP-SuperAssistant) Proxy）。在代理中配置您的 MCP 服务器（包括 stdio 服务器），然后将 Gemini Nexus 连接到该代理端点。

常见的代理端点如下：

  * **SSE**: `http://127.0.0.1:3006/sse`
  * **可流式传输的 HTTP**: `http://127.0.0.1:3006/mcp`
  * **WebSocket**: `ws://127.0.0.1:3006/mcp`

### 设置步骤

1.  启动您的 MCP 代理并在其中配置好 MCP 服务器。

2.  在 **设置 (Settings) → 连接 (Connection) → 外部 MCP 工具 (External MCP Tools)** 中：

      * 启用“外部 MCP 工具” (Enable External MCP Tools)。
      * 选择一个**活动服务器** (Active Server)（您可以保存多个服务器条目并根据需要切换）。
      * 选择传输协议并设置服务器 URL（SSE / 可流式传输的 HTTP / WebSocket）。
      * 点击**测试连接** (Test Connection) 和**刷新工具** (Refresh Tools)。

3.  可选（当工具较多时推荐）：将**公开工具** (Expose Tools) 设置为**仅限选定工具** (Selected tools only)，然后仅启用您希望模型查看/使用的工具。

4.  开始正常对话；当模型需要使用工具时，它会输出一个如下所示的 JSON 工具块：

    ```json
    { "tool": "工具名称", "args": { "键": "值" } }
    ```


---

## ✨ 核心功能亮点

*   **💬 智能侧边栏**：基于 `sidePanel` API，提供毫秒级唤起的对话空间，支持全文搜索历史记录。
*   **🪄 划词工具栏**：注入 Content Script，选中文字即刻进行**翻译、总结、重写**，支持一键回填表单。
*   **🖼️ 图像 AI 处理**：
    *   **OCR & 截图翻译**：集成 Canvas 裁剪技术，框选图片区域即刻提取文字并翻译。
    *   **浮窗探测**：自动识别网页图片并生成悬浮 AI 分析按钮。
    *   **水印消除**：内置 `watermark_remover.js` 算法，显著提升生成图像的可视化质量。
*   **🛡️ 安全渲染**：所有 Markdown、LaTeX 公式及代码块均在 `sandbox` 隔离环境中渲染，确保主页面安全。

---

## 🚀 快速开始

### 安装步骤
1.  从 [Releases](https://github.com/yeahhe365/gemini-nexus/releases) 下载最新 ZIP 包并解压。
2.  Chrome 访问 `chrome://extensions/`，右上角开启 **“开发者模式”**。
3.  点击 **“加载已解压的扩展程序”**，选择解压后的文件夹即可。

### 技术栈
*   **构建工具**：Vite + TypeScript
*   **架构协议**：Chrome MV3 + Browser Control Protocol
*   **核心库**：Marked.js, KaTeX, Highlight.js

## 📄 许可证

本项目基于 **MIT License** 开源。

## 致谢

本项目已在 [LINUX DO 社区](https://linux.do) 发布，感谢社区的支持与反馈。

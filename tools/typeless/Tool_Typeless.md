# 🎙️ Tool: Typeless (NeoAgent Edition)

> **一句话定位**: 你的 AI 随身速记员。基于 Gemini 1.5 Flash 的本地语音转文字 + 智能润色工具。

## 🚀 核心价值 (Why)
模仿 [Typeless.com](https://www.typeless.com) 的核心体验，将碎片化的口语直接转化为结构化、出版级的文字。

## ⚙️ 如何使用 (Usage)

1.  **启动**:
    ```bash
    python3 99_系统/Skills/typeless.py
    ```
2.  **录音**:
    - 看到 `🎙️ Recording...` 提示后开始说话。
    - 说完后按 **Enter** 键停止。
3.  **结果**:
    - ✨ **Clipboard**: 润色后的文字会自动复制到剪贴板，直接粘贴到微信/文档即可。
    - 📂 **File**: 自动保存到 `00_收集/` 目录下，作为永久存档。

## 🔧 配置 (Configuration)

需要配置 `GEMINI_API_KEY` 环境变量:
```bash
export GEMINI_API_KEY="your_api_key_here"
```

## ⌨️ 快捷键唤起 (Hotkeys)

`typeless.py` 本身是命令行工具，不支持全局快捷键。但你可以通过系统工具包装来实现 **"一键唤起终端录音"** 的体验。

## 🚀 极速模式 (Server Mode) - 推荐

为了达到毫秒级的响应速度，建议使用 **Server-Client** 模式：

1.  **启动服务端** (建议在 tmux 或作为后台服务运行):
    ```bash
    export GEMINI_API_KEY="your_key"
    python3 "99_系统/Skills/typeless_server.py"
    ```
    *服务端启动后会常驻内存，预加载好所有 AI 库。*

2.  **更新快捷键**:
    *   将 Automator / Raycast 的脚本路径指向新的客户端脚本：
    *   `"99_系统/Skills/typeless_client.sh"`

    **原理**: Client 脚本只发送一个 HTTP 请求给 Server，耗时 < 10ms。Server 收到请求后立即开始/停止录音。

### 方式一：Automator (macOS 原生 - 无弹窗版)

1.  打开 **Automator** -> 新建 **Quick Action (快速操作)**。
2.  设置 "Workflow receives" 为 **no input**。
3.  添加 **Run AppleScript** 操作，填入以下代码：
    ```applescript
    on run {input, parameters}
        do shell script "\"/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/NeoAgent/99_系统/Skills/typeless_client.sh\""
        return input
    end run
    ```
4.  保存为 `Typeless Launcher`。
5.  在 **System Settings -> Keyboard -> Keyboard Shortcuts -> Services** 中找到它，并设置快捷键 (如 `Cmd + Opt + V`)。
    *   **注**: 第一次运行时可能会弹出权限请求（访问麦克风、Accessibility等），请允许。

### 方式二：Raycast (推荐)

如果你使用 Raycast，可以创建一个 Script Command：

1.  在 Raycast 中搜索 "Create Script Command"。
2.  Template 选择 "Bash"。
3.  Mode 选择 "Full Output" (为了看到录音状态)。
4.  Script 内容填入：
    ```bash
    #!/bin/bash
    # @raycast.title Typeless Voice Note
    # @raycast.author NeoAgent
    # @raycast.mode fullOutput
    
    "/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/NeoAgent/99_系统/Skills/typeless_launcher.sh"
    ```

## 📜 源代码 (Source Code)

> **File Path**: `99_系统/Skills/typeless.py`

此脚本使用了 Google Gemini 1.5 Flash 的原生音频理解能力，实现了：
1.  **One-Shot Processing**: 不再区分 ASR (Whisper) 和 LLM (GPT)，直接将音频丢给 Gemini，一次性完成"转录+润色"。
2.  **Privacy/Cleanup**: 录音产生的临时 WAV 文件会在上传后立即删除。

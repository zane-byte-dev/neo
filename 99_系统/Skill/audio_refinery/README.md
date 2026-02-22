---
type: tool
name: Audio Refinery
language: python
version: 1.1.0
dependencies: [edge-tts]
tags:
  - tool
  - skill
  - audio
  - podcast
---

# 🎧 Tool: Audio Refinery (声音炼油厂)

> **一句话定位**: Inkbrain 的发声器官。将 Markdown 文章批量转化为高质量的播客级语音 (.mp3)。

## 🚀 如何使用 (Usage)

1.  **单篇生成**:
    ```bash
    python3 "99_系统/Skills/audio_refinery.py" "03_文章/记忆承载全集/001_序言.md"
    ```
2.  **批量生成 (整本书)**:
    ```bash
    python3 "99_系统/Skills/audio_refinery.py" "03_文章/记忆承载全集"
    ```
3.  **更换语音 (如男声)**:
    ```bash
    python3 "99_系统/Skills/audio_refinery.py" "..." "zh-CN-YunxiNeural"
    ```

## ⚙️ 功能特性 (Features)

*   ✅ **Markdown Cleaning**: 自动剔除 `#`, `**`, `[[]]` 等不该被朗读的符号。
*   ✅ **Auto Embed**: 生成音频后，自动将 `![[Audio/xxx.mp3]]` 链接回填至 Markdown 顶部。
*   ✅ **Batch Processing**: 智能遍历目录，自动跳过已生成的文件。
*   ✅ **Microsoft Neural TTS**: 免费调用 Edge 浏览器接口，音质媲美真人。
*   ✅ **Auto Organize**: 音频文件自动存入同级 `Audio/` 文件夹，保持整洁。

## 📜 源代码 (Source Code)

> **File Path**: `99_系统/Skills/audio_refinery.py`

```python
#!/usr/bin/env python3
import os
import sys
import re
import asyncio
import edge_tts
# ... (见源文件)
```

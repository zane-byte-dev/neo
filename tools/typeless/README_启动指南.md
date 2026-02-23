# 🎙️ Typeless 启动指南

## 📦 安装依赖

### 方法 1：一键安装（推荐）

```bash
cd "/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/NeoAgent/99_系统/Skills"
pip3 install python-dotenv
```

### 方法 2：完整依赖列表

如果需要安装所有依赖：

```bash
pip3 install sounddevice scipy numpy google-generativeai pynput requests faster-whisper python-dotenv
```

## 🚀 启动服务

### 方法 1：使用启动脚本（推荐）✨

```bash
cd "/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/NeoAgent/99_系统/Skills"
./start_typeless.sh
```

**说明**：自动使用 Python 3.12，支持完整的 Local 模式（Whisper + Ollama）

### 方法 2：直接启动（使用系统 Python）

```bash
cd "/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/NeoAgent/99_系统/Skills"
/opt/homebrew/opt/python@3.12/bin/python3.12 typeless_server.py
```

### 方法 3：后台运行

```bash
cd "/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/NeoAgent/99_系统/Skills"
nohup /opt/homebrew/opt/python@3.12/bin/python3.12 typeless_server.py > logs/server.log 2>&1 &
```

## ⚙️ 配置说明

所有配置已保存在 `.env` 文件中，你可以随时编辑：

```bash
nano .env  # 或使用其他编辑器
```

### 主要配置项

| 配置项 | 当前值 | 说明 |
|--------|--------|------|
| `GEMINI_API_KEY` | 已设置 | Gemini API 密钥 |
| `MODE` | `cloud` | 模式：cloud（云端）或 local（本地）|
| `PORT` | `52345` | 服务器端口 |
| `MAX_RECORDING_DURATION` | `300` | 最大录音时长（秒）|
| `MIN_RECORDING_DURATION` | `0.3` | 最小录音时长（秒）|
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini 模型 |
| `INPUT_LANGUAGE` | `auto` | 输入语言：auto/zh/en |
| `OUTPUT_LANGUAGE` | `auto` | 输出语言：auto（中英混合，英文不翻译）/zh/en |

**🌍 语言**：仅中英，中文为主，英文术语保持不翻译。详见 `语言配置说明.md`

## 🎮 使用方法

1. **启动服务**：运行 `python3 typeless_server.py`
2. **开始录音**：按住 **右 Option 键**（Right Alt）
3. **停止录音**：松开 **右 Option 键**
4. **自动处理**：转录并插入到光标位置

## 📊 日志查看

日志文件位置：`logs/typeless.log`

查看实时日志：
```bash
tail -f logs/typeless.log
```

## 🔧 切换模式

### 切换到本地模式（使用 Ollama + Whisper）

```bash
curl http://127.0.0.1:52345/mode/local
```

### 切换到云端模式（使用 Gemini）

```bash
curl http://127.0.0.1:52345/mode/cloud
```

### 查看当前状态

```bash
curl http://127.0.0.1:52345/status
```

## 🐛 问题排查

### 问题 1：提示 "python-dotenv not installed"

**解决方案**：
```bash
pip3 install python-dotenv
```

服务仍可正常运行，但建议安装以获得更好的配置管理。

### 问题 2：提示 "GEMINI_API_KEY environment variable not set"

**解决方案**：
1. 检查 `.env` 文件是否存在
2. 确认 `GEMINI_API_KEY` 已正确填写
3. 重启服务

### 问题 3：录音无声音

**解决方案**：
1. 检查麦克风权限：系统偏好设置 → 安全性与隐私 → 麦克风
2. 确认给予 Terminal 或 Python 麦克风权限

### 问题 4：无法输入文本

**解决方案**：
1. 检查辅助功能权限：系统偏好设置 → 安全性与隐私 → 辅助功能
2. 添加 Terminal 到允许列表

## 📝 更新配置

编辑 `.env` 文件后，需要重启服务才能生效：

```bash
# 找到进程 ID
ps aux | grep typeless_server.py

# 停止服务
kill <进程ID>

# 重新启动
python3 typeless_server.py
```

## 🔥 快速测试

启动后，按住右 Option 键，说一句话，松开。如果成功，文本会自动出现在光标位置。

## 💡 提示

- 第一次使用 Local 模式时，会下载 Whisper 模型，需要等待
- Cloud 模式需要稳定的网络连接
- 建议在安静环境下录音以获得最佳效果
- 可以通过修改 `.env` 文件调整录音时长限制

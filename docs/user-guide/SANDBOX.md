# Sandbox 使用指南

Neo 的沙箱层负责执行 `code_exec` 和底层临时代码运行。它支持本机模式和 Docker 模式，并会收集运行过程中写入输出目录的产物。

## 运行模式

| 模式 | 配置 | 说明 |
|------|------|------|
| host | `SANDBOX_MODE=host` | 默认模式，在宿主机进程中执行，启动快，隔离较弱 |
| docker | `SANDBOX_MODE=docker` | 使用 Docker 容器执行，隔离更强，需要本机可用的 `docker` CLI |

当设置为 `docker` 但 Docker 不可用时，Neo 会记录 warning 并回退到 host 模式。

## code_exec 工具

`code_exec` 是面向 Agent 的代码执行工具，支持 `python` 和 `node` 两种语言。它使用持久 REPL：同一会话、同一语言下，变量、导入和函数定义会在后续调用中保留。

工具参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `language` | 是 | `python` 或 `node` |
| `code` | 是 | 要执行的代码；需要输出结果时请显式 `print()` / `console.log()` |
| `timeout_ms` | 否 | 本次执行超时时间，受 `SANDBOX_MAX_TIMEOUT_MS` 上限约束 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SANDBOX_MODE` | `host` | `host` 或 `docker` |
| `SANDBOX_IMAGE` | `node:20-bookworm-slim` | Docker 模式使用的镜像 |
| `SANDBOX_MEMORY_MB` | `512` | Docker 内存上限 |
| `SANDBOX_CPUS` | `1` | Docker CPU 上限 |
| `SANDBOX_PIDS` | `256` | Docker 进程数上限 |
| `SANDBOX_NETWORK` | `none` | Docker 网络模式，通常保持 `none` |
| `SANDBOX_TIMEOUT_MS` | `30000` | 默认超时，单位毫秒 |
| `SANDBOX_MAX_TIMEOUT_MS` | `300000` | 单次执行最大超时 |
| `SANDBOX_READONLY` | 未启用 | 设置为 `1` 时以只读方式挂载 workspace |
| `SANDBOX_OUTPUT_DIR` | `.outputs` | 自动收集为产物的相对目录 |

## 产物输出

如果代码在 workspace 的 `SANDBOX_OUTPUT_DIR` 目录下写入文件，沙箱会在执行前后做快照，并把新增或更新的文件列为 artifacts。常见 MIME 类型会自动识别，例如 PNG、HTML、JSON、CSV、Markdown、PDF、MP4。

```python
from pathlib import Path
Path('.outputs').mkdir(exist_ok=True)
Path('.outputs/result.csv').write_text('name,value\nneo,1\n')
print('done')
```

Agent 会在工具结果中看到类似：

```text
done
[artifacts]
  - .outputs/result.csv (17B · text/csv)
```

## Docker 前置条件

1. 安装 Docker Desktop 或可用的 Docker CLI。
2. 确认 `docker ps` 能正常执行。
3. 设置 `SANDBOX_MODE=docker` 后重启 Neo。
4. 如果需要联网，显式设置 `SANDBOX_NETWORK=bridge`；默认不开放网络。

## 排查

- 设置 `LOG_LEVEL=debug` 查看沙箱选择、超时和产物收集日志。
- Docker 模式异常时先运行 `docker run --rm node:20-bookworm-slim node -v` 验证镜像和 CLI。
- `code_exec` 超时后，对应 REPL 会被重置；把长任务拆小，或提高 `timeout_ms` 与 `SANDBOX_MAX_TIMEOUT_MS`。
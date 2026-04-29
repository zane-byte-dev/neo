# Example Workspace

> 这是 Neo 的最小可用 workspace 模板。复制到你 `config.local.ts` 中
> `USERS[].workDir` 指向的目录，然后按需修改即可。

如果新用户的 `workDir` / `stateDir` 指向的是空目录，Neo 现在会在首次访问时自动：

- 把这个模板补齐到 `workDir`
- 创建 `stateDir/skills` 和 `stateDir/tools`

已有文件不会被覆盖；自动初始化只会补缺。

## 文件清单

| 文件 | 必需 | 位置 | 作用 |
|------|------|------|------|
| `AGENTS.md` | ✅ | `workDir/` | Agent 任务路由与工具调用规则；缺失时 Neo 会拒绝启动该用户 |
| `SOUL.md` | 可选 | `workDir/` | 助手的身份、语气、沟通风格 |
| `USER.md` | 可选 | `workDir/` | 用户基本信息与长期偏好；首次访问会自动生成模板 |
| `TOOLS.md` | 可选 | `workDir/` | 项目特定的工具使用指引（系统内置工具不必在此列出） |
| `notebooks/` | 可选 | `workDir/` | 知识库 Markdown 文件，会被自动索引（FTS5） |
| `skills/` | 可选 | **`stateDir/`** | 用户自定义 Skill（带 YAML frontmatter 的 Markdown） |
| `tools/` | 可选 | **`stateDir/`** | 用户自定义工具（`tool.yaml` + `run.py` / `run.sh`） |

> ⚠️ `skills/` 和 `tools/` 放在 **`stateDir`** 下（即 Neo 运行态目录），而不是 `workDir`。本模板只包含 `workDir` 部分。

## 复制方法

```bash
# 假设 workDir 是 ~/neo-workspace
mkdir -p ~/neo-workspace
cp -R examples/workspace/* ~/neo-workspace/

# 然后在 src/config.local.ts 里把 workDir 指向 ~/neo-workspace
```

如果你想自定义默认模板，仍然可以在首次访问前手动复制并修改这些文件。

修改这些文件后，访问 `POST /api/reload` 让 Neo 重新加载缓存（或重启进程）。

## 仅供示例

模板内容是**通用占位文本**——按你自己的工作流改写：

- `SOUL.md` 决定 Neo 跟你说话的语气
- `USER.md` 让 Neo 记得你是谁、在做什么
- `AGENTS.md` 决定它在不同任务下用什么策略和工具

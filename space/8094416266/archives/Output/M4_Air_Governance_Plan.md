# M4 & Air 分工与工具治理方案 (v1.0)

## 1. 硬件定位与分工 (Worker vs. Interaction)

| 维度 | Mac Mini M4 (Worker Node) | MacBook Air (Interaction Node) |
| :--- | :--- | :--- |
| **核心角色** | **算力与持久化中心** | **交互与开发终端** |
| **核心负载** | 本地模型 (MLX/Ollama)、向量库、PM2 守护进程 | 浏览器、IDE (Cursor/VSCode)、Raycast、通讯 |
| **数据存储** | 知识库全量、向量索引、外挂 SSD (待办) | 临时笔记、当前开发分支 |
| **网络策略** | 7x24h 在线，作为 LiteLLM 网关出口 | 随用随连，通过 SSH/Tailscale 访问 M4 |

---

## 2. 工具链收敛与治理 (Tooling Governance)

### 现状诊断
- **痛点**：`geminicli`, `copilot-cli`, `gpt-cli` 各自为政，API Key 维护困难，上下文不互通。
- **目标**：**以 LiteLLM 为中心化路由，收敛 CLI 交互。**

### 治理逻辑：三层过滤体系

#### 第一层：OS 级交互 (Air 端)
- **Raycast AI / Chatbox**：用于非代码类、日常百科、快速翻译。
- **场景**：不需要留存到工程项目的快速问答。

#### 第二层：工程级交互 (IDE 端)
- **Cursor / VSCode Copilot**：用于代码补全、重构。
- **场景**：深度编程，直接操作代码上下文。

#### 第三层：系统级/自动化交互 (M4 端 - 核心治理点)
- **统一入口**：在 M4 上部署 **LiteLLM**。
- **收敛方案**：
    - **废弃**：单独的 `geminicli`, `gpt-cli`。
    - **替代**：使用一个通用的 CLI 工具 (如 `llm` 或自定义 alias) 指向 `http://m4-ip:4000/v1`。
    - **保留**：`github-copilot-cli` (仅用于终端命令生成 `??`)。

---

## 3. 场景化工具推荐路径

| 场景 | 推荐工具 | 路径 |
| :--- | :--- | :--- |
| **想问个简单问题** | Raycast (Air) | `Option + Space` |
| **需要处理敏感/私密文档** | Ollama + Llama3 (M4) | `ssh m4 -> llm "..."` |
| **需要自动化生成周报/文章** | inkClaw (M4/PM2) | Telegram Bot |
| **需要快速生成 Shell 命令** | Copilot CLI (Air/M4) | `gh copilot suggest` |
| **需要测试不同模型的推理** | LiteLLM UI (M4) | Browser -> M4:4000 |

---

## 4. 下一步行动 (Action Items)
1. [ ] **M4**：部署 LiteLLM，聚合 Gemini/OpenAI/LocalLLM 的 Key。
2. [ ] **Air**：配置 `~/.zshrc`，将 `ai` 命令别名指向 M4 的 LiteLLM 端口。
3. [ ] **清理**：从 Air 卸载冗余的单模型 CLI。

# Smart Scoring — 智能请求评分与模型路由

> 目标：auto 模式下根据请求复杂度自动选择最经济的模型，同时具备完善的可观测性。

---

## 〇、行业调研

在设计前对主流 LLM 路由方案做了全面调研，以下是最有参考价值的项目：

### 路由策略类

| 项目 | Stars | 核心思路 | 对 Neo 的启发 |
|------|-------|---------|-------------|
| [**Manifest**](https://github.com/mnfst/manifest) | 5.2k | 23 维关键词 + 结构评分，Trie 扫描 <2ms，分 4 层 | 评分维度设计、momentum 惯性、置信度回退 |
| [**RouteLLM**](https://github.com/lm-sys/RouteLLM) (LMSYS) | 4.8k | 用偏好数据训练路由器（MF/BERT/LLM），strong vs weak 二分 | **阈值校准**思路——用历史数据校准 cost threshold |
| [**NVIDIA LLM Router**](https://github.com/NVIDIA-AI-Blueprints/llm-router) | 248 | 两种策略：Intent-based（小 LLM 分类）+ Auto-routing（CLIP + NN） | Intent-based 路由的 config 映射模式很清晰 |

### 网关/基础设施类

| 项目 | Stars | 核心能力 | 对 Neo 的启发 |
|------|-------|---------|-------------|
| [**LiteLLM**](https://github.com/BerriAI/litellm) | 43.9k | 统一 100+ provider 的 OpenAI 兼容接口，内置 retry/fallback/cost tracking | **model_prices_and_context_window.json** 单价库，fallback 链设计 |
| [**Portkey AI Gateway**](https://github.com/Portkey-AI/gateway) | 11.4k | <1ms 延迟的 AI 网关，retry + fallback + load balancing + guardrails | **Config-driven 路由**、Semantic Cache、guardrails 概念 |
| [**SmarterRouter**](https://github.com/peva3/SmarterRouter) | — | Ollama/llama.cpp 网关，VRAM 感知 + semantic cache + model profiling | **Semantic Cache** 相同问题直接返回缓存 |

### 关键洞察

1. **规则 vs 学习路由**：RouteLLM 用 ML 训练路由器（MF 矩阵分解），效果好但需要偏好训练数据；Manifest 用纯规则（关键词 + 结构分析），零训练上手即用。**Neo 适合规则路由**——我们没有大量偏好标注数据，且模型池小。
2. **Strong/Weak 二分 vs 多层级**：RouteLLM 只分 strong/weak 两档，Manifest 分 4 档。Neo 用 **3 档**（simple/standard/complex）是合理折中。
3. **LiteLLM 的单价库**值得直接引用：它维护了 2300+ 模型的实时定价，可作为我们 cost 计算的数据源。但我们模型少，不值得引入整个依赖，直接维护自己的小单价表。
4. **Semantic Cache** 是降本利器（Portkey、SmarterRouter 都有）：相同/相似问题直接返回缓存响应。但对 Neo 的工具调用场景不适用（每次上下文不同），**暂不实现，留作 P2**。
5. **Portkey 的 Config-driven 思路**很好：路由规则、retry、fallback 都写在配置里而不是硬编码。我们可以借鉴做成可配置的。

---

## 一、现状与目标

### 现状

`model-router.ts` 只看两个信号：`hasTools` + provider 可用性。
无法区分 "你好" 和 "帮我写一个分布式任务调度系统"——都走同一个模型。

### 设计目标

1. **<2ms** 评分延迟（纯本地 Trie + 正则 + 计数，不调 LLM）
2. **3 tier** 分层：simple / standard / complex
3. **8 维**评分，覆盖 Neo 实际使用场景
4. **Token/cost 追踪** + **自动 fallback 重试**
5. **Config-driven**：路由规则可通过配置调整，不改代码

---

## 二、整体架构

```
用户消息
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Scorer    │────▶│ Model Router │────▶│   LLM Client    │
│  8 维评分   │     │  tier→model  │     │  stream/generate │
│  <2ms       │     │  config-driven│     │  + fallback      │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                  │
                                                  ▼
                                          ┌───────────────┐
                                          │ Usage Tracker  │
                                          │ token/cost/    │
                                          │ latency → jsonl│
                                          └───────────────┘
```

### 数据流

1. **Scorer** 接收 `{ messages, tools, tool_choice }` → 输出 `{ tier, score, confidence, reason, dimensions }`
2. **Model Router** 根据 tier + 路由配置 → 输出 model alias
3. **LLM Client** 调用模型，失败时按 fallback 链重试
4. **Usage Tracker** 记录每次调用的 token/cost/latency

---

## 三、评分维度（8 维）

### 关键词类（Trie 扫描）

| # | 维度 | 权重 | 方向 | 关键词示例 |
|---|------|------|------|-----------|
| 1 | simpleIndicators | 0.10 | ↓ | "你好", "谢谢", "什么是", "hi", "thanks", "define" |
| 2 | codeGeneration | 0.08 | ↑ | "implement", "写代码", "function", "class", "组件" |
| 3 | multiStep | 0.08 | ↑ | "首先…然后", "step 1", "workflow", "分步" |
| 4 | analyticalReasoning | 0.07 | ↑ | "分析", "比较", "权衡", "trade-offs", "implications" |

### 结构类（正则/计数）

| # | 维度 | 权重 | 方向 | 计算方式 |
|---|------|------|------|---------|
| 5 | tokenCount | 0.06 | ↑ | `text.length / 4` 估算 token 数；<50 → -0.5, >500 → 0.5 |
| 6 | constraintDensity | 0.04 | ↑ | "至少", "不超过", "必须", "exactly N" 等约束词密度 |

### 上下文类

| # | 维度 | 权重 | 方向 | 计算方式 |
|---|------|------|------|---------|
| 7 | toolCount | 0.05 | ↑ | 本轮可用工具数量；0→0, ≤5→0.3, >10→0.9 |
| 8 | conversationDepth | 0.04 | ↑ | 对话轮次；≤2→0, ≤10→0.3, >20→0.7 |

> 总权重 0.52（故意不到 1.0，让分数落在 [-0.5, +0.5] 区间）

### 中文关键词支持

Neo 用户经常中文对话，关键词表需要双语覆盖：

```
simpleIndicators: ["你好", "谢谢", "好的", "嗯", "是的", "hi", "thanks", ...]
codeGeneration: ["写代码", "实现", "函数", "组件", "接口", "implement", "function", ...]
multiStep: ["第一步", "然后", "接着", "最后", "workflow", "step 1", ...]
analyticalReasoning: ["分析", "对比", "权衡", "利弊", "compare", "trade-offs", ...]
```

### 为什么是 8 维而不是 23 维？

- **domainSpecificity / trading / socialMedia 等**：Neo 是个人 Agent，不需要按领域路由到专用模型
- **creative / outputFormat / repetitionRequests**：模型池太小（3-4 个），细分没有实际区分度
- **codeToProse / nestedListDepth**：ROI 太低，token 长度 + 代码关键词已经覆盖
- **零权重的 specificity 维度**（webBrowsing 等）：Manifest 用来做 speciality routing，我们不需要
- **不用 ML 路由**（参考 RouteLLM 的 MF/BERT 方案）：需要偏好标注数据 + 训练，对个人项目 overkill

---

## 四、评分算法

```
score = Σ(dimension_raw_score × weight × direction)
```

### 短消息快速路径

```
if (lastMessage.length < 40 && 无复杂关键词) → 直接返回 simple
```

> 借鉴 Manifest：短消息先做 Trie 扫描，只有命中复杂关键词才走完整评分流程。

### 分层边界

| 层级 | 分数区间 | 映射模型（优先级降序） |
|------|---------|---------------------|
| simple | score < -0.05 | Gemma (本地) → Flash → ACP |
| standard | -0.05 ≤ score < 0.15 | ACP → Flash → DeepSeek |
| complex | score ≥ 0.15 | DeepSeek Reasoner → Pro → DeepSeek Chat |

> 工具调用存在时，层级下限提升到 standard（与 Manifest 一致）。
> 总 token > 50k 时，层级下限提升到 complex（长上下文需要更强模型）。

### Momentum（惯性）

借鉴 Manifest：短消息（<100 字符）且最近 5 轮归属同层级时，沿用前序层级，避免频繁跳变。
权重随消息长度线性衰减：长消息 → momentum = 0。

### 置信度

```
confidence = 1 / (1 + exp(-k × minDistanceToBoundary))
```

低置信度时回退到 standard（安全默认）。这与 RouteLLM 的阈值校准思路异曲同工——不确定时选稳妥的。

---

## 五、路由配置（Config-driven）

借鉴 Portkey 的 config 理念，路由规则写在配置里：

```ts
// src/llm/routing-config.ts
export const ROUTING_CONFIG = {
    tiers: {
        simple:   ['gemma', 'flash', 'gemini-acp'],
        standard: ['gemini-acp', 'flash', 'deepseek'],
        complex:  ['deepseek-reasoner', 'pro', 'deepseek'],
    },
    boundaries: {
        simpleMax: -0.05,
        standardMax: 0.15,
    },
    overrides: {
        toolFloor: 'standard',      // 有工具时最低 tier
        largeContextFloor: 'complex', // >50k tokens 时最低 tier
        largeContextThreshold: 50_000,
    },
    fallback: {
        maxRetries: 1,
        retryableErrors: [429, 503, 'ETIMEDOUT', 'ECONNRESET'],
    },
    momentum: {
        historySize: 5,
        maxWeight: 0.3,
        messageThreshold: 100,  // 超过此长度 momentum=0
    },
};
```

好处：
- 新增/移除模型只改配置
- 不同用户可以有不同配置（未来多租户）
- 借鉴 NVIDIA Router 的 intent→model 映射模式

---

## 六、Token / Cost 追踪

利用 AI SDK `generateText` / `streamText` 返回的 `usage` 字段：

```ts
interface UsageRecord {
    timestamp: number;
    userId: string;
    model: string;            // 实际使用的模型 ID
    tier: Tier;               // 评分结果
    score: number;            // 原始分数
    confidence: number;       // 置信度
    reason: string;           // 路由原因（scored / short_message / tool_detected等）
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;    // 按模型单价计算
    durationMs: number;
    fallbackUsed: boolean;    // 是否触发了 fallback
    originalModel?: string;   // fallback 前的原选模型
}
```

### 存储

追加写入 `data/usage.jsonl`（与现有 logs 目录风格一致），每行一条 JSON。

### 模型单价表

参考 LiteLLM 的 `model_prices_and_context_window.json`，但我们模型少，自行维护：

```ts
const COST_PER_1K: Record<string, { input: number; output: number }> = {
    'gemini-3-flash-preview': { input: 0.0, output: 0.0 },     // 免费
    'acp/gemini':             { input: 0.0, output: 0.0 },     // OAuth 配额
    'deepseek-chat':          { input: 0.00014, output: 0.00028 },
    'deepseek-reasoner':      { input: 0.00055, output: 0.0022 },
    'ollama/gemma4:e4b':      { input: 0.0, output: 0.0 },     // 本地
};
```

### 预算控制

在 `config.ts` 新增 `DAILY_COST_LIMIT`，达到阈值时自动降级到免费模型。
参考 Manifest 的预算功能，但简化为单一每日限额。

### 仪表盘（P2）

在 Web UI 增加 cost dashboard，展示：
- 今日/本周/本月总花费
- 各模型调用占比
- 各 tier 路由分布
- 节省金额估算（与全部走 complex 对比）

---

## 七、自动 Fallback 重试

借鉴 LiteLLM 的 Router retry/fallback 和 Portkey 的可靠性路由：

```
primary model 失败
  → 分类错误类型
  → 可重试 → 选 fallback 链中下一个模型，指数退避重试
  → 不可重试 → 直接报错给用户
```

### 降级链

每个 tier 配置有序的模型列表（见第五节路由配置），失败时自动尝试下一个。

| 失败模型 | Fallback 1 | Fallback 2 |
|---------|-----------|-----------|
| ACP | Flash | DeepSeek |
| DeepSeek Reasoner | DeepSeek Chat | Flash |
| DeepSeek Chat | Flash | Gemma |
| Flash | DeepSeek | Gemma |
| Gemma | — | 返回错误 |

### 错误分类

借鉴 Portkey 的错误处理策略：

- **可重试（切换模型）**：429 限流、503 服务不可用、网络超时、ECONNRESET
- **可重试（同模型）**：500 服务器内部错误 → 等 1s 重试 1 次
- **不可重试**：400 参数错误、401 认证失败、403 无权限 → 直接报错

### 超时控制

参考 Portkey 的 Request Timeout 设计：
- streaming 请求：首个 chunk 超时 30s
- non-streaming 请求：总超时 60s
- 超时后自动触发 fallback

---

## 八、涉及文件

| 文件 | 改动 |
|------|------|
| `src/llm/scorer.ts` | **新增** — 8 维评分器 + Trie + 分层逻辑 |
| `src/llm/scorer-keywords.ts` | **新增** — 中英文关键词表（从 scorer 分离方便维护） |
| `src/llm/routing-config.ts` | **新增** — 路由配置（tier→model 映射、边界、fallback 参数） |
| `src/llm/model-router.ts` | 改造 — 调用 scorer，替换硬编码 if/else |
| `src/llm/client.ts` | 增加 fallback 重试 + usage 记录 |
| `src/llm/cost.ts` | **新增** — 单价表 + cost 计算 + 预算检查 |
| `src/config.ts` | 新增 `DAILY_COST_LIMIT` 配置项 |

---

## 九、验证计划

1. **单测**：构造典型请求（问候 / 代码任务 / 长上下文推理），验证评分和分层正确
2. **基准测试**：用 100 条历史对话消息跑一遍 scorer，人工审核分层合理性
3. **阈值校准**（借鉴 RouteLLM）：跑完基准后，调整 `boundaries` 使得各 tier 分布合理（如 simple 30% / standard 50% / complex 20%）
4. **A/B 对比**：上线后记录新旧路由的 cost，一周后对比节省比例
5. **Fallback 测试**：Mock 模型故障，验证降级链和错误分类是否正确

---

## 十、实施路线

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P0-a** | scorer.ts + scorer-keywords.ts（评分核心） | 无 |
| **P0-b** | routing-config.ts + 改造 model-router.ts | P0-a |
| **P0-c** | cost.ts + usage tracker（写 jsonl） | 无，可与 P0-a 并行 |
| **P1-a** | client.ts fallback 重试 + 超时控制 | P0-b |
| **P1-b** | 阈值校准 + 基准测试 | P0-a |
| **P2-a** | Web UI cost dashboard | P0-c |
| **P2-b** | Semantic Cache（相同问题缓存） | 需评估 ROI |

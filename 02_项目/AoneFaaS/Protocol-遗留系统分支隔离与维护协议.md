---
type: article
status: active
tags:
  - engineering
  - git
  - devops
  - protocol
created: 2026-01-29
---

# 遗留系统分支隔离与维护协议 (Legacy System Isolation Protocol)

> **版本**: v1.0
> **生效日期**: 2026-01-29
> **适用范围**: 遗留大库 (Legacy Monorepo) / 维护模式项目

---

## 1. 背景与决策 (Context)

鉴于项目依赖关系错综复杂（Dependency Hell），且各业务模块线上运行版本（Git Hash）已不一致，为降低重构风险，决定放弃统一的主干开发模式。

**战略调整**：采用 **"App-Specific Permanent Branches" (应用级永久分支)** 策略。
**核心原则**：**物理隔离，平行演进，严禁合并**。

---

## 2. 分支命名规范 (Naming Convention)

为了与常规开发分支区分，所有隔离分支必须使用 `ops/` 前缀。

| 分支类型 | 命名格式 | 示例 | 说明 |
| :--- | :--- | :--- | :--- |
| **基准主干** | `master` / `main` | `master` | 仅作为历史归档，**不再进行直接发布**。 |
| **应用分支** | `ops/<app-name>` | `ops/payment-service`<br>`ops/user-center` | **生产环境的实际代码源**。每个分支对应一套独立的依赖树。 |
| **特性补丁** | `feat/<feature-name>` | `feat/traffic-proxy` | 用于开发通用功能（如本次的 Proxy），仅用于 Cherry-pick。 |

---

## 3. 操作流程 (Workflow)

### 3.1 初始化拆分 (Initialization)
1.  基于当前 `master` (或线上最稳定的 commit) 拉出各应用分支。
2.  **立即**在各 `ops/` 分支中修改 `pom.xml` / `build.gradle`：
    *   删除该应用**不需要**的模块依赖（减肥）。
    *   **锁定**该应用所需的特定依赖版本（即使不同应用版本冲突也没关系，因为它们现在处于平行宇宙）。
    *   **禁止**出现 `-SNAPSHOT` 依赖。

### 3.2 通用功能注入 (The Proxy Feature)
针对本次需要增加的“流量 Proxy”功能：

1.  在 `master` 或独立的 `feat/traffic-proxy` 分支上完成开发与测试。
2.  **不要使用 Merge**。
3.  使用 `Cherry-pick` 将代码“摘”到各个 `ops/` 分支：

```bash
# 切换到支付应用分支
git checkout ops/payment-service

# 摘取 Proxy 功能的 Commit
git cherry-pick <commit-hash-of-proxy-feature>

# 如果遇到冲突：
# 既然是遗留代码，以当前分支(ops/payment)的现有逻辑为准，小心合入 Proxy 逻辑。
```

### 3.3 CI/CD 管道映射
需修改 Jenkins/GitLab CI 配置，将分支与部署环境 1:1 绑定：

*   `ops/payment-service` --> 触发构建 --> 发布到 **Payment Cluster**
*   `ops/user-center`     --> 触发构建 --> 发布到 **User Cluster**

---

## 4. 铁律 (The Iron Rules) 🛑

1.  **NO MERGE (永不合并)**
    *   绝对禁止执行 `git merge ops/app-a ops/app-b`。
    *   绝对禁止执行 `git merge ops/app-a master`。
    *   一旦分叉，它们就是两个独立的项目，老死不相往来。

2.  **Cherry-Pick Only (仅通过摘取同步)**
    *   如果发现了一个严重的公共 Bug，在 `master` 上修复它。
    *   然后通过 `git cherry-pick` 单独同步到需要修复的 `ops/` 分支。

3.  **Localize Dependencies (依赖本地化)**
    *   如果私有 Maven 仓库极其不稳定，允许将关键 Jar 包下载到项目根目录的 `libs/` 文件夹，并修改构建脚本指向本地文件。
    *   *理由：此时此刻，可复现的构建 (Reproducible Build) 比优雅的配置更重要。*

---

## 5. 紧急回滚方案 (Emergency Plan)

由于各应用分支独立，回滚也必须独立进行：

1.  **定位**：找到该应用分支上一次发布的 Commit Hash。
2.  **回退**：`git reset --hard <last-stable-commit>` (仅限本地) 或 `git revert <bad-commit>`。
3.  **发布**：重新触发该分支的流水线。

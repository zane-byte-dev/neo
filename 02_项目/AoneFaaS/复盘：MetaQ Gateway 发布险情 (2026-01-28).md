# 复盘：MetaQ Gateway 发布险情

> **Uncle Torvalds 点评**: "No monitoring, no deploy. This is Engineering 101. You got lucky today, but luck is not a strategy."

## 1. 事件描述 (What Happened)
*   **操作**: 发布了线上 MetaQ Gateway 的新版本。
*   **现象**: 发布完成后，未进行任何有效的监控观察和业务验证。
*   **结果**: 差点引发线上故障（Near Miss）。全靠运气或后续被动发现才避免了灾难。

## 2. 根因分析 (The 5 Whys)
1.  **为什么没监控？**
    *   *表层*: 觉得是小改动，或者觉得旧监控还能用。
    *   *深层*: **傲慢 (Hubris)**。作为老手，对系统产生了虚假的掌控感，跳过了标准 SOP。
2.  **为什么没验证？**
    *   没有准备好自动化的 Smoke Test 脚本。手动验证太麻烦，于是偷懒了。
3.  **流程缺失**:
    *   CI/CD 流水线中没有强制卡点（Gating）。如果系统允许你在没过测试/没看监控的情况下发布，那系统本身就是共犯。

## 3. 改进措施 (Action Items)

### 3.1 流程红线 (Immediate)
*   **No Dashboard, No Go**: 在点击发布按钮前，必须在一个屏幕上打开 Grafana/Prometheus 监控大盘。
*   **Logs First**: 发布后第一件事不是庆祝，而是 `tail -f error.log`。

### 3.2 工程手段 (Long-term)
*   **自动化验证**: 编写一个简单的 `health_check.py` 或 `smoke_test.sh`。发布后自动跑一遍核心逻辑（生产 -> 消费一条测试消息），不通过直接报警。
*   **金丝雀发布 (Canary)**: Gateway 这种核心组件，严禁一把梭（All-in）。必须分批发布，先发一台观察 5 分钟。

## 4. 警世恒言
> **"Hope is not a monitoring strategy."**
> (希望不是一种监控策略。)

下次发布前，请先问自己：**“如果我现在发上去全挂了，我怎么在 1 分钟内知道？”** 如果你答不上来，就别发。

---
*记录人: Zhengchao & Uncle Torvalds*

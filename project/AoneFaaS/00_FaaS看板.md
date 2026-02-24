# 🏗️ FaaS Platform (Serverless Core)

> **定位**: 集团 Serverless 平台的流量心脏。承接 AliyunFC 历史流量，实现多网关入口的平替与升级。
> **状态**: 🟢 进行中

## 1. 🗺️ 导航
*   📐 [[架构设计：FaaS 平台 VPC 隔离部署方案 (Private Cloud Edition).md]]
*   📜 [[Protocol-遗留系统分支隔离与维护协议.md]]
*   🔥 [[复盘：MetaQ Gateway 发布险情 (2026-01-28).md]]
*   💻 [[代码实现：ApiServer-Consoler 核心逻辑伪代码.md]]

## 2. 🎯 当前战役
> **Goal**: 2月完成 MTOP Gateway 的安全隔离与 Proxy 能力。

*   [ ] 🚪 MTOP Gateway 支持 Proxy 能力。
*   [x] 🛡️ 落地 VPC 隔离部署方案，确保 `x-fc-override-host` 链路在生产环境稳定。
*   [ ] 🧠 启动 **"FaaS Turbo for LLM"** 专项 (通义千问稳定性治理)。
    *   [x] 为核心 AI 业务部署物理隔离的网关集群。
    *   [ ] 建立 AI 接入白名单、压测标准与容量规划协议 (复盘推进中)。
    *   [ ] 沉淀《面向大模型高并发场景的 FaaS 网关高可用架构》标准。
*   [ ] 🔪 推进 fc-framework 大库的物理拆分。

## 3. 📝 待办池
*   [ ] 📜 沉淀《高并发大流量接入风险准入规范》，明确业务方压测与容量责任。
*   [ ] 🐛 完善 `fiberData` 请求级报错缓存机制。

## 4. 📈 决策与里程碑
*   **2026-02-08**: 完成千问独立集群部署与 6 域名分片，彻底解决 Redis 热点 Key 引发的 RT 超时。
*   **2026-01-29**: 完成 VPC 隔离方案设计。

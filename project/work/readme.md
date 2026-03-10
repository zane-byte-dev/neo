# 🏗️ Aone FaaS Platform

> **Positioning**: The "Traffic Heart" of the group's Serverless platform. Inheriting AliyunFC historical traffic, achieving replacement and upgrade for multiple gateway entrances.

## 🚀 This Week's Tasks (Limit to 2)

### 1. MTOP Gateway Proxy Support
*   **Status**: Expected to complete production release today.

### 2. metaq-poller-go to Pre-release
*   **Status**: Canary release completed; Production release scheduled for Next Week.

---

## 📝 Project Tracking

### Active Initiatives
*   [ ] 🛡️ **VPC Isolation Deployment Strategy**
    *   [x] Ensure `x-fc-override-host` path is stable in production.
    *   [x] Implement `afc-vpc-gateway` for production-to-VPC access.
    *   [ ] Implement `alifaas-api-server-console` Redis write support to unblock the release pipeline (Scheduled for Next Week).
*   [ ] 🧠 **Start "FaaS Turbo for LLM" Initiative** (Tongyi Qianwen stability governance).
    *   [x] Deploy physically isolated gateway clusters for core AI businesses.
    *   [ ] Establish the "High-Availability Architecture for FaaS Gateways in High-Concurrency LLM Scenarios" standard.
*   [ ] ⚡ **API Server Redis Optimization**
    *   [ ] `alifaas-api-server`: Modify cache logic to decouple user requests from Redis requests (Progress: 80%).

### 🗑️ Swamp Area (Backlog)
> Tasks here are salvaged only when "boss is screaming for them" or "weekly limit tasks are cleared and you're bored to death."
> Strictly forbid deep-diving or starting early here.

*   [ ] **Other Optimizations**:
    *   [ ] `alifaas-api-server`: Add monitoring/alerts for expansion success rate; current alerts based on request count are unreasonable.
    *   [ ] `alifaas-api-server`: Research second-level rate limiting solutions; consider migrating all cases to this.

---

## 📜 Change Log

### 2026-03-10
*   **FC-MTOP Gateway**: Expected to complete production release today.
*   **API Server**: Started optimizing Redis cache logic to decouple user requests; current progress 80%.

### 2026-03-06
*   **FC-MTOP Gateway**: Full scale rollout completed; Entering 2-day **Network Freeze** [封网].
*   **VPC**: `afc-vpc-gateway` implementation completed and verified.
*   **Infrastructure**: Scheduled `alifaas-api-server-console` for next week.

### 2026-03-04
*   **FC-MTOP Gateway**: Gradual scale rollout.
*   **Stability**: Optimized `alifaas-api-server` to decouple user requests from DB.
*   **VPC**: Traffic flow path successfully established.
*   **Performance Review**: Automated AI generation based on Git commits and OKRs.
*   **Reporting**: Established the AI workflow for summarizing weekly reports via DingTalk documents.

### 2026-02-02
*   **Strategy**: Abandoned MetaQ debugging; decided on a Go rewrite.

### 2026-02-07
*   **Incident**: Tongyi Qianwen integration caused cascading failures (Redis counter overload, Hot Keys).
*   **Action**: Deployed "Traffic Passthrough" version.

### 2026-02-08
*   **Architecture**: Completed isolated environment deployment for core AI business; split 6 independent domains to solve RT timeouts caused by Redis Hot Keys.

### 2026-02-10
*   **FaaS Review**: Executed "Consultant Mode" during the post-mortem to clearly define technical boundaries.

### 2026-02-25
*   **Task Management**: Established the `tasks.md` Swamp Area; limited focus to the "2 Life-Saving Tasks."

### 2026-02-27
*   **Focus**: Committed 100% work time to primary job; treated challenges as "Sharpening Stones" [磨刀石] for personal methodology.

### 2026-01-28
*   **Risk**: MetaQ Gateway release lacked monitoring, leading to a near-outage. Audited the risk of "Old-Timer" [老兵] overconfidence.

### 2026-01-29
*   **VPC**: Completed VPC isolation design.
*   **Protocol**: Released the "Legacy System Branch Isolation & Maintenance Protocol" to lock down legacy complexity.

### 2026-01-30
*   **VPC**: Implemented `x-fc-override-host` capability; isolation link entering testing phase.

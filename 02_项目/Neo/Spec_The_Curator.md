---
type: spec
project: NeoAgent
feature: The Curator
status: draft
target_agent: Antigravity / Gemini 3
---

# 🏗️ Specification: NeoAgent "The Curator" Agent

> **Goal**: Implement an AI-First "Serendipity Engine" that autonomously explores the local Obsidian vault and pushes relevant insights to the user via Telegram.

## 1. System Architecture

The Curator is a sub-agent within the NeoAgent Node.js service. It operates on an **Agentic Loop** (Perceive -> Plan -> Act -> Reflect).

### 1.1 Trigger Points
*   **Manual**: User sends `/pulse` command in Telegram.
*   **Scheduled** (Future): Morning (08:30), Afternoon (14:00), Evening (22:30).

### 1.2 Input Context
The Agent must ingest the following context before planning:
1.  **Time**: Current system time (Day of week, Hour).
2.  **User State**: Read `99_系统/System_Context_Current.md` to understand current mood/focus.
3.  **Recent History**: Last 5 messages from Telegram chat.

## 2. The Agentic Workflow (The Loop)

### Step 1: Perception & Strategy
Based on the context, choose a **Search Strategy**:

| Context | Strategy | Target Directory |
| :--- | :--- | :--- |
| **Morning / High Energy** | **The Principle** | `99_系统/`, `02_项目/个人成长` |
| **Evening / Reflection** | **The Time Machine** | `01_日记/` (Same day in previous years) |
| **Stuck / Low Energy** | **The Spark** | `02_项目/` (Random inactive projects) |
| **Specific Topic (e.g., FaaS)** | **The Resonance** | Global Search (Vector/Keyword) |

### Step 2: Exploration (Tool Use)
The Agent uses tools to find candidate files.
*   *Tool*: `listDir(path, recursive)` - Scan directories.
*   *Tool*: `readFile(path)` - Read content (Head + Body).
*   *Tool*: `searchFiles(query)` - Keyword/Regex search.

*Constraint*: Must ignore `00_收集` (Inbox), `node_modules`, `.trash`.

### Step 3: Selection & Synthesis
*   **Read**: Select 2-3 candidate files and read their content.
*   **Evaluate**: Does this note offer value *right now*? (Skip simple meeting logs or empty notes).
*   **Insight**: Generate a short commentary connecting the old note to the user's *current context*.

### Step 4: Output Generation
Generate a Telegram message with the following structure:

```text
🕰️ **The Curator's Pick**

📜 **Source**: [[Title of the Note]] (202X-XX-XX)

> "Quote the most insightful sentence from the note..."

💡 **Insight**: 
Here is why I brought this to you today. You mentioned [Current Topic], and this note reminds us that [Connection/Wisdom].
```

## 3. Technical Implementation (Node.js)

### 3.1 Interface
```typescript
interface CuratorInput {
  userId: string;
  userContext: string; // Content of System_Context_Current.md
}

async function runCuratorAgent(input: CuratorInput): Promise<string> {
  // Implementation of the Agent Loop
}
```

### 3.2 Required Tools (Function Calling)
The LLM must have access to:
1.  `fs_list`: List files in a directory (with ignore patterns).
2.  `fs_read`: Read file content (limit to first 2KB to save tokens).
3.  `fs_search`: Simple grep/glob search.

### 3.3 Persona (System Prompt)
> "You are The Curator, a digital archaeologist for Zhengchao's second brain. Your job is not to retrieve data, but to surface *meaning*. You value serendipity. You speak in a wise, slightly poetic, but concise tone (Chinese). Always connect the past to the present."

## 4. Acceptance Criteria
1.  **No Hallucinations**: The "Source" link must be a real file path.
2.  **Relevance**: The "Insight" must reference the user's current context (e.g., "35岁觉醒", "FaaS").
3.  **Latency**: The whole loop should complete within 60 seconds.

---
*End of Spec*

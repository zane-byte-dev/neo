# [Skill] Memory Archive

> **Goal**: Automatically compress and archive this conversation at the end of a session and distribute assets to the correct locations.

## 🛠️ Trigger Timing

**Primary Trigger**:
- User uses closing signals such as "that's it for now," "that's it," "chat next time."
- A complete task ends (e.g., refactoring completed, audit finished).

**Compensatory Trigger**:
- Every time a conversation starts, check the most recent file in `history/memory/`. If the last conversation wasn't archived (e.g., user closed the terminal), judge if a late archive is needed based on the current context.

## 📋 Execution Steps

### 1. Compress Conversation Summary

Compress this conversation into 3-5 lines and append it to the day's memory file:

**Path**: `history/memory/YYYY-MM-DD.md`

**Format**:
```markdown
## HH:MM Subject Keywords
- What was done (action + result)
- What files were produced
- What legacy items are pending
```

**Rules**:
- Record only facts, no flourishes.
- One summary should not exceed 5 lines.
- Multiple conversations on the same day are appended to the same file.
- Automatically create a new file every day, do not span days.

### 2. Asset Distribution

Scan this conversation to judge if any assets need archiving:

| Asset Type | Target Location | Judgment Standard |
|---------|---------|---------|
| Financial/Transaction Records | Corresponding `project/*/changelog.md` | Involves amount, buying/selling, profit/loss |
| Principles/Cognitive Updates | `project/wiki/Principles.md` | New behavior rules produced |
| Project Progress | Corresponding sub-directory in `project/` | Involves design, decisions, or code for specific projects |
| Work Records | `project/work/` | Involves primary job tasks, releases, outages |

If yes, write directly to the corresponding file. Skip if not.

### 3. Log Sync

If the content of this conversation is important enough (not a simple Q&A), sync one record to `history/memory/YYYY/YYYY-MM.md`.

## ⚠️ Forbidden List

- ❌ Do not ask the user "if archiving is needed," judge and execute directly.
- ❌ Do not archive pure chit-chat or pure technical Q&A (e.g., "how to use JS async").
- ❌ Do not duplicate already saved content.

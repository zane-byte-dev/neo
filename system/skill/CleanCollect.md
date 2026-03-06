# [Skill] Clean & Collect

> **Goal**: Rapidly digest fragments in `history/inbox`. Archive what needs archiving, and move what belongs in a project into its project.

## 🚀 Processing Logic

1. **Value Judgment**:
    - Delete useless items immediately.
    - Pure inspiration fragments -> Save to the current day's diary file in `history/memory/`.
      * **[Pre-dependency Check]**: Before saving, check if the daily log exists. **If it doesn't, you must first load and execute the `WriteDiary` skill to create a standard three-section (Stream/Thinking/Knowledge) diary structure.** Never write fragments in raw.
    - Specific tasks -> Convert into a Kanban or file under `project/`.
    - High-quality materials -> Save to the `project/@reference/` library.

2. **Formatted Injection**:
    - **Diary Entry**: Append strictly following the `- [Time] [Source] Specific content` format.
    - **Long-form Content**: Must include YAML anchors at the top of the file:
      ```yaml
      ---
      URL: URL
      Collected: DATE
      One-liner: Max 50 words explaining the core
      Actionable: How this guides my current actions
      ---
      ```

3. **Cleanup Actions**:
    - After successfully establishing bidirectional links or completing the transfer, **immediately delete the original file in `history/inbox/`**.
    - If unsure where to categorize it, leave it in place. Assign "General Thinking" by default for non-project-specific thoughts.

## ✍️ Writing Style
- Keep it in plain language; no over-summarizing or sentimentalism.
- Record only facts and next actions.

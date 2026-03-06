# [Skill] Style Evolution

> **Goal**: Analyze the traces of my manual changes according to `git diff`, reverse-extract red lines, and directly update them in the original Skill files.

## Execution Logic

1. **Scan Diff**:
    Compare the AI draft with the content I modified.
    - See which filler words and polite phrases I deleted.
    - See which corporate buzzwords [黑话] were replaced with action descriptions.
    - See how I broke down long articles into a mix of long and short sentences.

2. **Extract Red Lines**:
    Extract a general rule from the differences identified above. Do not just capture specific words; capture the sense of language.
    For example, refine "forbid saying 'deeply root'" to "forbid using corporate buzzwords, directly write how many years I've worked."

3. **Update Configuration**:
    Format the extracted general rules as prohibitions and write them directly into the `Style Audit` section of the corresponding Skill file.

## Machine Execution Instructions

Upon receiving the "Execute Evolution" instruction, run following:
1. Compare the original draft with my modified code.
2. Filter out factual modifications; only analyze differences in layout, sentence structure, and word choice.
3. Provide a Markdown patch block containing the new red lines.
4. After receiving authorization, directly call the tool to overwrite the old Skill file.

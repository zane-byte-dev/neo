---
name: article-draft
description: Draft an editable, sourced Markdown article from a topic and workspace knowledge. Use when the user asks to write, rewrite, expand, or structure an article, essay, post, explainer, opinion piece, or publishable long-form draft.
---

# Article Draft

Turn source material into a coherent draft while preserving the user's intended voice.

## Workflow

1. Infer the audience, angle, tone, and target length from the request. Ask only when a missing choice would materially change the article.
2. Call `knowledge_search` for the topic, argument, and named entities. Read the strongest sources with `knowledge_get`.
3. Choose one clear thesis and outline. Do not assemble unrelated source summaries.
4. Write Markdown with a strong opening, logically ordered sections, transitions, and a specific conclusion. Distinguish sourced facts from the author's interpretation.
   Start directly with a `#` heading and omit YAML frontmatter because `artifact_save` adds it.
5. Use the search result `【N】` labels for factual claims. Remove unsupported claims instead of fabricating citations.
6. Call `artifact_save` once with title, final Markdown, and exact source provenance.
7. Return the artifact path and at most one sentence describing the chosen angle.

## Editing rules

- Preserve supplied wording that carries personal voice unless the user requests a new style.
- Avoid generic introductions, repetitive summaries, and fake quotations.
- If evidence is insufficient, narrow the claim and say so in the draft.
- The saved artifact is the canonical draft; do not create a second file with built-in write tools.
- Do not narrate intermediate work in chat.

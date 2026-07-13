---
name: news-brief
description: Create a concise, sourced intelligence or news brief from workspace material. Use for daily or weekly digests, topic updates, trend summaries, signal reports, what-changed briefs, and prioritized reading lists.
---

# News Brief

Summarize what matters, not every available item.

## Workflow

1. Identify the topic, time window, audience, and decision the brief should support.
2. Search workspace knowledge using the topic plus time, product, company, or person names. Read high-impact results with `knowledge_get`.
3. Rank findings by novelty, impact, confidence, and relevance. Merge repeated reports of the same development.
4. Write Markdown with:
   - an `As of` line based only on source metadata;
   - three to seven prioritized developments;
   - why each matters;
   - uncertainties or missing confirmation;
   - recommended follow-ups or watch items.
   Start directly with a `#` heading and omit YAML frontmatter because `artifact_save` adds it.
5. Cite each factual development with returned `【N】` labels. Do not describe old workspace material as current news without an explicit date caveat.
6. Save the final brief with `artifact_save`, including exact source provenance.
7. Return only the saved path and the number of developments included.

## Quality rules

- Keep signal separate from commentary.
- Prefer dates and concrete changes over vague trend language.
- Do not invent freshness, consensus, or causality.
- Do not write the final artifact through shell or generic file tools.
- Do not narrate intermediate work in chat.

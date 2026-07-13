---
name: notebook-report
description: Generate a durable, cited Markdown report from Neo Notebook or workspace sources. Use when the user asks for a report, briefing, study guide, FAQ, timeline, comparison, or synthesis grounded in selected Notebook material.
---

# Notebook Report

Produce one evidence-grounded artifact through ATM.

## Workflow

1. Extract the topic, requested report subtype, audience, and selected source IDs from the user and Neo Notebook context.
2. Call `knowledge_search` with the topic and important named entities. Search again with narrower terms when the first results do not cover the requested dimensions.
3. Call `knowledge_get` for the most relevant documents before drawing conclusions. Do not rely only on snippets for claims that require surrounding context.
4. Draft Markdown with a descriptive title, executive summary, evidence sections, risks or disagreements, and concrete next steps. Adapt headings to the requested subtype instead of forcing a fixed template.
   Start directly with a `#` heading. Do not include YAML frontmatter; `artifact_save` adds canonical metadata.
5. Cite factual claims with the `【N】` labels returned by the relevant search call. Never invent labels, paths, dates, or source content.
6. Call `artifact_save` exactly once with the final Markdown and every source actually used, including document ID, relative path, and line range.
7. Return exactly one short completion sentence followed by the saved artifact path. Do not repeat the report summary in chat.

## Quality rules

- Separate source facts from inference and recommendations.
- State when the sources are incomplete, stale, or contradictory.
- Prefer a concise useful report over padded prose.
- Do not use `write`, `edit`, or shell redirection for the final artifact.
- Do not narrate tool use or drafting progress in chat. Stay silent until the completion sentence.

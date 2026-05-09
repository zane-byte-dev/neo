---
name: xifeng-article-cleanup
description: "Use when: cleaning pasted 西风/Xifeng article copy in AI chat, including removing noisy blank lines, author recommendations, historical articles, related reading, and comments before saving or summarizing. Trigger words: 西风文章, 西风复制, 粘贴文章清理, 作者推荐, 历史文章, 评论清理."
argument-hint: "Paste the raw Xifeng article text, or point to a local markdown file."
---

# Xifeng Article Cleanup

## When to Use

Use this skill when the user pastes or references raw copied text from 西风/Xifeng articles and wants it cleaned before saving, summarizing, indexing, or discussing in chat.

Typical symptoms:
- Many repeated blank lines from copy/paste.
- A useful article body followed by author recommendations, historical articles, related reading, or comments.
- WeChat-style footer noise such as `作者推荐`, `历史文章`, `推荐阅读`, `精选留言`, `评论`, `写留言`, `阅读原文`, `喜欢此内容的人还喜欢`.

## Procedure

1. Treat the user's pasted text as the source of truth. Do not invent or rewrite article content.
2. Preserve the title, date, headings, paragraphs, lists, quotes, and code fences if present.
3. Normalize line endings and collapse repeated blank lines to a single blank line between paragraphs.
4. Remove footer sections starting at a clear marker, but only after substantial body text has appeared.
5. Remove author-recommendation/history/comment sections entirely, including their following items.
6. Return the cleaned Markdown by default. If the user asks to save, write the cleaned content to the target file or notebook through the existing workflow they requested.

## Deterministic Helper

For local text or files, use the helper script:

```bash
node .github/skills/xifeng-article-cleanup/scripts/clean-xifeng-article.mjs < raw.txt > cleaned.md
node .github/skills/xifeng-article-cleanup/scripts/clean-xifeng-article.mjs path/to/article.md > cleaned.md
```

The script is conservative: it compresses whitespace and removes obvious footer/comment blocks, but it avoids cutting early `评论` or `推荐` words inside the body unless they look like standalone section markers.

## Output Checklist

- The cleaned text has no long runs of empty lines.
- The article body is preserved in original wording.
- Obvious trailing recommendation/history/comment material is gone.
- If uncertain about a cut point, mention the marker used and ask before overwriting anything.

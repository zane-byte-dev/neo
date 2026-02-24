#!/usr/bin/env python3
"""
清理日记文件，去除旧格式的噪音，保留核心内容。

处理规则：
1. 去掉 YAML frontmatter（--- 到 ---）
2. 去掉 > **Today is...** 提示行
3. 精简 section 标题（去掉括号里的英文副标题）
4. 去掉各 section 内的 blockquote 提示行
5. 去掉 🥗 状态与复盘 整个 section
6. 去掉 🤖 AI Auditor 整个 section
7. 去掉 知识增量 section 内的子标题 (📥 新入库 / 📚 沉淀为文章)
8. 收尾多余空行（不超过一个空行）
"""

import re
import sys
from pathlib import Path

DIARY_DIR = Path("/Users/zhengchao/mox/neo/history")

# Sections to completely remove (matched by heading line)
REMOVE_SECTIONS = [
    "🥗 状态与复盘",
    "🤖 AI Auditor",
]

# Section heading renames
SECTION_RENAMES = {
    "## 🟢 闪念与流水 (Stream)": "## 🟢 流水",
    "## 🧠 深度思考 (Deep Dive)": "## 🧠 深度思考",
    "## 🍎 知识增量 (Knowledge Assets)": "## 🍎 知识增量",
}

# Blockquote lines to drop (regex patterns)
DROP_BLOCKQUOTE_PATTERNS = [
    r"^> \*\*Today is .+\*\*",
    r"^> \*\*Rule\*\*:",
    r"^> 快速记录",
    r"^> 自动追踪今日",
    r"^> 留白给",
    r"^> \*今日核心命题：\.\.\.\*$",  # empty placeholder only
]

# Sub-headings inside 知识增量 to remove
DROP_SUBHEADINGS = [
    "### 📥 新入库 (Inbox Processed)",
    "### 📚 沉淀为文章 (Library)",
]


def remove_frontmatter(lines: list[str]) -> list[str]:
    """Remove YAML frontmatter block at the start."""
    if not lines or lines[0].strip() != "---":
        return lines
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[i + 1:]
    return lines


def clean_lines(lines: list[str]) -> list[str]:
    result = []
    skip_section = False

    for line in lines:
        stripped = line.strip()

        # Detect start of a section to remove
        if stripped.startswith("## ") or stripped.startswith("# "):
            in_remove = any(tag in stripped for tag in REMOVE_SECTIONS)
            if in_remove:
                skip_section = True
                continue
            else:
                skip_section = False

        if skip_section:
            continue

        # Rename section headings
        if stripped in SECTION_RENAMES:
            result.append(SECTION_RENAMES[stripped] + "\n")
            continue

        # Drop sub-headings inside 知识增量
        if stripped in DROP_SUBHEADINGS:
            continue

        # Drop specific blockquote hints
        if any(re.match(p, stripped) for p in DROP_BLOCKQUOTE_PATTERNS):
            continue

        # Drop the horizontal rule before AI Auditor (trailing ---)
        # only if it's immediately followed by nothing meaningful; 
        # handled by collapsing multiple empty lines at the end.

        result.append(line)

    return result


def collapse_blank_lines(lines: list[str]) -> list[str]:
    """Ensure no more than one consecutive blank line."""
    result = []
    prev_blank = False
    for line in lines:
        if line.strip() == "":
            if not prev_blank:
                result.append(line)
            prev_blank = True
        else:
            result.append(line)
            prev_blank = False
    # Strip trailing blank lines
    while result and result[-1].strip() == "":
        result.pop()
    return result


def clean_file(path: Path, dry_run: bool = False) -> bool:
    """Clean a single diary file. Returns True if changed."""
    original = path.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)

    lines = remove_frontmatter(lines)
    lines = clean_lines(lines)
    lines = collapse_blank_lines(lines)

    # Ensure file ends with a newline
    cleaned = "".join(lines)
    if cleaned and not cleaned.endswith("\n"):
        cleaned += "\n"

    if cleaned == original:
        return False

    if not dry_run:
        path.write_text(cleaned, encoding="utf-8")

    return True


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("🔍 DRY RUN — no files will be modified\n")

    md_files = sorted(DIARY_DIR.rglob("*.md"))
    changed = 0
    skipped = 0

    for f in md_files:
        # Skip session transcripts (会话/) — those are in a different format
        if "会话" in str(f):
            print(f"  ⏭️  Skipped (会话): {f.relative_to(DIARY_DIR)}")
            skipped += 1
            continue

        was_changed = clean_file(f, dry_run=dry_run)
        if was_changed:
            action = "✅ Cleaned" if not dry_run else "🔍 Would clean"
            print(f"  {action}: {f.relative_to(DIARY_DIR)}")
            changed += 1
        else:
            print(f"  ✓  Already clean: {f.relative_to(DIARY_DIR)}")

    print(f"\n{'DRY RUN: ' if dry_run else ''}Done — {changed} files cleaned, {skipped} skipped.")


if __name__ == "__main__":
    main()

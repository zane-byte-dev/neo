#!/usr/bin/env python3
"""
notebook — 文件系统知识库 CRUD 操作
操作 {workDir}/notebooks/ 目录下的 Markdown 文件
stdin: JSON { args, context: { workDir } }
stdout: JSON { type: 'text'|'error', content: '...' }
"""
import json
import sys
import os
import re
from datetime import date as date_mod


# ── Frontmatter helpers ────────────────────────────────────────────────────

def parse_frontmatter(text: str):
    meta = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            block = text[4:end]
            body = text[end + 4:].lstrip()
            for line in block.split("\n"):
                colon = line.find(":")
                if colon == -1:
                    continue
                key = line[:colon].strip()
                val = line[colon + 1:].strip()
                if key in ("title", "author", "source", "summary"):
                    meta[key] = val.strip("\"'")
                elif key == "date":
                    meta["date"] = val
                elif key == "tags":
                    clean = val.strip("[]")
                    meta["tags"] = [t.strip().strip("\"'") for t in clean.split(",") if t.strip()]
    return meta, body


def serialize_frontmatter(meta: dict, body: str) -> str:
    lines = ["---"]
    if meta.get("title"):
        lines.append(f"title: {meta['title']}")
    if meta.get("date"):
        lines.append(f"date: {meta['date']}")
    if meta.get("author"):
        lines.append(f"author: {meta['author']}")
    if meta.get("source"):
        lines.append(f"source: {meta['source']}")
    if meta.get("summary"):
        lines.append(f"summary: {meta['summary']}")
    if meta.get("tags"):
        lines.append(f"tags: [{', '.join(meta['tags'])}]")
    lines.append("---\n")
    lines.append(body)
    return "\n".join(lines)


def title_from_filename(filename: str) -> str:
    name = re.sub(r"\.md$", "", filename)
    name = re.sub(r"^\d+_", "", name)
    return name.replace("_", " ").strip()


# ── File system helpers ────────────────────────────────────────────────────

def list_md_files_recursive(dir_path: str, rel_base: str = "") -> list:
    if not os.path.isdir(dir_path):
        return []
    results = []
    for entry in sorted(os.listdir(dir_path)):
        if entry == ".tmp" or entry.endswith(".tmp"):
            continue
        full = os.path.join(dir_path, entry)
        rel = f"{rel_base}/{entry}" if rel_base else entry
        if os.path.isdir(full):
            results.extend(list_md_files_recursive(full, rel))
        elif entry.endswith(".md"):
            results.append(rel)
    return results


def parse_entry(nb_dir: str, rel_path: str, include_content: bool) -> dict:
    file_path = os.path.join(nb_dir, rel_path)
    with open(file_path, "r", encoding="utf-8") as f:
        raw = f.read()
    meta, body = parse_frontmatter(raw)
    parts = rel_path.split("/")
    filename = parts[-1]
    notebook = parts[0] if len(parts) > 1 else "."
    title = meta.get("title") or title_from_filename(filename)
    tags = json.dumps(meta["tags"]) if meta.get("tags") else None
    entry = {
        "id": rel_path, "notebook": notebook, "filename": filename,
        "title": title, "author": meta.get("author"),
        "date": meta.get("date"), "source": meta.get("source"),
        "summary": meta.get("summary"), "tags": tags,
    }
    if include_content:
        entry["content"] = body
    return entry


def format_tags(raw):
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return [raw]


def format_meta(r: dict) -> str:
    parts = []
    if r.get("date"):
        parts.append(f"📅 {r['date']}")
    if r.get("author"):
        parts.append(f"✍️ {r['author']}")
    if r.get("source"):
        parts.append(f"📌 {r['source']}")
    tags = format_tags(r.get("tags"))
    if tags:
        parts.append(f"🏷️ {', '.join(tags)}")
    return "  ".join(parts)


# ── Notebook operations ────────────────────────────────────────────────────

def nb_list_notebooks(nb_dir: str) -> list:
    if not os.path.isdir(nb_dir):
        return []
    return sorted([
        d for d in os.listdir(nb_dir)
        if os.path.isdir(os.path.join(nb_dir, d))
        and d != ".tmp" and not d.endswith(".tmp") and not d.startswith(".")
    ])


def nb_list(nb_dir: str, notebook=None, limit=300) -> list:
    if not os.path.isdir(nb_dir):
        return []
    base_dir = os.path.join(nb_dir, notebook) if notebook else nb_dir
    base_rel = notebook or ""
    rel_paths = list_md_files_recursive(base_dir, base_rel)
    limit = min(limit, 500)
    entries = []
    for rel_path in rel_paths:
        if len(entries) >= limit:
            break
        try:
            entries.append(parse_entry(nb_dir, rel_path, False))
        except Exception:
            continue
    return entries


def nb_search(nb_dir: str, query: str, notebook=None, limit=20) -> list:
    all_entries = nb_list(nb_dir, notebook=notebook, limit=500)
    q = query.lower()
    limit = min(limit, 100)
    results = []
    for entry in all_entries:
        in_title = q in entry["title"].lower()
        in_summary = q in (entry.get("summary") or "").lower()
        if in_title or in_summary:
            results.append(entry)
        else:
            try:
                full = parse_entry(nb_dir, entry["id"], True)
                body = (full.get("content") or "").lower()
                idx = body.find(q)
                if idx == -1:
                    continue
                snippet = "…" + (full["content"][max(0, idx - 60):idx + 120]).strip() + "…"
                entry["snippet"] = snippet
                results.append(entry)
            except Exception:
                continue
        if len(results) >= limit:
            break
    return results


def nb_get(nb_dir: str, entry_id: str):
    file_path = os.path.join(nb_dir, entry_id)
    if not os.path.realpath(file_path).startswith(os.path.realpath(nb_dir) + "/"):
        return None
    if not os.path.isfile(file_path):
        return None
    try:
        return parse_entry(nb_dir, entry_id, True)
    except Exception:
        return None


def nb_get_by_title(nb_dir: str, title_query: str, notebook=None):
    entries = nb_list(nb_dir, notebook=notebook)
    q = title_query.lower()
    match = next((e for e in entries if q in e["title"].lower()), None)
    if not match:
        return None
    return nb_get(nb_dir, match["id"])


def nb_create(nb_dir: str, notebook: str, data: dict) -> dict:
    dir_path = os.path.join(nb_dir, notebook)
    os.makedirs(dir_path, exist_ok=True)
    slug = re.sub(r'[<>:"/\\|?*\n]', '', data["title"].strip())
    slug = re.sub(r"\s+", "_", slug)[:60]
    date_str = (data.get("date") or date_mod.today().isoformat()).replace("-", "")
    filename = f"{slug}_{date_str}.md"
    file_path = os.path.join(dir_path, filename)

    tags_raw = data.get("tags")
    if isinstance(tags_raw, str):
        tags_arr = [t.strip() for t in tags_raw.split(",") if t.strip()]
    elif isinstance(tags_raw, list):
        tags_arr = tags_raw
    else:
        tags_arr = []

    meta = {
        "title": data["title"].strip(),
        "date": data.get("date") or date_mod.today().isoformat(),
        "author": data.get("author") or None,
        "source": data.get("source") or None,
        "summary": data.get("summary") or None,
        "tags": tags_arr if tags_arr else None,
    }
    content = data.get("content") or ""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(serialize_frontmatter(meta, content))

    return {
        "id": f"{notebook}/{filename}", "notebook": notebook, "filename": filename,
        "title": meta["title"], "author": meta.get("author"),
        "date": meta.get("date"), "source": meta.get("source"),
        "summary": meta.get("summary"),
        "tags": json.dumps(tags_arr) if tags_arr else None,
        "content": content,
    }


def nb_update(nb_dir: str, entry_id: str, data: dict):
    existing = nb_get(nb_dir, entry_id)
    if not existing:
        return None
    file_path = os.path.join(nb_dir, entry_id)

    exist_tags = json.loads(existing["tags"]) if existing.get("tags") else []
    new_tags_raw = data.get("tags") if data.get("tags") is not None else existing.get("tags")
    if new_tags_raw and isinstance(new_tags_raw, str):
        try:
            new_tags = json.loads(new_tags_raw)
        except Exception:
            new_tags = [t.strip() for t in new_tags_raw.split(",") if t.strip()]
    else:
        new_tags = exist_tags

    def pick(key):
        return data[key] if data.get(key) is not None else existing.get(key)

    meta = {
        "title": pick("title") or existing["title"],
        "date": pick("date") or None,
        "author": pick("author") or None,
        "source": pick("source") or None,
        "summary": pick("summary") or None,
        "tags": new_tags if new_tags else None,
    }
    body = data["content"] if data.get("content") is not None else (existing.get("content") or "")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(serialize_frontmatter(meta, body))

    result = dict(existing)
    result.update({
        "title": meta["title"], "author": meta.get("author"),
        "date": meta.get("date"), "source": meta.get("source"),
        "summary": meta.get("summary"),
        "tags": json.dumps(new_tags) if new_tags else None,
        "content": body,
    })
    return result


def nb_delete(nb_dir: str, entry_id: str) -> bool:
    file_path = os.path.join(nb_dir, entry_id)
    if not os.path.realpath(file_path).startswith(os.path.realpath(nb_dir) + "/"):
        return False
    if not os.path.isfile(file_path):
        return False
    os.unlink(file_path)
    return True


# ── Main handler ───────────────────────────────────────────────────────────

def ok(content):
    print(json.dumps({"type": "text", "content": content}))


def err(content):
    print(json.dumps({"type": "error", "content": content}))


def main():
    raw = sys.stdin.read()
    data = json.loads(raw)
    args = data.get("args", {})
    context = data.get("context", {})
    action = (args.get("action") or "").strip()
    nb_dir = os.path.join(context["workDir"], "notebooks")

    # ── NOTEBOOKS
    if action == "notebooks":
        nbs = nb_list_notebooks(nb_dir)
        if not nbs:
            return ok("没有找到任何 notebook（notebooks/ 目录为空或不存在）")
        return ok(f"共 {len(nbs)} 个 notebook：\n" + "\n".join(f"• {n}" for n in nbs))

    # ── LIST
    if action == "list":
        limit = int(args.get("limit", 50))
        nb = args.get("notebook")
        rows = nb_list(nb_dir, notebook=nb, limit=limit)
        if not rows:
            return ok(f'notebook "{nb}" 暂无条目' if nb else "没有找到任何条目")
        prefix = f"notebook「{nb}」" if nb else "全部 notebook"
        lines = []
        for r in rows:
            meta = format_meta(r)
            summary = f"\n  {r['summary']}" if r.get("summary") else ""
            lines.append(f"[{r['id']}] **{r['title']}**{'  ' + meta if meta else ''}{summary}")
        return ok(f"{prefix}共 {len(rows)} 条：\n\n" + "\n\n".join(lines))

    # ── SEARCH
    if action == "search":
        query = (args.get("query") or "").strip()
        if not query:
            return err("search 需要提供 query 参数")
        nb = args.get("notebook")
        rows = nb_search(nb_dir, query, notebook=nb, limit=int(args.get("limit", 20)))
        if not rows:
            return ok(f"未找到包含「{query}」的条目。")
        lines = []
        for r in rows:
            meta = format_meta(r)
            snip = f"\n  > {r['snippet']}" if r.get("snippet") else ""
            lines.append(f"[{r['id']}] **{r['title']}**{'  ' + meta if meta else ''}{snip}")
        return ok(f"搜索「{query}」共 {len(rows)} 条：\n\n" + "\n\n".join(lines))

    # ── READ
    if action == "read":
        row = None
        if args.get("id") is not None:
            row = nb_get(nb_dir, str(args["id"]))
        elif args.get("title_query"):
            nb = args.get("notebook")
            row = nb_get_by_title(nb_dir, str(args["title_query"]), nb)
        else:
            return err("read 需要提供 id 或 title_query")
        if not row:
            return err("未找到对应条目")
        meta = format_meta(row)
        tags = format_tags(row.get("tags"))
        parts = [f"# {row['title']}"]
        if meta:
            parts.append(meta)
        if row.get("summary"):
            parts.append(f"\n**摘要：** {row['summary']}")
        if tags:
            parts.append(f"**标签：** {', '.join(tags)}")
        parts.append("\n---\n")
        header = "\n".join(p for p in parts if p)
        return ok(header + (row.get("content") or "（无正文）"))

    # ── ADD
    if action == "add":
        title = (args.get("title") or "").strip()
        if not title:
            return err("add 需要提供 title")
        nb = str(args.get("notebook", "personal"))
        entry = nb_create(nb_dir, nb, {
            "title": title, "author": args.get("author"),
            "date": args.get("date"), "source": args.get("source"),
            "summary": args.get("summary"), "tags": args.get("tags"),
            "content": args.get("content"),
        })
        return ok(f'✅ 笔记已添加到 "{nb}"\nID: {entry["id"]}\n标题: {entry["title"]}')

    # ── UPDATE
    if action == "update":
        if args.get("id") is None:
            return err("update 需要提供 id")
        updated = nb_update(nb_dir, str(args["id"]), {
            "title": args.get("title"), "author": args.get("author"),
            "date": args.get("date"), "source": args.get("source"),
            "summary": args.get("summary"), "tags": args.get("tags"),
            "content": args.get("content"),
        })
        if not updated:
            return err(f'未找到 id="{args["id"]}" 的条目')
        return ok(f"✅ 笔记已更新：{updated['title']}")

    # ── DELETE
    if action == "delete":
        if args.get("id") is None:
            return err("delete 需要提供 id")
        entry_id = str(args["id"])
        existing = nb_get(nb_dir, entry_id)
        if not existing:
            return err(f'未找到 id="{entry_id}" 的条目')
        nb_delete(nb_dir, entry_id)
        return ok(f"✅ 笔记「{existing['title']}」已删除")

    return err(f'未知 action: "{action}"')


if __name__ == "__main__":
    main()

import re

p = 'web/src/components/ChatArea.tsx'
src = open(p).read()
orig = src.count('\n') + 1

# Brace-bodied declarations (function / const-object / type-object).
BRACE_DECLS = [
    r'^const TOOL_DISPLAY_NAMES\b',
    r'^function toolDisplayName\b',
    r'^function activityPreviewText\b',
    r'^function semanticPreview\b',
    r'^function compactPreview\b',
    r'^type ActivityDisplayItem\b',
    r'^function canMergeActivityItems\b',
    r'^function mergeActivityItems\b',
    r'^function generateBatchSummary\b',
    r'^function mergeMessageParts\b',
]


def cut_brace(text, pat):
    m = re.compile(pat, re.M).search(text)
    if not m:
        raise SystemExit('NOT FOUND brace: ' + pat)
    s = m.start()
    i = s
    depth = 0
    saw = False
    while i < len(text):
        c = text[i]
        if c == '{':
            depth += 1
            saw = True
        elif c == '}':
            depth -= 1
            if saw and depth == 0:
                nl = text.find('\n', i)
                e = nl + 1 if nl != -1 else len(text)
                if text[e:e + 1] == '\n':
                    e += 1
                return text[:s] + text[e:]
    raise SystemExit('no brace end: ' + pat)


# Single-line const Set declarations.
LINE_DECLS = [
    r'^const FILE_TOOLS = new Set\(.*\n',
    r'^const WEB_TOOLS  = new Set\(.*\n',
    r'^const RUN_TOOLS  = new Set\(.*\n',
]

# Type union (multi-line, ends at first blank line after start).
def cut_union(text, name):
    m = re.compile(r'^type ' + re.escape(name) + r' =', re.M).search(text)
    if not m:
        raise SystemExit('NOT FOUND union: ' + name)
    s = m.start()
    # end at the first blank line
    e = text.find('\n\n', s)
    e = e + 2 if e != -1 else len(text)
    return text[:s] + text[e:]


# Order matters only for safety; each operates on fresh search.
for pat in BRACE_DECLS:
    src = cut_brace(src, pat)
src = cut_union(src, 'RenderPart')
for pat in LINE_DECLS:
    src2 = re.sub(pat, '', src, count=1, flags=re.M)
    assert src2 != src, 'LINE_DECL not removed: ' + pat
    src = src2

# Remove orphaned section comments.
src = re.sub(r'\n// ── Tool display name map ─+\n', '\n', src)
src = re.sub(r'\n// ── Tool icon selector ─+\n', '\n', src)
# Collapse 3+ blanks.
src = re.sub(r'\n{3,}', '\n\n', src)

# Assertions.
for name in ['TOOL_DISPLAY_NAMES', 'toolDisplayName', 'FILE_TOOLS', 'WEB_TOOLS', 'RUN_TOOLS',
             'activityPreviewText', 'semanticPreview', 'compactPreview', 'ActivityDisplayItem',
             'RenderPart', 'canMergeActivityItems', 'mergeActivityItems', 'generateBatchSummary',
             'mergeMessageParts']:
    assert not re.search(r'^(const|function|type|async function) ' + re.escape(name) + r'\b', src, re.M), 'STILL: ' + name
assert re.search(r'^function ToolIcon\b', src, re.M), 'ToolIcon LOST'
assert re.search(r'^function messageMainText\b', src, re.M), 'messageMainText LOST'
assert re.search(r'^export const ChatArea\b', src, re.M), 'ChatArea LOST'

open(p, 'w').write(src)
print(f'LINES: {orig} -> {src.count(chr(10)) + 1} (removed {orig - (src.count(chr(10)) + 1)})')
print('OK')

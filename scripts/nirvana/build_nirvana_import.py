#!/usr/bin/env python3
"""
Stage 1 of the NIRVANA -> SWAG import.

Reads the two NIRVANA CSV sheets and emits a clean NDJSON file that the
TypeScript importer (import-nirvana.ts) inserts into the SWAG Postgres DB.

Transform strategy (Tier-1 "snapshot synthesis", see feasibility analysis):
  - Each editor op carries `current_editor` = the FULL document as a line list.
    We convert that to a BlockNote paragraph-array and emit it as a
    `snapshot` event (throttled). The existing replay player renders snapshots
    via editor.replaceBlocks and derives the word-count graph from them, so the
    editor pane animates as document keyframes with a correct word count.
  - Paste ops (op_type 'p') become `paste_internal` events. If the pasted text
    matches a ChatGPT response in the same essay, sourceArea='chat' so the
    replay paste->chat provenance highlighter links them.
  - gpt_inquiry / gpt_response rows become user / assistant chat_messages under
    one conversation per essay.
  - Final Text (Participants sheet) becomes a terminal `submission` event.
  - All NIRVANA `time` values are SECONDS; we emit relative milliseconds and the
    TS importer adds an absolute session base time.

Output: one NDJSON line of {"kind":"seed",...} then one per session
{"kind":"session",...}.
"""
import csv
import ast
import io
import json
import re
import sys
import os

csv.field_size_limit(10**8)

HERE = os.path.dirname(os.path.abspath(__file__))
NIRVANA_DIR = os.path.join(HERE, "..", "..", "nirvana")
PARTICIPANTS_CSV = os.path.join(NIRVANA_DIR, "Public Dataset - Participants.csv")
RAW_CSV = os.path.join(NIRVANA_DIR, "Public Dataset - Raw Data.csv")
OUT_PATH = os.path.join(NIRVANA_DIR, "nirvana-import.ndjson")

# Throttle: emit at most one snapshot per this many ms of *session* time,
# except pastes / replacements / the first & last states are always emitted.
SNAP_GAP_MS = 800
FORCE_OP_TYPES = {"p", "d_i", "x", "r"}

ESSAY_PROMPT = (
    "Issue:\n"
    "Automation is generally seen as a sign of progress, but what is lost when "
    "we replace humans with machines?\n\n"
    "Intelligent Machines\n"
    "Many of the goods and services we depend on daily are now supplied by "
    "intelligent, automated machines rather than human beings. Robots build cars "
    "and other goods on assembly lines, where once there were human workers. Many "
    "of our phone conversations are now conducted not with people but with "
    "sophisticated technologies. We can now buy goods at a variety of stores "
    "without the help of a human cashier. Automation is generally seen as a sign "
    "of progress, but what is lost when we replace humans with machines? Given the "
    "accelerating variety and prevalence of intelligent machines, it is worth "
    "examining the implications and meaning of their presence in our lives.\n\n"
    "Perspective One (Dystopian view)\n"
    "What we lose with the replacement of people by machines is some part of our "
    "own humanity. Even our mundane daily encounters no longer require from us "
    "basic courtesy, respect, and tolerance for other people.\n\n"
    "Perspective Two (Utilitarian view)\n"
    "Machines are good at low-skill, repetitive jobs, and at high-speed, extremely "
    "precise jobs. In both cases they work better than humans. This efficiency "
    "leads to a more prosperous and progressive world for everyone.\n\n"
    "Perspective Three (Progressive view)\n"
    "Intelligent machines challenge our long-standing ideas about what humans are "
    "or can be. This is good because it pushes both humans and machines toward "
    "new, unimagined possibilities.\n\n"
    "Write a unified, coherent essay about automation and what is lost when we "
    "replace humans with machines. In your essay, be sure to: develop your own "
    "perspective on the issue and analyze the relationship between your "
    "perspective and at least one other perspective."
)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


# The published NIRVANA CSVs lost some 3-byte UTF-8 punctuation to U+FFFD
# replacement-character runs (each run = exactly one lost character; audited by
# hand across every chat occurrence). Restore the two unambiguous cases:
# contraction/possessive apostrophes, then everything else as an em-dash.
# Without this, re-importing reintroduces the mojibake that was repaired in the
# live DB on 2026-07-11.
_MOJIBAKE_APOSTROPHE = re.compile("(\\w)�{3}(s|t|re|ll|ve|d|m)\\b")
_MOJIBAKE_RUN = re.compile("�+")


def fix_mojibake(s: str) -> str:
    if "�" not in s:
        return s
    s = _MOJIBAKE_APOSTROPHE.sub("\\1’\\2", s)
    return _MOJIBAKE_RUN.sub("—", s)


def parse_pylit(cell: str):
    """Parse a Python-literal cell (single quotes, lists/dicts). Return None on failure."""
    if cell is None or cell == "":
        return None
    try:
        return ast.literal_eval(cell)
    except Exception:
        return None


def lines_to_blocks(lines):
    """Convert a CodeMirror line list -> BlockNote PartialBlock paragraph array."""
    blocks = []
    for ln in lines:
        text = ln if isinstance(ln, str) else ("" if ln is None else str(ln))
        # A list element should be a single editor line; split defensively on any
        # embedded newline so each visual line becomes its own paragraph.
        for part in text.split("\n"):
            if part == "":
                blocks.append({"type": "paragraph", "content": []})
            else:
                blocks.append(
                    {"type": "paragraph", "content": [{"type": "text", "text": part, "styles": {}}]}
                )
    if not blocks:
        blocks.append({"type": "paragraph", "content": []})
    return blocks


def coerce_value(v: str):
    """Best-effort typing for participant metadata cells."""
    if v is None:
        return None
    s = v.strip()
    if s == "":
        return None
    if s.endswith("%"):
        try:
            return round(float(s[:-1]) / 100.0, 6)
        except ValueError:
            return s
    try:
        if re.fullmatch(r"-?\d+", s):
            return int(s)
        return float(s)
    except ValueError:
        return s


# ---------------------------------------------------------------------------
# Load participants
# ---------------------------------------------------------------------------
with open(PARTICIPANTS_CSV, newline="") as f:
    # StringIO (not splitlines) so newlines inside quoted cells survive.
    pr = csv.reader(io.StringIO(fix_mojibake(f.read())))
    pheader = next(pr)
    prows = list(pr)

PIDX = {h: i for i, h in enumerate(pheader)}
participants = {}
for row in prows:
    pid = row[PIDX["id"]].strip()
    meta = {}
    for h in pheader:
        # `Final Text` is represented separately as the submission event; skip the
        # bulky raw literal here to avoid storing the whole essay twice.
        if h in ("id", "Final Text"):
            continue
        meta[h] = coerce_value(row[PIDX[h]])
    # keep Final Text separately as parsed paragraph list
    final_text_raw = row[PIDX["Final Text"]]
    final_paras = parse_pylit(final_text_raw)
    if not isinstance(final_paras, list):
        final_paras = [final_text_raw] if final_text_raw else []
    participants[pid] = {
        "meta": meta,
        "final_paras": final_paras,
    }


# ---------------------------------------------------------------------------
# Load + group raw data by essay
# ---------------------------------------------------------------------------
with open(RAW_CSV, newline="") as f:
    # StringIO (not splitlines) so newlines inside quoted cells survive.
    rr = csv.reader(io.StringIO(fix_mojibake(f.read())))
    rheader = next(rr)
    RIDX = {h: i for i, h in enumerate(rheader) if h}

    def cell(row, name):
        i = RIDX.get(name)
        return row[i] if i is not None and i < len(row) else ""

    essays = {}  # essay_num -> list of row dicts
    misaligned = 0
    for row in rr:
        # Detect column-misaligned rows (data spilled past the 12 named cols).
        bad = len(row) > 12 and any((c or "").strip() for c in row[12:])
        e = cell(row, "essay_num").strip()
        if e == "":
            continue
        essays.setdefault(e, []).append({
            "op_index": cell(row, "op_index"),
            "time": cell(row, "time"),
            "op_loc": cell(row, "op_loc"),
            "op_type": cell(row, "op_type"),
            "current_editor": cell(row, "current_editor"),
            "add": cell(row, "add"),
            "selected_text": cell(row, "selected_text"),
            "bad": bad,
        })
        if bad:
            misaligned += 1


def to_ms(time_str):
    try:
        return int(round(float(time_str) * 1000))
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Build sessions
# ---------------------------------------------------------------------------
out_lines = []
out_lines.append(json.dumps({
    "kind": "seed",
    "ownerEmail": "sangwooklee@vt.edu",   # paper author; admin sees all regardless
    "shareToken": "nirvana-dataset",
    "title": "NIRVANA Dataset (Student AI-Assisted Essay Writing)",
    "instructions": ESSAY_PROMPT,
}, ensure_ascii=False))

stats = {"sessions": 0, "snapshots": 0, "pastes": 0, "messages": 0, "submissions": 0}
snap_counts = []

for e in sorted(essays.keys(), key=lambda x: int(x)):
    rows = sorted(essays[e], key=lambda r: int(r["op_index"]) if r["op_index"].lstrip("-").isdigit() else 0)
    p = participants.get(e, {"meta": {}, "final_paras": []})

    # Pre-compute normalized GPT responses for paste-origin detection.
    gpt_responses_norm = [
        norm(r["selected_text"]) for r in rows if r["op_type"] == "gpt_response" and r["selected_text"]
    ]

    def paste_is_from_chat(text):
        nt = norm(text)
        if len(nt) < 12:
            return False
        head = nt[:160]
        for resp in gpt_responses_norm:
            if not resp:
                continue
            if head in resp or (len(nt) <= len(resp) and nt in resp):
                return True
        return False

    events = []
    last_doc = None
    last_snap_ms = -10**12
    last_emitted_doc = None
    last_rel_ms = 0

    for r in rows:
        if r["op_loc"] != "editor":
            continue
        rel = to_ms(r["time"])
        if rel is None:
            continue
        last_rel_ms = max(last_rel_ms, rel)
        op = r["op_type"]
        is_paste = op == "p"

        # Paste event (emit before the post-paste snapshot so the marker sorts first)
        if is_paste:
            content = r["add"] or r["selected_text"] or ""
            if content:
                from_chat = paste_is_from_chat(content)
                events.append({
                    "type": "paste_internal",
                    "rel": rel,
                    "seq": int(r["op_index"]),
                    "data": {
                        "content": content,
                        "sourceArea": "chat" if from_chat else "editor",
                        "targetArea": "editor",
                        "matchMethod": "none",
                    },
                })
                stats["pastes"] += 1

        if r["bad"]:
            continue  # misaligned row: skip snapshot, next valid one self-heals
        lines = parse_pylit(r["current_editor"])
        if not isinstance(lines, list):
            continue
        doc = lines_to_blocks(lines)
        changed = doc != last_doc
        last_doc = doc
        if not changed:
            continue
        force = is_paste or op in FORCE_OP_TYPES
        if last_emitted_doc is None or force or (rel - last_snap_ms) >= SNAP_GAP_MS:
            events.append({
                "type": "snapshot",
                "rel": rel,
                "seq": int(r["op_index"]),
                "data": doc,
            })
            last_snap_ms = rel
            last_emitted_doc = doc
            stats["snapshots"] += 1

    # Ensure the final editor state is captured as a snapshot.
    if last_doc is not None and last_doc != last_emitted_doc:
        events.append({"type": "snapshot", "rel": last_rel_ms, "seq": 10**8, "data": last_doc})
        last_emitted_doc = last_doc
        stats["snapshots"] += 1

    # Terminal submission from the canonical Final Text.
    final_paras = p["final_paras"]
    if final_paras:
        sub_blocks = lines_to_blocks(final_paras)
        events.append({
            "type": "submission",
            "rel": last_rel_ms + 1,
            "seq": 10**8 + 1,
            "data": sub_blocks,
        })
        stats["submissions"] += 1

    snap_counts.append(sum(1 for ev in events if ev["type"] == "snapshot"))

    # Chat messages (one conversation per essay)
    messages = []
    seq = 0
    for r in rows:
        if r["op_type"] not in ("gpt_inquiry", "gpt_response"):
            continue
        rel = to_ms(r["time"])
        if rel is None:
            continue
        text = r["selected_text"] or ""
        if not text:
            continue
        messages.append({
            "role": "user" if r["op_type"] == "gpt_inquiry" else "assistant",
            "content": text,
            "rel": rel,
            "seq": seq,
        })
        seq += 1
    stats["messages"] += len(messages)

    conv_title = None
    for m in messages:
        if m["role"] == "user":
            conv_title = (m["content"][:60] + ("…" if len(m["content"]) > 60 else "")).strip()
            break

    out_lines.append(json.dumps({
        "kind": "session",
        "essayNum": int(e),
        "participantToken": f"P{e}",
        "studentEmail": f"nirvana+{e}@dataset.local",
        "studentFirstName": "Participant",
        "studentLastName": str(e),
        "metadata": {"source": "nirvana", "essayNum": int(e), **p["meta"]},
        "events": events,
        "conversation": ({"title": conv_title or "ChatGPT"} if messages else None),
        "messages": messages,
    }, ensure_ascii=False))
    stats["sessions"] += 1

with open(OUT_PATH, "w") as f:
    f.write("\n".join(out_lines) + "\n")

avg_snap = round(sum(snap_counts) / len(snap_counts), 1) if snap_counts else 0
print(f"Wrote {OUT_PATH}")
print(f"  sessions   : {stats['sessions']}")
print(f"  snapshots  : {stats['snapshots']}  (avg {avg_snap}/essay, max {max(snap_counts) if snap_counts else 0})")
print(f"  pastes     : {stats['pastes']}")
print(f"  submissions: {stats['submissions']}")
print(f"  messages   : {stats['messages']}")
print(f"  misaligned rows skipped for snapshots: {misaligned}")
print(f"  output size: {os.path.getsize(OUT_PATH)/1e6:.1f} MB")

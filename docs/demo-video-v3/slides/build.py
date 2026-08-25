#!/usr/bin/env python3
"""
Generates slides.html — the two concept decks of docs/demo-video-v3.

The figures are repetitive (a 103-dot grid, stacks of identical cards), so the
HTML is generated rather than hand-written. Edit here and re-run; the output is
static markup with no script, so slides.html opens and renders anywhere.

The discipline this file has to keep is in ../02_CONCEPT_SLIDES.md:
no screenshots, no on-screen labels, one accent colour shared by BOTH decks
(a different colour per deck would give the two systems different impressions),
and `when` / `then` in lowercase because they are concepts here, not the fields
called `When a question…` / `Then` on the board.
"""
import html
import json

W, H = 1920, 1080          # design canvas; the renderer doubles it to 4K
FW, FH = 1640, 700         # figure area inside the canvas

INK, MUTED, LINE = '#12141A', '#6E7581', '#D7DBE0'
ACCENT, ACCENT_SOFT = '#2B5CE6', '#EAF0FE'
DOT, PLACEHOLDER = '#B9BFC9', '#D9DDE3'


def svg(body, h=FH):
    """Figures share one width so nothing jumps between slides; the height is
    per-figure so a short one (the loop) still sits in the middle of the slide
    instead of hanging from the top of a 700px box."""
    return f'<svg viewBox="0 0 {FW} {h}" width="{FW}" height="{h}" xmlns="http://www.w3.org/2000/svg">{body}</svg>'


def document(x, y, w, h, lines, line_x_pad=32, first=45, gap=50, lh=14, accent_index=None):
    """A rules document: a page with grey text lines in it."""
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="#FCFCFD" stroke="{LINE}" stroke-width="3"/>']
    for i, lw in enumerate(lines):
        ly = y + first + i * gap
        if accent_index is not None and i == accent_index:
            out.append(f'<rect x="{x+line_x_pad}" y="{ly-1}" width="{lw}" height="{lh+4}" rx="{(lh+4)/2}" fill="{ACCENT}"/>')
        else:
            out.append(f'<rect x="{x+line_x_pad}" y="{ly}" width="{lw}" height="{lh}" rx="{lh/2}" fill="#C7CBD1"/>')
    return ''.join(out)


def arrow(x1, y1, x2, y2, color=ACCENT, w=4):
    head = 14
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2-head}" y2="{y2}" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>'
            f'<path d="M{x2},{y2} L{x2-head-2},{y2-9} L{x2-head-2},{y2+9} Z" fill="{color}"/>')


def down_arrow(x, y1, y2, color=ACCENT, w=3):
    head = 14
    return (f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2-head}" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>'
            f'<path d="M{x},{y2} L{x-9},{y2-head-2} L{x+9},{y2-head-2} Z" fill="{color}"/>')


def person(cx, cy, s=1.0, color=INK):
    """A head and a pair of shoulders. Enough to read as somebody."""
    return (f'<circle cx="{cx}" cy="{cy - 26 * s}" r="{17 * s}" fill="{color}"/>'
            f'<path d="M{cx - 27 * s},{cy + 30 * s} A{27 * s},{30 * s} 0 0 1 {cx + 27 * s},{cy + 30 * s} Z" fill="{color}"/>')


def chatbot(x, y, w, h):
    """A speech bubble, not a face. A face would promise a personality the
    thing does not have, and this deck's whole job is to be exact about what
    it does."""
    lines = ''.join(
        f'<rect x="{x + 30}" y="{y + 44 + i * 32}" width="{w - 60 - i * 34}" height="12" rx="6" fill="{ACCENT}" opacity="0.45"/>'
        for i in range(3))
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" fill="{ACCENT_SOFT}" stroke="{ACCENT}" stroke-width="3"/>'
            f'<path d="M{x + 46},{y + h} l0,34 l38,-34 Z" fill="{ACCENT_SOFT}" stroke="{ACCENT}" stroke-width="3" stroke-linejoin="round"/>'
            f'<rect x="{x + 40}" y="{y + h - 3}" width="46" height="6" fill="{ACCENT_SOFT}"/>'
            + lines)


def both_ways(x1, x2, y, color='#A8AEB8', w=3.5):
    head = 14
    return (f'<line x1="{x1 + head}" y1="{y}" x2="{x2 - head}" y2="{y}" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>'
            f'<path d="M{x2},{y} L{x2 - head - 2},{y - 9} L{x2 - head - 2},{y + 9} Z" fill="{color}"/>'
            f'<path d="M{x1},{y} L{x1 + head + 2},{y - 9} L{x1 + head + 2},{y + 9} Z" fill="{color}"/>')


# ---------------------------------------------------------------- the framing figure
def fig_frame():
    """Who is doing what to whom. Identical in both decks, deliberately: the
    two systems differ in how a setup is written, not in whose setup it is or
    who receives the answers."""
    h, y = 420, 210
    o = [person(135, y, 1.15)]
    o.append(arrow(200, y, 282, y))
    o.append(document(315, 100, 170, 220, [110, 96, 118, 88, 104, 82], line_x_pad=28, first=38, gap=34, lh=11))
    o.append(arrow(518, y, 600, y))
    o.append(chatbot(640, 118, 210, 168))
    o.append(both_ways(900, 1060, y))
    for i in range(5):
        o.append(person(1120 + i * 96, y, 0.92, DOT))
    return svg(''.join(o), h)


# ---------------------------------------------------------------- dot grid
GX, GY, GW, GH = 560, 80, 1020, 540
COLS, ROWS, SX, SY = 13, 8, 72, 64
DX = GX + (GW - (COLS - 1) * SX) / 2
DY = GY + (GH - (ROWS - 1) * SY) / 2
CELLS = [(r, c) for r in range(ROWS) for c in range(COLS)][:103]   # exactly 103


def dot_grid(lit=()):
    out = [f'<rect x="{GX}" y="{GY}" width="{GW}" height="{GH}" rx="26" fill="#F7F9FE" stroke="{ACCENT}" stroke-width="2.5"/>']
    for r, c in CELLS:
        on = (r, c) in lit
        out.append(f'<circle cx="{DX + c*SX}" cy="{DY + r*SY}" r="{10 if on else 9}" fill="{ACCENT if on else DOT}"/>')
    return ''.join(out)


# ---------------------------------------------------------------- Clay figures
DOC_LINES_BIG = [370, 340, 300, 355, 250, 365, 315, 348, 285, 360, 200]
DOC_LINES_SM = [246, 220, 256, 200, 238, 210, 250, 176]

fig_c1 = svg(document(590, 30, 460, 640, DOC_LINES_BIG, line_x_pad=45, first=85, gap=50))

fig_c2 = svg(
    document(60, 110, 320, 480, DOC_LINES_SM, line_x_pad=32, first=45, gap=52, lh=12)
    + arrow(410, 350, 530, 350)
    + dot_grid()
)

LIT = {(0, 2), (1, 7), (2, 11), (3, 4), (4, 9), (5, 1), (5, 12), (6, 6), (7, 3), (7, 10)}
_threads = []
for _r, _c in sorted(LIT):
    _tx, _ty = DX + _c * SX, DY + _r * SY
    _threads.append(f'<path d="M348,319 Q{(348+_tx)/2},{319 + (_ty-319)*0.12} {_tx},{_ty}" fill="none" '
                    f'stroke="{ACCENT}" stroke-width="2" opacity="0.32"/>')
fig_c3 = svg(
    document(60, 110, 320, 480, DOC_LINES_SM, line_x_pad=32, first=45, gap=52, lh=12, accent_index=3)
    + ''.join(_threads)
    + dot_grid(LIT)
)


# ---------------------------------------------------------------- the loop (shared by both decks)
def fig_loop():
    bw, bh, by, h = 340, 160, 60, 430
    xs = [40, 440, 840, 1260]
    mid = by + bh / 2
    o = []
    for i, x in enumerate(xs):
        last = i == 3
        o.append(f'<rect x="{x}" y="{by}" width="{bw}" height="{bh}" rx="14" '
                 f'fill="{ACCENT_SOFT if last else "#FFFFFF"}" stroke="{ACCENT if last else LINE}" '
                 f'stroke-width="{3 if last else 2.5}"/>')
    o.append(arrow(388, mid, 432, mid, LINE, 3))
    o.append(arrow(788, mid, 832, mid, LINE, 3))
    o.append(arrow(1188, mid, 1252, mid, ACCENT, 3))
    # the loop itself: back from step three to step one
    o.append(f'<path d="M1010,{by+bh} C1010,336 1010,344 942,344 L278,344 C210,344 210,336 210,{by+bh+12}" '
             f'fill="none" stroke="{LINE}" stroke-width="3" stroke-linecap="round"/>')
    o.append(f'<path d="M210,{by+bh} L201,{by+bh+18} L219,{by+bh+18} Z" fill="{LINE}"/>')
    t = f'font-family="Noto Sans, sans-serif" font-size="38" font-weight="500" text-anchor="middle" fill="{INK}"'
    o.append(f'<text x="210" y="{mid+13}" {t}>write</text>')
    o.append(f'<text x="610" y="{mid-10}" {t}>see what it</text><text x="610" y="{mid+36}" {t}>answers</text>')
    o.append(f'<text x="1010" y="{mid+13}" {t}>keep a point</text>')
    o.append(f'<text x="1430" y="{mid+28}" {t}>deploy, once</text>')
    o.append(f'<rect x="1417" y="{by+34}" width="26" height="20" rx="4" fill="none" stroke="{ACCENT}" stroke-width="3"/>'
             f'<path d="M1423,{by+34} v-7 a7,7 0 0 1 14,0 v7" fill="none" stroke="{ACCENT}" stroke-width="3"/>')
    # Where the loop lets go. Deploying is the only step whose result leaves
    # the room, so it is the only one with anything after it.
    o.append(down_arrow(1430, by + bh + 6, by + bh + 68))
    for cx in (1352, 1430, 1508):
        o.append(person(cx, by + bh + 122, 0.82, DOT))
    return svg(''.join(o), h)


# ---------------------------------------------------------------- Slate figures
CX, CW, CH, CGAP = 420, 800, 150, 22
SPINE, STUB = 330, 384              # the probe lane, left of the cards
ENTRY, REST = 428, 452              # where the question crosses the edge, and rests
PADL, BARX = 70, 190                # card padding: leaves a lane for the resting dot


def card(y, state='normal', has_when=True):
    """state: normal | picked | faded | leftover"""
    fill, stroke, sw, op = '#FFFFFF', LINE, 2.5, 1.0
    if state == 'picked':
        fill, stroke, sw = '#F5F8FF', ACCENT, 3.5
    elif state == 'faded':
        op = 0.38
    elif state == 'leftover':
        fill, stroke = '#F5F6F8', '#C9CED5'
    lab = f'font-family="Noto Sans, sans-serif" font-size="26" fill="{MUTED}" letter-spacing="1.4"'
    o = [f'<g opacity="{op}">',
         f'<rect x="{CX}" y="{y}" width="{CW}" height="{CH}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>',
         f'<line x1="{CX}" y1="{y+CH/2}" x2="{CX+CW}" y2="{y+CH/2}" stroke="#E6E8EC" stroke-width="2"/>']
    if has_when:
        o.append(f'<text x="{CX+PADL}" y="{y+47}" {lab}>when</text>')
        o.append(f'<rect x="{CX+BARX}" y="{y+34}" width="520" height="12" rx="6" fill="{PLACEHOLDER}"/>')
    else:
        o.append(f'<rect x="{CX+PADL}" y="{y+18}" width="{CW-PADL-40}" height="40" rx="8" fill="none" '
                 f'stroke="#CFD4DB" stroke-width="2" stroke-dasharray="8 8"/>')
    o.append(f'<text x="{CX+PADL}" y="{y+122}" {lab}>then</text>')
    o.append(f'<rect x="{CX+BARX}" y="{y+109}" width="460" height="12" rx="6" fill="{PLACEHOLDER}"/>')
    o.append('</g>')
    return ''.join(o)


def stack(n):
    total = n * CH + (n - 1) * CGAP
    y0 = (FH - total) / 2
    return [y0 + i * (CH + CGAP) for i in range(n)]


PROBE = f'stroke="{ACCENT}" stroke-width="3" stroke-dasharray="10 9" fill="none" stroke-linecap="round"'


def tick(y):
    """A probe that reaches a card's `when` and stops short of it."""
    return (f'<path d="M{SPINE},{y} H{STUB}" {PROBE}/>'
            f'<path d="M{STUB+11},{y} L{STUB-1},{y-7} L{STUB-1},{y+7} Z" fill="{ACCENT}"/>')


def when_y(y):
    return y + 37


def then_y(y):
    return y + 112


ys3 = stack(3)
fig_s1 = svg(''.join(card(y) for y in ys3))

# S2 — checked at the top, taken by the second
w = [when_y(y) for y in ys3]
fig_s2 = svg(
    card(ys3[0]) + card(ys3[1], 'picked') + card(ys3[2], 'faded')
    + f'<path d="M210,{w[0]} H{SPINE}" {PROBE}/>' + tick(w[0])
    + f'<path d="M{SPINE},{w[0]} V{w[1]}" {PROBE}/>'
    + f'<path d="M{SPINE},{w[1]} H{ENTRY}" {PROBE}/>'
    + f'<circle cx="{REST}" cy="{w[1]}" r="13" fill="{ACCENT}"/>'
)

# S3 — past every description, into the place that has none
ys4 = stack(4)
w4 = [when_y(y) for y in ys4[:3]]
land = then_y(ys4[3])
fig_s3 = svg(
    ''.join(card(y) for y in ys4[:3]) + card(ys4[3], 'leftover', has_when=False)
    + f'<path d="M210,{w4[0]} H{SPINE}" {PROBE}/>'
    + ''.join(tick(y) for y in w4)
    + f'<path d="M{SPINE},{w4[0]} V{land}" {PROBE}/>'
    + f'<path d="M{SPINE},{land} H{ENTRY}" {PROBE}/>'
    + f'<circle cx="{REST}" cy="{land}" r="13" fill="{ACCENT}"/>'
)

# ---------------------------------------------------------------- part cards
# A seven-minute file with no seams reads as one undifferentiated block. These
# are the seams: one card in front of each of the three layers, so a viewer can
# always tell which part they are in and which system it is about.
#
# White, like everything else. The old black title card was the only frame in
# the deck that inverted, and once there are four of them in a film the
# inversion is a flicker rather than a punctuation mark.
#
# The system name is on every card on purpose — in a joined film it is the only
# thing that keeps saying which of the two this is.
#
# No part numbers and no progress bar. Block 1 has three parts and block 2 has
# two, so any counter would make the two blocks need different cards for the
# same layer, and the part's own name already does the dividing.
PARTS = [
    ('1-how-it-works', 'How it works'),
    ('2-getting-around', 'Getting around'),
    ('3-worked-example', 'A worked example'),
]


# ---------------------------------------------------------------- slides
FRAME_CAPTION = 'you brief it. they talk to it.'
fig_the_frame = fig_frame()
fig_the_loop = fig_loop()

def part_slides(system, name):
    """The card in front of each layer. The first one also opens the concept
    deck, so the deck has no title card of its own."""
    return [(f'{system}-part-{slug}', 'part', (name, title), None) for slug, title in PARTS]


SLIDES = [
    *part_slides('clay', 'Clay'),
    ('clay-1-brief', 'figure', fig_the_frame, FRAME_CAPTION),
    ('clay-2-document', 'figure', fig_c1, 'one document'),
    ('clay-3-every-question', 'figure', fig_c2, 'every question'),
    ('clay-4-read-for-all', 'figure', fig_c3, 'a rule you write for one kind of question is read for all of them'),
    ('clay-5-loop', 'figure', fig_the_loop, None),
    *part_slides('slate', 'Slate'),
    ('slate-1-brief', 'figure', fig_the_frame, FRAME_CAPTION),
    ('slate-2-intents', 'figure', fig_s1, 'several intents'),
    ('slate-3-first-match', 'figure', fig_s2, 'the first one that matches'),
    ('slate-4-leftover', 'figure', fig_s3, 'whatever is left'),
    ('slate-5-loop', 'figure', fig_the_loop, None),
]

# The two slides that are the same picture in both decks are rendered ONCE and
# copied, not screenshotted twice: element screenshots of the same markup at
# different page offsets differ by a thousand bytes of antialiasing, and a
# "these are the same frame" claim that is only nearly true is worse than not
# making it. Keys are the copy, values the original.
DUPLICATES = {'slate-1-brief': 'clay-1-brief', 'slate-5-loop': 'clay-5-loop'}

CSS = f"""
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#3a3d42;font-family:'Noto Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.slide{{width:{W}px;height:{H}px;background:#fff;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:60px;padding:90px 140px;overflow:hidden}}
.slide+.slide{{margin-top:40px}}
.slide.part{{gap:0}}
.part .rule{{width:88px;height:6px;border-radius:3px;background:{ACCENT};margin-bottom:46px}}
.part .sys{{font-size:34px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;
  color:{MUTED};margin-bottom:28px}}
.part h2{{font-size:120px;font-weight:600;color:{INK};letter-spacing:-2px;line-height:1.05;text-align:center}}
.caption{{color:{MUTED};font-size:48px;font-weight:400;line-height:1.3;text-align:center;max-width:1480px}}
svg{{display:block}}
@media print{{body{{background:#fff}} .slide{{page-break-after:always}} .slide+.slide{{margin-top:0}}}}
"""

parts = [f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
         f'<title>Concept decks — demo video v3</title><style>{CSS}</style></head><body>']
for slug, kind, content, caption in SLIDES:
    if kind == 'part':
        system, title = content
        parts.append(
            f'<section class="slide part" id="{slug}">'
            f'<div class="rule"></div>'
            f'<div class="sys">{html.escape(system)}</div>'
            f'<h2>{html.escape(title)}</h2></section>')
    else:
        cap = f'<p class="caption">{html.escape(caption)}</p>' if caption else ''
        parts.append(f'<section class="slide" id="{slug}">{content}{cap}</section>')
parts.append('</body></html>')

open('slides.html', 'w').write('\n'.join(parts))
open('slides.json', 'w').write(json.dumps(
    {'order': [s[0] for s in SLIDES], 'duplicates': DUPLICATES}, indent=2) + '\n')
print(f'slides.html written — {len(SLIDES)} slides')

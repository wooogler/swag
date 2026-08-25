#!/usr/bin/env python3
"""
06_NARRATION.md → the text that actually goes into ElevenLabs.

Two shapes, one source.

  studio/*.txt   Five chapters, one per Studio project. Beats are separated by
                 a blank line, which is what Studio splits blocks on, so the
                 blocks come out one-to-one with the beats in the script.
  lines/*.txt    One beat per file, for regenerating a single block later.

Two things this exists to prevent.

ONE: drift. The spoken text lives in exactly one place (the narration doc);
this only copies it. Re-run after any edit there.

TWO: generating the same sentence twice. Five VO lines are character-identical
across the two decks on purpose, and the whole parity argument is that a
participant hears the same sentence either way. Two generations of one sentence
are not the same sentence. `lines/` gives those five ONE file each; in `studio/`
they necessarily appear in both chapters, so MANIFEST.md names the exact block
numbers to copy across rather than regenerate.
"""
import re
import pathlib

HERE = pathlib.Path(__file__).parent
DOC = HERE.parent / '06_NARRATION.md'

# section prefix → (per-clip name, studio chapter file, human name)
TRACKS = {
    '②ⓐ': ('getting-around', 'getting-around', 'Getting around'),
    '①Ⓒ': ('concept-clay', 'clay-concept', 'Concept · Clay'),
    '①Ⓢ': ('concept-slate', 'slate-concept', 'Concept · Slate'),
    '③Ⓒ': ('walk-clay', 'clay-walkthrough', 'Walkthrough · Clay'),
    '③Ⓢ': ('walk-slate', 'slate-walkthrough', 'Walkthrough · Slate'),
}

# Lines that are the same sentence in both decks. Keys are the FIRST occurrence.
SHARED = {
    ('①Ⓒ', 'C1'): 'shared-concept-frame',
    ('①Ⓒ', 'C5'): 'shared-concept-loop',
    ('③Ⓒ', 'C1'): 'shared-walk-observation-a',
    ('③Ⓒ', 'C2'): 'shared-walk-observation-b',
    ('③Ⓒ', 'C10'): 'shared-walk-close',
}
PAIRED = {('①Ⓢ', 'S1'): ('①Ⓒ', 'C1'),
          ('①Ⓢ', 'S5'): ('①Ⓒ', 'C5'),
          ('③Ⓢ', 'S1'): ('③Ⓒ', 'C1'),
          ('③Ⓢ', 'S2'): ('③Ⓒ', 'C2'),
          ('③Ⓢ', 'S10'): ('③Ⓒ', 'C10')}

doc = DOC.read_text()
beats = {}          # (track, beat) -> text
by_track = {}       # track -> [beat, ...] in order
for sec in re.split(r'\n## ', doc)[1:]:
    track = sec.split('\n')[0][:2]
    if track not in TRACKS:
        continue
    for m in re.finditer(r'\*\*([ACS]\d+)\*\*\n> (.*)', sec):
        beat, text = m.group(1), ' '.join(m.group(2).split())
        beats[(track, beat)] = text
        by_track.setdefault(track, []).append(beat)


def clean(name, text):
    """Nothing that is not speech may reach the engine."""
    assert '—' not in text, f'{name}: em dash'
    assert not re.search(r'[*`#\[\]|>]', text), f'{name}: markdown'
    assert not re.search(r'[가-힣]', text), f'{name}: Korean'
    assert not re.search(r'\d', text), f'{name}: digit'
    assert text[-1] in '.?!', f'{name}: no terminal punctuation'


# ---------------------------------------------------------------- studio/
STUDIO = HERE / 'studio'
STUDIO.mkdir(exist_ok=True)
for f in STUDIO.glob('*.txt'):
    f.unlink()
chapters = []
for track, order in by_track.items():
    _, chapter, human = TRACKS[track]
    blocks = [beats[(track, b)] for b in order]
    for b, text in zip(order, blocks):
        clean(f'{chapter}:{b}', text)
    (STUDIO / f'{chapter}.txt').write_text('\n\n'.join(blocks) + '\n')
    chapters.append((chapter, human, track, order, blocks))

# ---------------------------------------------------------------- lines/
LINES = HERE / 'lines'
LINES.mkdir(exist_ok=True)
for f in LINES.glob('*.txt'):
    f.unlink()
rows, written = [], {}
for track, order in by_track.items():
    for beat in order:
        key = (track, beat)
        if key in PAIRED:
            src = PAIRED[key]
            assert beats[src] == beats[key], f'{key} and {src} are no longer identical'
            rows.append((track, beat, SHARED[src] + '.txt', 'reuses the same audio'))
            continue
        name = SHARED.get(key, f'{TRACKS[track][0]}-{beat.lower()}')
        (LINES / f'{name}.txt').write_text(beats[key] + '\n')
        written[name] = beats[key]
        rows.append((track, beat, name + '.txt',
                     'shared with the other deck' if key in SHARED else ''))

# ---------------------------------------------------------------- MANIFEST
words = sum(len(re.findall(r"\b[\w'’-]+\b", t)) for t in beats.values())
md = ['# TTS — 무엇을 어디에 넣나', '',
      '`export.py` 가 `../06_NARRATION.md` 에서 뽑아 쓴다. **여기 있는 .txt를 고치지 말고 원고를 고친 뒤 다시 돌린다.**', '',
      '```bash', 'cd docs/demo-video-v3/tts && python3 export.py', '```', '',
      f'비트 {len(beats)}개 · 낭독 단어 {words}개.', '',
      '## `studio/` — 챕터 하나에 프로젝트 하나', '',
      'ElevenLabs Studio에 그대로 올린다. **빈 줄이 블록 경계**라 블록이 비트와 일대일로 떨어진다.', '']
for chapter, human, track, order, blocks in chapters:
    md += [f'### `studio/{chapter}.txt` — {human} (블록 {len(order)}개)', '',
           '| 블록 | 비트 | 첫머리 | |', '|---|---|---|---|']
    for i, (b, text) in enumerate(zip(order, blocks), 1):
        key = (track, b)
        mark = ''
        if key in SHARED:
            other = {'①Ⓒ': 'slate-concept', '③Ⓒ': 'slate-walkthrough'}[track]
            mark = f'**다른 덱과 같은 문장** — `{other}.txt` 의 블록 {i} 에 이 오디오를 그대로 쓴다'
        elif key in PAIRED:
            src_track = PAIRED[key][0]
            other = {'①Ⓒ': 'clay-concept', '③Ⓒ': 'clay-walkthrough'}[src_track]
            mark = f'**생성하지 말 것** — `{other}.txt` 블록 {i} 의 오디오를 쓴다'
        md.append(f'| {i} | {b} | {text[:44]}… | {mark} |')
    md.append('')
md += ['### 두 번 만들지 말아야 하는 블록', '',
       '| | 클레이 쪽 | 슬레이트 쪽 |', '|---|---|---|',
       '| 개념 덱 | `clay-concept.txt` 블록 **1, 5** | `slate-concept.txt` 블록 **1, 5** |',
       '| 워크스루 | `clay-walkthrough.txt` 블록 **1, 2, 10** | `slate-walkthrough.txt` 블록 **1, 2, 10** |',
       '',
       '문장이 글자까지 같다. 두 번 만들면 억양이 갈리고, 그건 두 조건 사이에 있어선 안 되는 차이다. '
       '한쪽에서 만든 오디오를 다른 쪽 타임라인에 그대로 얹는다. '
       '`getting-around.txt` 는 한 번 만들어 **두 블록-1 영상**에 같이 쓴다(그림만 보드별로 다르다).', '',
       '## `lines/` — 비트 하나에 파일 하나', '',
       f'블록 하나만 다시 만들 때 쓴다. 파일 {len(written)}개(위 다섯 쌍은 하나로 묶여 있다).', '',
       '| 트랙 | 비트 | 파일 | |', '|---|---|---|---|']
md += [f'| {t} | {b} | `lines/{f}` | {n} |' for t, b, f, n in rows]
md += ['', '**목소리 설정·검수 항목은 `../06_NARRATION.md` 의 TTS 블록.**']
(HERE / 'MANIFEST.md').write_text('\n'.join(md) + '\n')
print(f'{len(chapters)} chapters, {len(written)} clips, {len(beats)} beats, {words} spoken words')

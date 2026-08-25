# 참고 화면 (2026-08-23 재촬영)

실제 데모 워크스페이스를 `Run demo · Simple SCORE` / `· Simple Baseline`으로 끝까지 돌려 채집했다. **1920×1080**, 개발 빌드(왼쪽 아래 "N" 배지는 본 촬영에는 없다 — 프로덕션 빌드로 찍는다).

라벨의 진실은 `01_PLAN.md` §5이고, 이 폴더는 그것이 화면에서 어떻게 앉는지를 보여 준다.

| 파일 | 무엇 | 어느 비트 |
|---|---|---|
| `a01_briefing.png` | 브리핑 모달 — 세 섹션, *Reopen this any time from Your task in the header.*, **Start** | ⓐA1 |
| `a02_search.png` | `Search questions`에 `exaggeration` → `2 of 103` | ⓐA2 |
| `a03_delivered_line.png` | 뷰어의 **This reply is the one that was delivered.** — 비교할 버전이 없어 드롭다운이 없는 상태 | ⓐA3 |
| `a04_kept_in_view.png` | **Kept in view** 선반 · *Stays here whatever you have selected* · `· 1 kept above` · `show pasted text` · `⌃ 2/5 ⌄` | ⓐA4 |
| `b01_slate_board.png` | Slate 첫 화면 — `Setup`/`Undo`/`Redo`, `+ New intent`, `Uncategorized 103`, 리스트 제목이 **Uncategorized**, 전 행에 소속 칩 | ⓑB1 |
| `b02_create_from_query.png` | 행 `+`로 연 폼 — `○ New intent` · *Read before …* · **STARTED FROM** 카드 | ⓑB3 |
| `b02b_starter_sets.png` | **Starter sets** 메뉴 — 시드가 든 `● Word Choice`가 물들어 있다(상단 범례 없음) | ⓑB3 |
| `b03_judging.png` | **판정 중** — 리스트 헤더 *working out where questions go*, 핀 행에 *working it out*, Uncategorized에 스피너, 뷰어는 *Working out this reply under* | ⓑB4 |
| `b03_intent_open_examples.png` | Add 직후 **저절로 열린 카드** + **Examples 1** · `Closest first`/`Furthest first` · `Generate examples` | ⓑB4 |
| `b04_after_apply.png` | Apply 뒤 — 트리 행의 **unsaved** 칩, `VERSION HISTORY 2`의 `v2 · … · unsaved` / `v1 · … · 4m ago` | ⓑB5 |
| `b05_examples_furthest.png` | **Examples 2** + **Furthest first**로 뒤집은 목록 | ⓑB5 |
| `b05_two_intents.png` | intent 두 개(15 · 20)와 `Uncategorized 68` | ⓑB6 |
| `b06_scratch_form.png` | `+ New intent` 맨땅 폼 — **STARTED FROM 없음**, 위치 문장은 그대로 | ⓑB6 |
| `b06_scratch_examples.png` | **모델이 쓴 예시 3개**(이탤릭) + 헤더 버튼이 **Update examples** · `Reuse a rule` · 🗑 | ⓑB6 |
| `b07_saved_history.png` | Save 뒤 — `unsaved`가 `current`로 바뀐 히스토리 | ⓑB7 |
| `b07_deploy_popover.png` | **Deploy 팝오버** — 한 문장 + **Not yet** / **Deploy and finish**. 상태 문구도 `I'm done`도 없다 | ⓑB7 |
| `c01_clay_board.png` | Clay 첫 화면 — `RULES 0 / 8000`, `VERSION HISTORY 1`의 `v0 Original (as delivered) · showing`, 리스트 제목 **All questions**, 헤더에 **Types** | ⓒC1 |
| `c03_rules_typed.png` | 핀 하나 + RULES 첫 문단을 친 상태(아직 Apply 전) | ⓒC3 |
| `c04_applied_reply.png` | Apply 뒤 — `This reply is under [Now (unsaved)]`, 응답 아래 접힌 룰 상자, `v1 · … · unsaved` | ⓒC4 |
| `c05_types_menu.png` | **Types** 메뉴 — Planning 42 / Translating 46 / Reviewing 54 / Drafting … | ⓒC5 |
| `c05_types_filtered.png` | **Drafting · 29 of 103** — 제목이 분류 이름으로 바뀌고 그 아래 정의문, 옆에 ✕ | ⓒC5 |
| `c06_saved_v1.png` | Save 뒤 — `v1 · {이름} · current`, 그 아래 `v0 Original (as delivered)` | ⓒC6 |
| `c07_deploy_popover.png` | Clay의 Deploy 팝오버 + 다시 쓰인 응답의 **왼쪽 바**, 소속 칩 없는 목록 | ⓒC7 |

## 다시 찍는 법

```bash
LD_LIBRARY_PATH=$HOME/.local/chromedeps/usr/lib64 SWAG_VIEWPORT=1920x1080 SWAG_SHOTS=/tmp/shots \
  node .claude/skills/run-swag/driver.mjs
```

`/study/admin` → R1 + passcode → **NIRVANA** → `Run demo · Simple SCORE`(또는 `· Simple Baseline`). 드라이버는 한 세션이 곧 한 브라우저라 **tmux로 띄워 두고 한 줄씩** 보내야 쿠키가 유지된다. `Deploy and finish`는 누르지 않는다 — 누르면 그 클론이 끝난다.

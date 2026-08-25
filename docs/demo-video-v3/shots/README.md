# 참고 화면 (2026-08-23 실측)

실제 데모 워크스페이스를 `Run demo · Simple Baseline`(clone `28764ad8…`)과 `Run demo · Simple SCORE`(clone `497c21bd…`)로 **이 대본 순서 그대로 끝까지 돌려** 채집했다. **1920×1080**, 개발 빌드(왼쪽 아래 "N" 배지는 본 촬영에는 없다 — 프로덕션 빌드로 찍는다).

라벨의 진실은 `01_PLAN.md` §5이고, 실측 응답문은 `03_SCENARIO.md` §5다. 이 폴더는 그것이 화면에서 어떻게 앉는지를 보여 준다.

## Ⓒ Clay

| 파일 | 무엇 | 비트 |
|---|---|---|
| `c01_board.png` | 첫 프레임 — `RULES 0 / 8000`(플레이스홀더), `VERSION HISTORY 1` 의 `v0 Original (as delivered) · showing`, 목록 제목 `All questions`, 헤더에 `Types` | C0 |
| `c02_search_spell.png` | `spell` 검색 → `7 of 103`, **행 본문의 `spell` 이 노랗게 하이라이트**, 뷰어에 `This reply is the one that was delivered.` 와 한 줄 답 | C1–C2 |
| `c03_pinned.png` | `Kept in view 1` 선반 · *Stays here whatever you have selected* · `· 1 kept above` | C3 |
| `c04_rule1_typed.png` | 문단 1을 친 상태(아직 Apply 전), `180 / 8000` | C4 |
| `c04b_after_apply.png` | Apply 뒤 — `This reply is under [Now (unsaved)]`, 접힌 룰 상자, 한 줄 + 예문 답, `v1 · … · unsaved` | C4 |
| `c05_definition_clipped.png` | **`define social anxiety` 가 같은 두 줄로 나온다** — 관찰 ②가 화면에 잡힌 프레임 | C5 |
| `c06_when_narrowed.png` | When을 좁혀 Apply한 뒤 — 정의가 **여전히 두 줄** | C6 |
| `c07_after_rule2.png` | 문단 2 뒤 — 정의 답이 세 문장 + 용례로 자란다. 문서가 두 문단 | C7 |
| `c09_types_menu.png` | `Types` 메뉴 전체 — Planning 42 / Translating 46 / Reviewing 54 / Drafting 29 와 하위 카운트 | C9 |
| `c09b_types_shorten.png` | **`Shorten / Trim · 8 of 103`** — 제목이 분류 이름으로, 그 아래 정의문, 옆에 ✕ | C9 |
| `c09c_after_rule3.png` | 문단 3 뒤 — 답이 재작성본이 아니라 **자를 후보와 이유** | C9 |
| `c10_saved.png` | Save 뒤 — 맨 윗행이 `current` | C10 |
| `c10b_deploy_popover.png` | Deploy 팝오버 — 한 문장 + `Not yet` / `Deploy and finish` | C10 |

## Ⓢ Slate

| 파일 | 무엇 | 비트 |
|---|---|---|
| `s01_board.png` | 첫 프레임 — `+ New intent`, `Uncategorized 103` 이 **이미 열려 있고** `THEN` 만, 전 행에 `● Uncategorized` 칩, 헤더에 **`Types` 없음** | S0 |
| `s02_search_spell.png` | `spell` 검색 → `7 of 103` | S2 |
| `s03_create_form.png` | 행 `+` 로 연 폼 — `○ New intent` · *Read before "Uncategorized", so any of its 103…* · `STARTED FROM` 카드 · `WHEN A QUESTION…`(placeholder `asks for…`) · `Starter sets` | S3 |
| `s03b_judging.png` | **판정 중** — 리스트 헤더 *working out where questions go*, 행마다 칩이 붙어 간다 | S3 |
| `s04_furthest_first.png` | **`Furthest first`** 로 뒤집은 목록 — 맨 위 `P38 · 1` / `P29 · 5` (정의 질문 두 개) | S4 |
| `s05_when_edited.png` | When을 좁혀 Apply한 뒤 — 16 → 15, `v2 · … · unsaved` / `v1 · … · 4m ago`, 엉뚱한 질문 셋이 들어왔다 | S5 |
| `s05b_viewing_v1.png` | `v1` 행을 연 **읽기 전용** 보드 — Apply/Save·Undo/Redo가 사라지고 `Restore` · `Latest` 등장 | S5 |
| `s05c_restore_confirm.png` | 확인 줄 **`Back to setup 1, dropping what came after?`** + `Restore` / `Cancel` | S5 |
| `s05d_after_restore.png` | 되돌린 뒤 — **v2가 사라지고** `VERSION HISTORY 1`, 목록이 원래대로 | S5 |
| `s06_form_above.png` | `P29 · 5` 행의 `+` 로 연 폼 — 위치 문장이 *Read before “{단어 intent 제목}”, so any of its {그 수} questions can come here, and anything below it this also describes…*(샷에는 실측값 "Word spelling and usage" / 16이 찍혀 있다 — **런마다 다르다**), `Reuse a rule` 이 이번엔 있다 | S6 |
| `s06b_two_intents.png` | intent 두 개 — 정의(8)가 **위**, 단어(9)가 아래, `Uncategorized 86` | S6 |
| `s07_definition_reply.png` | `This reply is under [v1 · {이름}]`, 접힌 상자에 그 intent의 Then, 오른쪽 막대가 intent 색 | S7 |
| `s08_scratch_form.png` | `+ New intent` 맨땅 폼 — **`STARTED FROM` 없음**, 핀 선반에 `P29 · 8` | S8 |
| `s09_starter_sets.png` | **`Starter sets`** 메뉴 — 카운트가 **이 자리가 가로챌 더미** 기준으로 작다(Shorten / Trim **7**) | S9 |
| `s09b_final_board.png` | 세 intent + 자동으로 채워진 WHEN + **모델이 쓴 Examples 3**(`Update examples`) + 자를 후보를 짚는 답 | S9 |
| `s10_deploy_popover.png` | Deploy 팝오버 | S10 |

## 다시 찍는 법

```bash
LD_LIBRARY_PATH=$HOME/.local/chromedeps/usr/lib64 SWAG_VIEWPORT=1920x1080 SWAG_SHOTS=/tmp/shots \
  node .claude/skills/run-swag/driver.mjs
```

`/study/admin` → R1 + passcode → **NIRVANA** → `Run demo · Simple Baseline`(또는 `· Simple SCORE`).
드라이버는 한 세션이 곧 한 브라우저다 — **FIFO로 띄워 두고 한 줄씩** 보내야 쿠키가 유지된다:

```bash
mkfifo /tmp/drvin; (tail -f /dev/null > /tmp/drvin &); node .claude/skills/run-swag/driver.mjs < /tmp/drvin > /tmp/drvout 2>&1 &
printf 'nav /study/admin\n' > /tmp/drvin
```

- 행의 📌 를 이름으로 클릭하면(`click Keep this one in view`) **첫 행이 눌린다** — 행을 특정하려면 `eval` 로 그 `li` 안의 버튼을 찾아 누른다.
- `RULES` 에 **빈 줄이 든 여러 문단**을 넣으려면 `fill` 로는 안 된다(개행을 못 보낸다). React 세터로 직접 넣고 `input` 이벤트를 쏜다.
- **`Deploy and finish` 는 누르지 않는다** — 누르면 그 클론이 끝난다.

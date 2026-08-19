# 파일럿 후속 구현 계획 (2026-08-18)

> 결정(2026-08-18): ④ 채택 · ⑦ 채택 · ⑩ = (c) 시간을 따로 안 늘리고 ②④⑤로 줄인다 · ⑫ 제외(이미 반영) · ⑧ 보류(아래 W8) · 나머지 전부 적용.
> 원칙: **새 UI 텍스트는 요소당 한 줄 이하**, 설명은 툴팁으로. 후보 목록·근거는 `docs/PILOT_FEATURE_CANDIDATES.md`.

| # | 작업 | 상태 |
|---|---|---|
| W1 | 배포 전 "rule 없음" 게이트 (①) | ✅ `DeployModal.tsx` — footer 한 줄 + `Deploy anyway`. 서버는 이미 ruleless를 로깅 중이었음 |
| W2 | Apply 직후 같은 set 질문 2개 자동 프리뷰 (②) | ✅ `RuleWorkbench.tsx` `spreadFor` — 새 패널 없이 기존 탭에 채움 |
| W3 | fold 검토 목록 (③) | — 결정 원장 커밋으로 이미 구현("· N to teach", delta) |
| W4 | 부모 rule Apply → 안 건드린 자식 follow (④) | ✅ `rule-versions/route.ts` `followEnclosed` + 워크벤치 한 줄 + `rule_follow` trail kind |
| W5 | type 헤더 "No default rule" 칩 (⑤) | ✅ `IntentBoard.tsx` |
| W6 | fold 리뷰 "Rename to …" 체크 (⑥) | ✅ `FoldReviewModal.tsx` + `IntentWorkbench.applyFold(renames)` |
| W7 | propose 프롬프트 — 강제 3줄 → 1줄 (⑦⑧) | ✅ 측정 후 기본값 변경. §아래 |
| W9 | 계측 (⑬) | ✅ `strength` on rule_save · `proposal_dismiss` ui-event. 핀 이유 원문은 **이미** 있었음 |

**W7/W8 측정 결과 (2026-08-19)** — 같은 시나리오 12생성 × 4설정, compliant/partial/violation:
세 줄(기존) **8/4/0** · 미완성-예시 한 줄만 **9/3/0** · 추상 표현 **3/8/1** · 전부 제거 **1/11/0**.
JELSON 실제 앵커 3개(빈 rule 첫 수정): 한 줄 **15/3/0** vs 세 줄 **8/10/0**.
→ 기본값 = 한 줄. 상한·pushback 강제 삭제(모델이 알아서 쓴다). 재현: `npx tsx scripts/score/propose-eval.ts --devices all|goal|off [--emptyrule]`.

**⑦ 적용 조건 금지 · ⑨ 앵커 인용 금지 (2026-08-19 2차 라운드, 완료)**
- 강도 사다리를 **트리거 폭 → 행동 서술 깊이**로 교체 + "이미 매치된 요청에만 실행되니 적용 조건을 쓰지 말라" 명시. `buildProposeSystemPrompt(scope,{scoping})` 기본 `'behavior'`, `'trigger'`가 구 텍스트(baseline scope는 항상 trigger — 단일 프롬프트는 적용 조건이 필요하다).
- **30생성/arm: 준수 25/5/0 vs 구 24/6/0(동률). 조건절로 시작한 rule 12/18 → 0/18, 과제 주제어를 담은 rule 2/18 → 0/18.**
- **1차 시도는 실패해서 고쳤다**: minimal을 "행동만"으로 두자 canonical **2/2/2**(구 4/2/0) — 금지만 있는 rule은 모델이 대체물로 완성 문장을 고른다. "대신 무엇을"을 모든 등급에 복원 → canonical **10/2/0** vs trigger 7/5/0.
- ⑨: 프롬프트 한 줄 + 라우트의 `quotesAnchor`(n-gram 길이 = 앵커 단어수, 최대 5; 4단어 미만 앵커는 건너뜀) → 인용한 변형만 제외, 전부 인용이면 전부 통과. 금지 전 39개 rule 중 1건 인용, 금지 후 0건. 실측상 프롬프트만으로 막히므로 **라우트 필터가 실제로 발동하는 것은 관측하지 못했다**(검출기는 파일럿의 실제 유출 사례와 손수 만든 케이스로 검증, 39개 정상 rule에 오탐 0).

**W9d — trail export (2026-08-19, 완료)**: `rerates.csv` 신설 — 재판정 **패스 1개당 1행**(샤드는 합산, 사이에 다른 설정 행위가 없으면 같은 패스), 원인(fold_apply/intent_update_definition/…/rerun), 판정 질문 수, moved_in/out, 결정 hold/dont, **regressed**(직전 패스 대비 무너진 결정 수 — 어떤 이벤트 하나도 갖지 못하는 값). 파일럿(08-17)은 `membership`/`decisions` payload가 생기기 전이라 이동 열이 **빈칸**(0이 아니라 빈칸 — "기록 안 됨"과 "안 움직임"을 구분). WOOK 트레일에서 실제 값 확인(44문항 판정, +19/−3, hold 1). 나머지 §6.9–14(피드백 원문·실제 라우팅·응답·message_text·검토 세트·핀 이유)는 **이미 구현돼 있었다.**

**앱에서 확인한 것**(scratch assignment, 픽스처 purge 완료): 배포 게이트 문구·`Deploy anyway`, type 칩, 부모 저장 시 `Also updated: ZZ Fresh · Changed since: ZZ Parent`(자식/손자 follow, 편집된 자식 보존, 진단이 갈라진 노드에서 가지치기), 저장 버전에 앵커 외 2개 응답 저장(=W2), fold 리뷰의 `Rename to` 체크 → 실제 개명, `rule_save` payload의 `strength: minimal`·`followed`·`diverged`.
`proposal_dismiss`는 클라이언트 발화와 라우트 화이트리스트·문자열 일치까지 확인(영속화는 study clone에서만 일어나며 clone은 건드리지 않음).

계획된 항목은 전부 반영됐다. 남은 판단거리: ⑪ type 경계(v7 근간이라 본 스터디에선 인터뷰 문항으로만), ⑩(a) intent pre-seed는 (c)를 택해 보류.

---

## W1. 배포 게이트
- `DeployModal.tsx`: `status.live`에서 rule 없는 set(활성·비템플릿)과 rule 없는 type root를 센다.
- 0개가 아니면 footer에 **한 줄**: `⚠ 7 without a rule — those questions get no instructions: Draft Prompt Essay, Proofread, +5` (툴팁에 전체 목록). Deploy 버튼 라벨은 `Deploy anyway`; 옆에 `Write rules` 텍스트 버튼(모달 닫기).
- `deploy` 이벤트 payload에 `rulelessSets`, `rulelessRoots` 카운트 추가.

## W2. 교차 프리뷰
- `chooseVariant` 성공 직후(그리고 direct "Apply edit" 경로) `scopedRows`에서 activeId를 뺀 앞 2개(subtype이 다른 것 우선, 없으면 순서대로)를 골라 `generateUpdated(ids, rule, gen)` 호출. 새 패널·문구 없음 — 기존 탭에 응답이 채워지고, 응답이 있는 탭에 점(·) 표시(있으면 그대로).
- 비용: 선택당 프리뷰 2회. `simulating` 중 중복 호출 방지는 `genRef`로 이미 처리.

## W4. 부모 rule follow (설계 §3.5 carve-out — 결정됨)
서버 `rule-versions/route.ts` MAJOR 분기:
1. 업데이트 전 `prev = norm(intent.rule)` 저장 (`norm(null) = ''`).
2. 같은 type의 활성·비템플릿 intent를 읽고, 이 intent(또는 type root면 그 type 전체)의 **서브트리**를 BFS.
3. `norm(child.rule) === prev`인 자식 → `rule = 새 텍스트`, `score_rule_versions`에 `{versionNo: max+1, source: 'follow', name: "Follows {부모 title} v{n}", minor: false, anchor null}` 삽입. 나머지(다른 텍스트) → `diverged`.
4. 응답 `{ version, followed: [{id,title}], diverged: [{id,title}] }`; 자식마다 `rule_follow` 이벤트.
5. `source` enum에 `'follow'` 추가(zod · 클라 `RuleSource` · `trail.ts` — seed처럼 건너뛰지 말고 `rule_follow`로 기록).
클라 `RuleWorkbench.saveVersion` 성공 후 Apply 버튼 아래 **한 줄**: `Also updated: A, B · Changed since: C` (C는 클릭 → 그 set의 Revise). 확인 대화상자 없음(따라가는 게 규칙이지 옵션이 아님). 원칙 문장은 툴팁: "A set answers like the set around it until you give it its own rule."
부수: 자식의 미적용 minor 체인은 follow major 뒤로 밀림(기록은 남음). `RuleOrigin` 칩은 손대지 않아도 정직해짐. 배포 스냅샷은 live rule을 읽으므로 자동 반영.

## W5. type 헤더 칩
- `IntentBoard.tsx` type 섹션 헤더(≈424행): root rule이 비면 amber `SmallChip` `No default rule` — 툴팁 "Questions no set claims get no instructions. Click to write one." 클릭 → `setRootReviseTarget`(앵커 = 그 type의 첫 Uncategorized 질문; 없으면 비활성).

## W6. 제목 넛지
- `FoldReviewModal.tsx`: `suggestedTitle`이 현재 제목과 다르고 `after.length ≥ 1.5 × before.length`일 때 체크박스 한 줄 `Rename to "…"` (기본 해제). 체크 시 `IntentWorkbench` apply에서 title 함께 저장(현재는 제목이 빌 때만 자동 적용 — 1076행).

## W7. propose 프롬프트 (⑦ + ⑨)
- `buildProposeSystemPrompt`, scope `intent`/`type-root`: 추가 — "The prompt runs only AFTER the request has been matched to this intent. Do not write an applicability condition ('When a student asks…', 'This applies to… but not…'); state the behavior for these requests directly." 빈 rule 사다리를 **행동 서술 깊이**로 바꿈(minimal = 입력이 요구한 행동만 / moderate = + 가까운 경우의 응답 형태 / aggressive = 완결된 stance). `prompt` scope는 그대로.
- ⑨: "Never quote or paraphrase the anchor message." + `propose/route.ts`에서 변형 텍스트에 앵커의 6-단어 이상 n-gram이 있으면 1회 재생성.
- 재측정: `npx tsx scripts/score/propose-eval.ts` 기본 시나리오 + JELSON 앵커(7062/130081, 7064/130025, 7059/129947; `--assignment/--message/--intent/--feedback`)로 08-04 기준(11/1/0)과 비교. 떨어지면 문구 조정 후 재측정.

## W8. 강제 장치 — 결정 대기
프롬프트가 모든 변형에 강제하는 세 문장: ① 재요청 대응 한 줄 ② 숫자 상한 하나 ③ 예시는 미완성(빈칸 `___`). 선택지 (a) 유지+표시 / (b) 피드백이 요구할 때만 / (c) 빈 rule의 첫 라운드에만 + 참가자가 지운 장치는 다시 안 넣기 + ③은 형태("___") 대신 목표("붙여넣을 수 없게")만. **추천 (c)** — 텍스트를 더하지 않고, 08-04 실측 근거(첫 rule의 강제력)를 유지하며, JELSON이 겪은 재유입을 막는다. 결정 후 W7과 같은 하네스로 재측정.

## W9. 계측
- (a) `chooseVariant` → rule-versions POST에 `strength` 동봉, 라우트가 `rule_save` payload에 기록.
- (b) `ProposalPreviewModal.onClose` → `proposal_dismiss` 이벤트(`POST …/score/events`, kind 화이트리스트).
- (c) `pins/route.ts` `pin_set` payload에 `reason` 원문(현재 `hasReason`만 — 재핀 시 이전 이유 소실).
- (d) trail export: `revise_submit`/`rule_save`에 instruction 원문, block-test.csv에 실제 라우팅·응답(`study_generated_responses.applied`), timeline에 `message_text` 열, 검토 세트 목록, fold별 flip 리포트(`scripts/score/fold-flips.ts`, `score_intent_ratings` 해시 이력) — 분석 도구라 마지막.

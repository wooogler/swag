# Rule Workbench 개선 계획 (v2)

작성: 2026-08-04 · 상태: **§1–§5 구현 완료** (2026-08-04, 같은 날 5개 커밋: §1 버그 → §2 변형 모달 → §3 rewrite 의도 → §4 타임라인 통합 → §5 preview 병합; §6은 후순위로 미구현) · 대상 브랜치: score-v7
선행 문서: `docs/SCORE_v7_intent_tree_design.md` (트리/체인 아키텍처), `docs/STUDY_BASELINE_SPEC.md` (baseline parity 제약)

## 0. 문제 정의

데모에서 관찰된 문제 네 가지와 그 원인:

1. **피드백/Rewrite로 만든 rule이 의도한 응답을 바로 만들지 못한다.**
   - propose 시스템 프롬프트가 `MINIMAL EDIT`를 강제한다 — 변경 폭 조절 수단이 없다
     (`src/app/api/.../intents/[intentId]/propose/route.ts:77`).
   - propose는 완전히 stateless: 이전 피드백 교환 내용을 전혀 모른다. "더 강하게"류 후속 피드백이 작동하지 않고, 같은 피드백을 반복해야 한다.
   - Rewrite 모드는 전/후 응답 텍스트만 비교해 의도를 추론한다 — 사용자가 왜 고쳤는지는 어디에도 없다.
2. **피드백이 rule에 만든 변경이 보이지 않는다.** 제안 rule 전문이 채팅 카드에 나오지만 diff가 없어 작은 수정은 식별 불가. 변경된 rule이 다른 쿼리 응답을 어떻게 바꾸는지도 선택 전에 볼 수 없다 (제안은 무조건 minor 버전으로 즉시 기록됨, `RuleWorkbench.tsx:519`).
3. **Rule을 저장해도 대시보드에 적용된 모습이 안 보인다.** → §1, 버그 확정. 원인 6개 병존.
4. **Version History(좌측 아코디언)와 채팅(우측 패널)의 역할 중복.** 채팅은 세션 로컬(React state, `RuleWorkbench.tsx:198`)이라 재오픈 시 소실되는 반면, 모든 제안은 이미 `score_rule_versions` minor 행으로 영속화된다(name/note/rule/source/anchorMessageId 포함). **유실되는 유일한 정보는 사용자가 입력한 피드백 원문뿐.**

## 1. [P0 · 버그] Rule 저장이 대시보드에 반영되지 않음

### 확정된 원인 (탐색 결과)

| # | 원인 | 위치 |
|---|------|------|
| A | 버전별 응답을 여러 쿼리에 영속화하는 `/rule-versions/[versionNo]/apply` 라우트에 **클라이언트 호출처가 0개** (커밋 f337d78에서 호출부 삭제된 데드 코드). Save 시 `score_rule_version_responses`에는 앵커 1행만 기록됨 (`rule-versions/route.ts:217-227`) | `apply/route.ts` 전체 |
| B | **Type-root rule은 보드에 표시 수단이 아예 없음.** `type_default` 쿼리는 `selectedOwnerId`가 null이라 버전 dropdown 자체를 fetch하지 않고 (`IntentBoard.tsx:1673`), type 섹션 헤더는 rule 텍스트를 렌더하지 않음 (`:2458-2534`). v7에서 intent가 없는 초기엔 모든 쿼리가 type_default → **데모에서 "저장해도 아무 변화 없음"의 가장 유력한 경로** | `IntentBoard.tsx` |
| C | 저장된 응답이 Revise를 연 쿼리가 아니라 **활성 탭**에 귀속됨 (`simulate()`가 `anchorMessageId: activeId` 전송, `RuleWorkbench.tsx:482`) | `RuleWorkbench.tsx` |
| D | 앵커 preview 생성이 실패하면 major가 **응답 0건으로 저장**됨 (`rule-versions/route.ts:217`의 조건부 insert) | 서버 |
| E | 워크벤치 닫기 시 bare `router.refresh()`만 호출 — intent 워크벤치가 쓰는 `startBoardRefresh`(transition + 상태 표시줄) 미사용이라 수 초간 구 화면이 무표시로 유지 (`IntentBoard.tsx:2167-2173`, root 경로 `:2246-2249`) | `IntentBoard.tsx` |
| F | `latestRuleVersion`("Then v2 · 이름" 칩)이 page.tsx에서 계산되지만 (`page.tsx:270-288`) 보드에서 **렌더되지 않음** (DeployModal만 소비) | `IntentBoard.tsx` |

참고: 라이브 rule 자체(`score_intents.rule`)는 정상 갱신되고, matched intent 선택 시 "Then" 블록과 hover 카드에는 새 텍스트가 나온다. 안 보이는 것은 **rule의 효과(재생성 응답)와 저장 증거**다.

### 수정안

1. **워크벤치에서 이미 생성한 응답을 Save 시 영속화** — `saveVersion()` 성공 후, 세션의 `updated` 맵 + `latest.updatedResponse`를 모아 기존 `/rule-versions/[versionNo]/apply`의 `{responses[]}` 모드(≤50건, 사전생성분 저장)로 POST. **추가 LLM 비용 0**, 데드 라우트 부활. 이후 보드 viewer dropdown이 해당 쿼리들에 나타남.
2. **type_default 쿼리의 owner를 type root로 해석** — `IntentBoard.tsx:1673`의 `res.kind === 'matched' ? res.intentId : null`을 root intent id까지 확장. rule-versions 라우트는 root에도 이미 동작.
3. **Type 섹션 헤더에 root rule 표시** — rule 요약 + `latestRuleVersion` 칩 + (이미 있는) Edit rule 진입.
4. **Intent 행에 `latestRuleVersion` 칩 렌더** — 데이터는 이미 내려옴 (`IntentSummary.latestRuleVersion`).
5. **닫기 refresh를 `startBoardRefresh`로 감싸기** — `reviseTarget`/`rootReviseTarget` 양쪽 (`:2167-2173`, `:2246-2249`).
6. (C 완화) 1번이 탭별 응답을 모두 영속화하므로 앵커 불일치 문제는 자연 해소. 추가로 Save 시 앵커를 `row.messageId`(연 쿼리)로 고정하는 것 고려.

## 2. [P1] 제안 강도 3단계 + 변형 선택 Preview 모달

“피드백 → 항상 최소 수정 1개 → 즉시 minor 기록”을 “피드백 → **강도별 변형 3개** → **응답 미리보기로 비교** → 선택한 것만 기록”으로 바꾼다.

### 서버 — propose 라우트

- `PROPOSAL_SCHEMA`를 3-변형 배열로 교체:
  ```
  { variants: [ { strength: 'minimal'|'moderate'|'aggressive',
                  revised_rule, title, note } ] }  // 정확히 3개, 순서 고정
  ```
- 시스템 프롬프트의 `MINIMAL EDIT` 단일 지시(`propose/route.ts:77`)를 3단 지시로 교체:
  - **minimal**: 현행 그대로 — 입력이 요구하는 것만 고치고 나머지는 verbatim 보존.
  - **moderate**: 피드백이 닿는 절을 재구성·강화. 지시가 실제로 관철되도록 “대신 무엇을 할지 / 언제 적용되는지”까지 명시.
  - **aggressive**: 피드백의 원칙을 중심에 두고 프롬프트 전체를 재저작. 재구성·중복 병합·상충 문구 삭제 허용. (→ “기존 룰의 영향이 너무 컸다” 문제의 직접 해법)
- 호출 1회로 3개 반환 (입력 토큰 1×, 출력 ~3×). `mode: 'feedback' | 'rewrite'` 공통 적용.

### 클라이언트 — `ProposalPreviewModal` (신규 컴포넌트)

- propose 성공 시 모달 오픈. 변형별 3컬럼(또는 탭):
  - 상단: strength 라벨 + title + note
  - 중단: **현재 rule 대비 word-diff** (신규 diff 유틸, 외부 의존성 없이 ~40줄 LCS — 채팅 카드에도 재사용)
  - 하단: 활성 쿼리의 재생성 응답 — `/preview`에 `draftRule=variant.rule`로 3건 병렬 요청 (기존 draft 경로, 비캐시)
- 액션: 변형 선택 → minor 버전 기록. `simulate()`를 확장해 **사전생성 응답을 받으면 재생성을 생략**(현재는 무조건 `fetchPreviews` 재호출, `RuleWorkbench.tsx:473`).
- 취소 → 아무것도 기록 안 함. 피드백 입력은 **선택 시에만** 비움(현행 `setFeedback('')` 위치 이동) — 취소 후 문구를 고쳐 재시도 가능.
- 채팅: 전송 시 user 엔트리, 선택 시에만 agent 카드(+버전 칩). 
- 비용: 제안당 preview 3회(현행 1회 → +2회). 온디맨드라 수용 가능.

## 3. [P1] Rewrite 의도 추출 단계

exclusion-reasons 패턴(`exclusion-reasons/route.ts` — out 라벨 시 이유 3개 제안 → 선택 → fold의 연료)을 rewrite에 이식한다.

### 서버 — `POST .../intents/[intentId]/rewrite-intents` (신규, exclusion-reasons 복제 후 수정)

- 입력: `{ messageId, currentResponse, editedResponse }`
- 출력: `{ intents: string[] }` — 전/후 응답의 실제 차이에 근거한 **일반화 가능한 변경 의도** 3–4개, 각 ≤15단어, 서로 다른 각도 (예: “정답 대신 유도 질문으로 끝내기”, “응답을 절반 길이로”, “학생 시도 먼저 요구”).
- reasoning effort `'low'` — exclusion-reasons와 동일하게 1–2초대.

### 클라이언트 — rewrite 패널 2단계화

- 현행: 응답 수정 → [Propose rule from my rewrite] 즉시 propose (`RuleWorkbench.tsx:1213-1237`).
- 변경: 버튼 클릭 → rewrite-intents 호출 → 패널 안에 **의도 칩 목록(복수 선택) + 직접 입력 + [건너뛰기]** 표시 → 확정 시 propose에 `changeIntents: string[]` 동반.
- propose rewrite 분기에 추가: `INSTRUCTOR'S CONFIRMED INTENTS BEHIND THE REWRITE (fold each in as a durable, generalizable instruction)`. 수정된 응답 자체는 근거(evidence)로 유지.
- zod: `changeIntents: z.array(z.string().trim().max(200)).max(6).optional()`.

## 4. [P2] 채팅 영속화 + Version History 통합

### 4a. 영속화 — 별도 채팅 테이블 대신 **버전 행에서 재구성**

제안이 이미 전부 `score_rule_versions`로 영속화되므로, 유실분(피드백 원문)만 버전 행에 싣는다:

- `score_rule_versions`에 `instruction text` 컬럼 추가 (스키마 + `intent-store.ts:243-257`의 late-add 패턴으로 DDL 패치).
  - `source='feedback'` → 피드백 원문 · `'rewrite'` → 확정된 changeIntents(줄바꿈 join) · `'direct'` → null.
- `rule-versions` POST가 `instruction`을 받아 저장; `simulate()` 호출부에서 전달.
- 워크벤치 마운트 시 채팅을 빈 배열이 아니라 **버전 목록에서 재구성**: seed → 시스템 카드, minor/major → user 버블(instruction) + agent 카드(title/note/diff/버전 칩), major → “Saved — v2” 구분선. → **“채팅이 이어지는가?”에 대한 답: 현재는 아니오, 이 작업 후 사실상 예.**
- 트레이드오프(수용): revert는 버전 행을 삭제하므로 재구성 채팅에서도 해당 교환이 사라진다(git-reset 의미론과 일치). propose 실패 교환은 원래 버전이 없으므로 재현 안 됨.

### 4b. UI 통합 — 타임라인 단일화

- 좌측 History 아코디언(`RuleWorkbench.tsx:977-1040`) 제거. 우측 패널이 유일한 히스토리: 체크아웃(기존 `jumpToVersion`), Revert, 현재 위치 표시 모두 타임라인 위에서.
- 좌측은 WHEN + rule 텍스트박스 + Apply edit/Save + “현재 vX” 라벨만 — rule 편집 공간 확대.
- agent 카드의 rule 전문(`:1345-1349`)을 **diff 표시로 교체**(§2 diff 유틸 재사용, 전문은 토글).

### 4c. propose에 대화 히스토리 주입 (4a 이후 무료로 얻는 개선)

- propose 호출 시 최근 교환 ~6개(`instruction` + `note` 쌍)를 `PRIOR REVISIONS ALREADY MADE THIS SESSION`으로 프롬프트에 포함 → “더 강하게”류 후속 피드백이 작동, 반복 피드백 문제 해소.

## 5. [P2] Add example ↔ Preview 통합

“Add example(빈 피커, 저사용)”과 “Preview(열람 전용 전체 적용 뷰)”를 하나의 표면으로:

- `RuleApplyPreview`를 확장: 좌측 쿼리 리스트에 **행별 체크박스 + [N개를 example로 추가]** 푸터. 선택 시 `addExamples(ids)` 호출 후 워크벤치로 복귀, 새 탭 활성화 → 그 자리에서 피드백/rewrite로 수정. (나쁜 응답을 **본 다음** 끌어와 고치는 흐름 — Add example의 발견 가능성 문제 해결)
- 진입점 단일화: 상단 “Preview” 버튼이 이 표면을 열고, 탭 스트립의 “+ Add example”도 같은 표면으로 (SCORE 모드에서 `QueryPicker` 진입 제거).
- afterRule은 현행대로 최신 작업 상태(`latest.rule`), before는 deployed 유지.
- **baseline(promptMode)은 현행 유지** — 수동 review set 구축이 ablation 설계의 일부(`STUDY_BASELINE_SPEC.md`)이므로 체크박스 추가는 `!promptMode` 게이트. `QueryPicker`는 promptMode 전용으로 존속.

## 6. 추가 아이디어 (선택, 후순위)

1. **응답 부분 선택 피드백** *(2026-08-04 구현됨)*: 응답 텍스트 드래그 → 플로팅 “Quote in feedback” 버튼 → 피드백 박스에 인용 삽입(“Regarding this part: …”) — LLM 그라운딩 정밀화. API 무변경(인용은 피드백 텍스트의 일부).
2. ~~**intent별 누적 원칙(standing constraints)**~~ *(보류 — §4c 히스토리 주입이 회귀를 상당 부분 방지하므로 과설계로 판단, 2026-08-04)*
3. ~~**Judge 재활용 검증**~~ *(보류 — 비용 대비 효과 미검증, 2026-08-04)*

## 7. 구현 순서 (각 단계 독립 배포 가능)

| 순서 | 내용 | 주요 파일 |
|------|------|-----------|
| **0** | §1 버그 수정 일괄 | `IntentBoard.tsx`, `RuleWorkbench.tsx`, (서버 무변경 — apply 라우트 재사용) |
| **1** | §2 3-변형 + Preview 모달 + diff 유틸 | `propose/route.ts`, `RuleWorkbench.tsx`, `ProposalPreviewModal.tsx`(신규), `workbench-shared.tsx`(diff) |
| **2** | §3 rewrite 의도 추출 | `rewrite-intents/route.ts`(신규), `propose/route.ts`, `RuleWorkbench.tsx` |
| **3** | §4a 영속화 → §4b UI 통합 → §4c 히스토리 주입 | `schema.ts`, `intent-store.ts`, `rule-versions/route.ts`, `propose/route.ts`, `RuleWorkbench.tsx` |
| **4** | §5 Preview/Add example 통합 | `RuleApplyPreview.tsx`, `RuleWorkbench.tsx` |

## 8. 검증 시나리오 · 주의사항

- **버그 검증(§1)**: intent 쿼리에서 Revise → 피드백 1회 → Save → 보드 복귀: ① refresh 표시줄, ② 해당 intent 행 “Then vN” 칩 갱신, ③ 워크벤치에서 봤던 쿼리들의 버전 dropdown에 새 버전+응답. type_default 쿼리에서도 동일 시나리오(root rule).
- **rule 변경은 rating 무효화와 무관**해야 함(의도된 설계): `intentDefHash`는 definition만 해시 (`intents.ts:317-319`). §1 수정에서 rating 경로를 건드리지 말 것.
- **preview 캐시**: `rulePreviewHash`가 rule 텍스트를 키에 포함하므로 (`injection.ts:55-57`) §2·§5의 draft preview는 비캐시 경로 유지 — 캐시 오염 없음.
- **baseline parity**: `promptMode` 분기 UI 변경 금지(§5 게이트, §2·§3은 양쪽 공통 개선이므로 적용해도 조건 간 도구 성격이 달라지지 않는지 스터디 스펙과 대조 필요 — §2/§3는 SCORE·baseline 공통인 revision agent 개선이라 parity 유지로 판단).
- propose `maxDuration = 60` 내에서 3-변형 1회 호출 + 모달의 preview 3회는 별도 요청이므로 무관.

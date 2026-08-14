# Intent Workbench & Dashboard 개선 계획 (v3)

작성: 2026-08-11 · 상태: **계획 확정 — 구현 스펙은 `docs/INTENT_WORKBENCH_V3_IMPL.md` (커밋 13개 단위 작업 지시서)** · 대상 브랜치: study-tools
선행 문서: `docs/SCORE_v7_intent_tree_design.md` (트리/체인), `docs/RULE_WORKBENCH_V2_PLAN.md` (rule 축 버전 시스템 — 이번 변경 대상 아님)

요청 6개 항목. **DB 마이그레이션 0건, 서버 변경은 C의 시드 파라미터 1건(additive)뿐** — 나머지는 전부 클라이언트. 유저스터디 직전 브랜치에서 안전한 이유다.

| # | 항목 | 대상 파일 |
|---|------|----------|
| A | 라벨 단순화 — In this intent는 out만, Needs decision은 probably in 탭만 + in만 | `IntentWorkbench.tsx` |
| B | 버전 시스템 — minor 제거, Apply = 임시 저장, Save = 버전 기록, undo/redo, diff 모달 + 인라인 diff | `IntentWorkbench.tsx` |
| C | 워크벤치 안에서 Create intent — out 무더기에서 sibling 스핀오프 (§C, 확정 대기) | `IntentWorkbench.tsx`, `IntentBoard.tsx`, (`intent-suggestions` 라우트) |
| D | 대시보드 — 4개 타입의 "New intent in …" 버튼 상시 노출 (+베이스라인 "New filter in …" 동일) | `IntentBoard.tsx` |
| E | 대시보드 — 동레벨 intent 순서를 drag & drop으로 (화살표 대체) | `IntentBoard.tsx` |
| F | ⚠ N 칩 클릭 → 쿼리 리스트 필터; 워크벤치에서 shadowed 쿼리 숨김 + send here 제거 | `IntentBoard.tsx`, `IntentWorkbench.tsx` |

---

## A. 라벨 단순화 — border 조정에만 집중시키기

### 현재 구조

- 두 패널의 모든 행이 같은 `pinButtons()`(in · send here · out)를 렌더한다 (`IntentWorkbench.tsx:1752-1810`). 대화 뷰 헤더도 동일 (`:1833-1840`).
- Needs decision은 `ndFilter` 상태('in'|'out')로 **probably in / probably out 두 탭**이 리스트를 분할한다 (`:520-527`, 탭 UI `:2377-2406`). out 탭은 probably_out + legacy unsure + 미평가 행까지 받는 catch-all (`:1381-1387`).
- 탭별 정렬 상태가 각각 있다 (`ndSortIn`/`ndSortOut`, `:524-527`).

### 수정안

1. **In this intent 행 → out 버튼만.**
   - `pinButtons(row, pane)`로 시그니처 변경. `pane === 'in'`이면 out 버튼만 렌더.
   - 예외(legacy/철회 경로): 이미 `pinned === 'in'`인 행은 활성 in 필을 계속 보여줘 철회(클릭 undo)는 가능하게 한다. 새로 in을 찍는 진입점만 없앤다.
2. **Needs decision → probably in만, in 버튼만.**
   - `needsDecision` 정의를 `rating === 'probably_in'`으로 좁힌다 (`:1234-1245`). probably_out·unsure·미평가 행은 워크벤치에서 **완전 비노출**.
   - `ndFilter`/`ndSortOut`/`ndProbablyOut`/탭 UI 삭제 → 단일 `ndSort` (기본값은 지금의 in 탭 기본값 `out-like` — "가장 의심스러운 것 먼저" 유지).
   - 행 버튼은 in만. 예외: `pinned === 'out'`인 legacy 행은 활성 out 필만 보여 철회 가능.
   - 헤더 카운트·빈 상태 문구를 단일 리스트에 맞게 수정.
3. **대화 뷰 헤더**의 "label this question:"도 열린 pane 기준(`convo.pane`)으로 같은 단일 버튼을 렌더.
4. reason picker(overrule 시 이유 묻기)는 그대로 — ND에서 in은 probably_in을 overrule하는 것이므로 지금처럼 이유를 묻는다 (`disagrees()`, `:1151-1154`).

**트레이드오프(의도된 것):** in 패널에서 "확인 라벨(in)"과 ND에서 out 라벨이 사라지므로 fold에 공급되는 예시가 준다. 사용자가 결정한 스터디 설계(경계 조정에 집중)에 따른 것.

---

## B. 버전 시스템 — 워드프로세서 멘탈 모델

### 현재 구조

- Apply → `PATCH /intents/[id]` with `recordVersion: true, minorVersion: true` → config version에 `summary.minor: true`로 기록 (`IntentWorkbench.tsx:753-759`, 라우트 `[intentId]/route.ts:70,192`).
- Save → 같은 PATCH, minor 없이 → major. create의 첫 Apply는 무조건 major(v1, `create_intent`) — intent 등록 그 자체.
- versions 라우트가 intent별로 major(v1,v2,…)/minor(v2.1,…)를 넘버링 (`versions/route.ts:59-98`), 워크벤치 History가 major 밑에 minor 아코디언으로 접는다 (`IntentWorkbench.tsx:1358-1375`, `:2119-2153`).
- Save 활성 조건 `savePending = versions[0].minor === true` (`:1865`).
- diff 기준(base)은 기본 "최신 major", History의 diff 버튼으로 재지정 (`diffSel`, `:1287-1288`). 현재 spec 대비 entered/left를 **"New in this intent" / "Left this intent" 접이식 스트립**으로 In this intent 리스트 상단에 표시 (`:2256-2300`), 헤더에 +N/−N 칩 (`:2196-2210`).
- 체크아웃/리버트: History 행 클릭 → 그 버전 상태를 즉시 로드(해시 키 rating 저장소, LLM 0), Revert는 이후 스텝 삭제 (`:969-1039`).

### 수정안

**B-1. Apply = 임시 저장 (버전 기록 없음)**

- `persist()`에서 일반 Apply의 payload를 `recordVersion: false`로 변경 (`minorVersion` 전송 제거). 스펙은 지금처럼 즉시 영속(새로고침해도 작업본 유지 — 워드프로세서의 임시 저장)되지만 **버전 행은 남기지 않는다.**
- ~~예외 유지: create의 첫 persist는 major v1~~ → **예외 폐지 (2026-08-12 구현 중 사용자 피드백)**: 새 intent를 만들면 "적용됐지만 저장 안 됨" 상태로 열린다. create의 첫 persist는 `is_template=true` + `recordVersion:false` — 행은 있지만(평가가 붙을 곳이 필요) 보드에도 체인에도 없고 학생 쿼리가 라우팅되지 않는다. **Save가 그 intent를 만드는 행위**(is_template을 뒤집고 서버가 그 전환을 `create_intent` v1로 기록), **뒤로 나가면 purge**(가드 다이얼로그가 먼저 확인). 이유: Apply=시도/Save=확정 규칙에 예외가 있으면, 하필 그 규칙을 배우는 첫 순간에 Save가 비활성으로 보인다.
- **서버 변경 불필요**: PATCH의 `minorVersion`은 legacy로 계속 받아들이고(다른 호출처 없음 확인), `isMinorVersion()`(intent-store.ts:756)은 기존 참가자 데이터의 옛 minor 행을 계속 minor로 분류한다.

**B-2. Save 게이트 재정의**

- `savePending`을 "최신 항목이 minor인가"에서 **"영속된 spec이 마지막 major 스냅샷과 다른가"**로 변경: `versions.find(v => !v.minor)`의 `definition`(title 포함 여부는 아래) vs `savedRef.current`.
- 부수 효과(워드프로세서와 동일, 의도된 개선): undo로 마지막 저장 상태에 되돌아오면 Save가 다시 꺼진다. 동일 major 중복 저장 방지도 그대로 성립.
- title은 버전 없이 rename되므로(기존 동작) 비교는 definition 기준. label(pin) 변경은 Save 스냅샷에 자동 포함되므로(recordConfigVersion이 live pins를 읽음) 게이트에 넣지 않는다.

**B-3. Undo / Redo (세션 로컬)**

- `past[]` / `future[]` 스택에 **적용된 spec**({title, definition})을 보관. `apply()` 성공 시 직전 적용 spec을 `past`에 push, `future` 클리어.
- Undo: 현재 spec을 `future`에 push → 이전 spec을 `persist(silent, recordVersion:false)` + `fetchRatings`. 그 def_hash는 이미 평가돼 있으므로 **즉시 로드(LLM 0)** — 체크아웃과 같은 원리, 단 read-only가 아니라 작업본 자체가 바뀐다. (중단된 rate로 일부 stale이면 Apply 버튼이 살아나는 기존 메커니즘이 자연 복구.)
- Redo: 대칭.
- UI: definition 헤더의 Apply 옆에 Undo2/Redo2 아이콘 버튼. busy/saving/checkout 중 비활성.
- **범위**: definition/title만. pin·label은 클릭 즉시 영속되는 별도 축(교정 루프)이라 undo 대상이 아니다. 스택은 세션 로컬 — 새로고침 시 소실(워드프로세서의 undo 히스토리와 동일). 리로드 후 되돌리기는 History의 major 체크아웃/Revert로.

**B-4. History UI — major만**

- 렌더를 `versions.filter(v => !v.minor)`로 제한. `versionGroups` 아코디언·`groupToggles`·`versionLabel`의 `v2.3` 분기·`versionAction`의 'applied' 분기 삭제 → 한 줄 = 저장된 버전 하나 (`v1 created`, `v2 saved`, …).
- **작업본(draft) 행 추가**: `savePending`일 때 History 맨 위에 "저장 안 된 작업 상태" 행(● working — not saved yet)을 표시하고 'current' 칩을 여기로 옮긴다. 이때 최신 major 클릭은 (지금의 "최신=라이브로 복귀"가 아니라) 일반 체크아웃으로 동작; `savePending`이 아니면 지금처럼 최신 major가 current.
- Apply 툴팁 등 문구 수정: "kept (revertible from History)" → "kept as the working draft — Save records it as the next version" 류.
- 기존 DB의 minor 행은 그대로 두고 UI에서만 숨긴다 (export/metrics 스크립트 영향 없음).

**B-5. Diff — 모달 + 인라인 git-diff**

- **스트립 제거**: "New in this intent" / "Left this intent" 접이식 스트립(`:2256-2300`)과 `newOpen`/`leftOpen` 상태 삭제.
- **헤더의 +N/−N 칩을 diff 버튼으로**: GitCompareArrows 아이콘 + `+N · −N vs vK`. 클릭 → **DiffModal**.
- **DiffModal** (신규, `IntentDiffModal.tsx` 또는 워크벤치 내부 컴포넌트): 좌/우 2컬럼 — 왼쪽 "Left this intent (−N)" rose, 오른쪽 "New in this intent (+N)" emerald. 각 행은 쿼리 텍스트(+ 접기/펼치기) 읽기 전용. 기준 버전 표기(`compared to vK` — 기준 변경은 지금처럼 History의 diff 버튼).
- **인라인 diff (모달 닫힌 기본 상태)**: In this intent 리스트를 `[...현재 멤버, ...leftRows]`를 **하나로 합쳐 현재 정렬(sortRows)로 정렬**해 렌더. `newlyIn` 행은 emerald 배경/좌측 보더(git `+`), `left` 행은 rose 배경(git `-`)으로 제자리에 표시 — "정렬이 반영된 위치에서 무엇이 들어오고 빠졌는지"가 한 리스트에서 보인다. left 행은 `data.rows`에 있으므로 임베딩 점수·타임스탬프 정렬 모두 동작.
- left(빨간) 행의 버튼: **in 버튼 하나**(복구 경로 — 이 행은 이미 out이므로 out 버튼은 무의미하고, ND에도 없을 수 있어 여기가 유일한 복구 진입점). 일반/green 행은 A절대로 out만.

---

## C. 워크벤치 안의 Create intent — "out 무더기에서 스핀오프" (제안, 확정 대기)

근거: In this intent에서 out을 찍었다는 건 그 쿼리들을 담을 새 intent에도 관심이 있다는 뜻.

### 왜 child가 아닌가 (구조적 근거)

out 핀의 존재 이유는 fold로 A의 definition에 흡수되는 것이다. fold가 끝나면 A는 그 쿼리 q를 더 이상 claim하지 않는다. 그런데 v7 중첩 규칙상 **child는 부모가 claim하는 쿼리만 답할 수 있다** — 즉 out 쿼리들을 담으려고 만든 child B는 fold가 완료되는 순간 q에 영영 닿을 수 없고, 보드는 이를 이미 `↗ N` (outsideParent) 진단 칩으로 "고장"이라 부른다. child-from-outs는 태어나자마자 고장 나는 intent다. 반면 워크벤치의 scope 보장(부모가 claim하는 쿼리만 표시·평가) 덕에 out 쿼리는 **A의 부모 scope에는 남는다** → out들을 담을 수 있는 유일한 배치는 **sibling(같은 부모 밑)**.

단, "drilling으로 A 내부를 세분화"(child)는 별개의 정당한 행위다 — 그 문은 트리가 보이는 보드의 "New intent inside …"가 이미 담당한다. 원칙: **§3.2 "만드는 위치가 배치를 결정한다"를 워크벤치 안에서도 지킨다.** 워크벤치 전체는 배치가 모호하지만("A에서 만든다"가 subset인지 beside인지), **out 무더기는 모호하지 않다** — A를 떠나되 부모 scope에 남는 쿼리들 → sibling. 그래서 생성 버튼을 워크벤치 일반이 아니라 **out 무더기(corrections 카드)에 앵커**한다.

### 수정안 — 스핀오프 플로우

1. **트리거**: corrections 카드에 out 핀이 1개 이상일 때 버튼 노출 — "+ New intent from these N out queries". (in 핀만 있을 땐 비노출.)
2. **클릭** → `specDirty()`면 기존 `guardLeave` 확인 → **chooser 모달이 워크벤치 위로** 열린다(chooser는 워크벤치 조건부 밖에서 렌더, `IntentBoard.tsx:2905` — 보드 왕복 없음, 원래 구상했던 drilling UX 유지). scope = `{ type: A.type, parentIntentId: A.parentIntentId }` (**sibling**).
3. **제안 시드**: out 쿼리 텍스트 + why-not 이유들을 `/intent-suggestions`에 전달해 후보 definition을 생성. why-not 이유는 "무엇이 이 쿼리들을 A 밖으로 묶는가"의 서술 그 자체라 최고의 시드 재료다. (라우트에 `seedQueries[]` 파라미터 추가 — 소규모 additive 서버 변경 1건. 서버 무변경 폴백: 첫 out 쿼리를 anchorRow로 전달.)
4. **Create** → `setEditIntent(null)` + `openNewIntent(scope, seed)` — 워크벤치가 B의 create 모드로 re-key (overlap 칩의 `onEditIntent` 스왑과 같은 메커니즘). 이후는 기존 create 흐름 그대로(첫 Apply = v1 등록·평가). A의 out 핀은 **A에 그대로 남는다** — A의 border를 가르치는 것이 그들의 역할이고, 돌아와서 fold하면 루프가 완성된다(그 전까지는 B가 out들을 매치해도 A가 먼저 가로챔 — 대시보드의 ⚠ 칩(F-1로 클릭 가능)이 이 과도 상태를 정확히 보여주고, A를 fold하면 해소).
5. **체인 위치**: v1은 형제 목록 **끝**(현재 create 기본값 — 추가 기계장치 0). "A 바로 다음" 삽입은 provenance 가독성 폴리시로 선택 가능(create 후 `/placement` 1회 또는 POST create에 `afterIntentId` 추가) — 후순위.

**A 바로 앞 배치(즉시 라우팅 이동)는 채택하지 않음**: SCORE의 일관 원칙이 "교정은 definition이 흡수하기 전까지 학생에게 아무것도 바꾸지 않는다"이므로, 스핀오프가 fold 전에 라우팅을 옮기면 이 원칙과 충돌한다.

### 기각/보류한 대안

- **상단 바 범용 "+ New intent" + inside/beside 선택지** — §3.2가 없앤 배치 picker의 부활. 기각.
- **chooser 우회 직접 생성**(out 시드로 곧장 create 워크벤치) — 클릭은 줄지만 chooser가 "유일한 문"(빈 폼 방지 + 기존 definition 중복 방지)이라는 원칙을 깬다. 기각(단, 클릭 수가 문제 되면 재고 가능).
- **out 이유 선택 직후 행 단위 "이런 쿼리로 intent 만들기"** — 인지 순간과 가장 가깝지만 sweep 중엔 소음. phase 2 후보.
- **드래그로 꺼내기**(쿼리를 "새 폴더" 드롭존에 끌기) — 폴더 은유에 충실하나 다중 선택·hover 버튼과 충돌, 스터디 단순성에 반함. 보류.

---

## D. 대시보드 — 타입 레벨 New intent 버튼 상시 노출

### 현재 구조

`newIntentScope`가 **현재 selection에서** 배치를 읽어 (`IntentBoard.tsx:1910-1955`) 단 하나의 `NewIntentRow`가 선택 위치에만 렌더된다 — 타입 레벨은 `createsAtTypeLevel` 게이트 (`:2340-2341`, `:2392-2404`), intent 내부는 `createsHere` 게이트 (`:1727`, `:1865-1877`).

### 수정안

- 타입 섹션 렌더에서 `createsAtTypeLevel` 게이트를 제거하고 **4개 타입 섹션 각각의 트리 맨 아래에 `NewIntentRow`를 항상 렌더**: scope는 selection과 무관하게 `{ type: root.type, parentIntentId: null, buttonLabel: 'New intent in {label}' }`를 인라인 구성. (타입에 intent를 만드는 걸 장려하는 것이 목적이므로, 어떤 선택 상태에서도 4개 버튼이 보인다.)
- intent를 선택했을 때 그 안에 만드는 **"New intent inside …" 행은 지금처럼 selection-driven 유지** (`createsHere`).
- `newIntentScope` memo는 intent-scope 분기만 남기고 축소. anchorRow(제안 시드)는 지금처럼 전달 — 선택된 쿼리가 해당 타입 리스트에 보일 때만 시드가 되는 기존 가드 유지.
- **베이스라인 대칭(확정)**: `BaselineFilterTree`의 "New filter in {type}" 행도 같은 게이트(`scopeHere`, `IntentBoard.tsx:392-395`)로 selection-driven이다 — **게이트를 제거해 4개 타입 섹션에 상시 렌더** (AI-parity, 양 조건 동일 조치).

---

## E. 대시보드 — drag & drop 순서 변경

### 현재 구조

행 hover 시 [▲][▼][휴지통] (`IntentBoard.tsx:1794-1828`). ▲/▼는 `moveIntent(id, { beforeIntentId })` 호출 (`:1102-1131`) → `POST /placement` (reorder = major 버전 기록, 재평가 0 — §3.4). `position`은 double precision이라 서버가 이웃 사이 bisect.

### 수정안

- 외부 라이브러리 없이 (package.json에 dnd 의존성 없음 확인) **HTML5 native DnD**:
  - 행에 `draggable` + hover 시 좌측 GripVertical 핸들(화살표 자리). dragstart에 `{ intentId, parentIntentId, type }` 보관(state로 — dataTransfer 파싱 불요).
  - **동레벨 형제만 유효 타깃**(요청 범위): dragover에서 `parentIntentId`·`type`이 같은 행만 수락, 커서 상/하 절반으로 삽입선(위/아래 2px 보더) 표시. 마지막 형제 아래 드롭 존 포함(→ `beforeIntentId: null`… 단 현재 ▼ 구현처럼 `siblings[idx+1].id` 뒤 = `siblings[idx+2]?.id ?? null` 규칙을 드롭 인덱스로 일반화).
  - drop → 기존 `moveIntent(dragId, { beforeIntentId })` 그대로 재사용. `placementBusy` 중 드래그 비활성, 실패 alert 기존 유지.
  - 시각: 드래그 중 원본 행 opacity 감소, 타깃에 삽입선. 트리 재구성은 지금처럼 `router.refresh()`가 처리.
- **▲/▼ 버튼 삭제** (drag & drop으로 대체). 휴지통은 유지.
- 접근성 폴백이 필요하면 ▲/▼를 남길 수도 있으나, 요청은 대체이므로 삭제로 간다.

---

## F. ⚠ shadowed — 대시보드로 모으고 워크벤치에서 치우기

### 현재 구조

- 대시보드: `treeDiagnostics`가 라우터와 같은 walk로 intent별 shadowed **카운트**를 계산 (`IntentBoard.tsx:1682-1710`), 트리 행에 ⚠ N `SmallChip`(툴팁만, 클릭 없음) (`:1772-1779`).
- 워크벤치: ratings 라우트가 행별 `shadowedBy`를 내려주고, In this intent에서 amber "taken by · …" 칩 + 상단 배너 + `overlapsFirst` 정렬(shadowed 우선) + **send here** 버튼(먼저 가로챈 intent들에 out 교정을 함께 기록; 현 워크벤치에서는 실효 없음).

### 수정안

1. **⚠ 칩 클릭 → 쿼리 리스트 필터.**
   - `IntentSelection`에 `{ kind: 'shadowed'; id: number }` 추가 (`:261-275`).
   - `treeDiagnostics`가 카운트와 함께 **messageId 집합**을 모으도록 확장 (`shadowed: Map<intentId, { intentId, ids: Set<number> }>` — 기존 소비처는 `.ids.size`로).
   - `filteredRows`에 case 추가 (`:1489-1519`): `treeDiagnostics.shadowed.get(id)?.ids.has(r.messageId)`.
   - `selectionLabel`: `“{title}” · taken by earlier intents` (`:1650-1668`). selection 소멸 가드(`:1475-1487`)에 shadowed 케이스 추가(intent가 사라지거나 카운트 0이면 타입 선택으로 폴백).
   - 칩을 클릭 가능하게 (`stopPropagation` — 행 클릭과 분리), 활성 시 강조.
2. **워크벤치에서 shadowed 행 숨김.**
   - 멤버십 판정을 `clearly_in && shadowedBy === null`로 통일한 헬퍼를 두고 `inThisIntent`·`effectiveIn`(diff의 양쪽) 모두 여기에 태운다 — 리스트·+N/−N·인라인 diff가 서로 다른 집합을 세지 않게. (ratings 라우트는 versionNo 체크아웃 응답에도 현재 체인 기준 `shadowedBy`를 내려주므로 기준 버전 쪽도 같은 술어 적용 가능, `ratings/route.ts:256-288`.)
   - amber "taken by" 칩·상단 "Taken first by:" 배너(`:2237-2252`)·`overlapsFirst`(`:1420-1424`)·`onEditIntent` 점프 칩 삭제. ND 행의 "taken first by …" 텍스트 노트는 정보성이므로 유지(선택 — 구현 시 판단, 기본은 유지).
3. **send here 삭제.** 버튼(`:1779-1787`), `routeHere` 분기(`togglePin`), `redirectedBy` 상태(`:294`, `:1119-1133`)와 "also marked out of …" 노트(`:1652-1657`) 제거. 서버의 pins `routeHere` 파라미터는 다른 호출처가 없으면 그대로 두되 클라이언트에서만 미사용화(서버 정리는 선택).

---

## G. 라벨 반영 보장 문제 (2026-08-11 논의 중 — 구현 범위 미확정)

**문제**: out/in 라벨을 fold로 definition에 반영해도, Apply 재평가에서 그 라벨 쿼리가 반대로 판정되는 경우가 잦다. few-shot 예시(핀을 judge 프롬프트에 주입) 시절엔 드물었으나 UX 복잡성 때문에 제거하면서 생긴 회귀.

**원인 3개 (코드 근거)**:
1. definition이 judge의 **유일한 입력** — 교정이 분류기에 닿는 경로는 fold뿐 (`refine/route.ts:13-14`, `intent-agent.ts:61`). 정의 = 손실 압축.
2. fold 프롬프트가 **추상화를 명시 지시** — "원리 우선, 특수 케이스 목록 금지" (`intent-agent.ts:66,79`). 일반화엔 맞지만 라벨 쿼리 자체의 재현율을 깎는다.
3. **검증 부재** — 모달의 reflected/already는 fold 모델(강한 모델)의 자기 보고. 실제 판정자는 다른 모델(5.4-mini)이라 경계 개념이 어긋나도 다음 Apply(전체 재평가) 후 marker 충돌로야 발견된다.

**교수님 제안(라벨이 반영될 때까지 definition 수정 루프)의 위치**: 방향(검증 루프)은 맞다. 다만 사람이 돌리면 느리고, 루프 단독으론 수렴 보장이 없다 — out X를 흡수하는 rewrite가 in Y를 밀어내는 whack-a-mole(경계는 전역적으로 움직인다). → 루프는 자동화·경계화(Layer 2), 보장은 별도 층(Layer 1)이 맡는 구조를 제안.

**제안 — "결정은 보장되고, 정의는 일반화한다" 3층**:

- **Layer 1 · 계약 (결정론, LLM 0)**: 라벨된 쿼리는 definition이 단독으로 재현할 때까지 핀이 판정을 지배한다. fold가 핀을 무조건 consume하는 대신 **검증 통과분만 consume, 실패분은 'held'로 남아 override**. 라벨 쿼리가 어긋나는 일이 구조적으로 불가능해진다. v7이 핀 override를 제거한 이유("보드는 배포 런타임을 비춰야", `IntentBoard.tsx:1360-1370`)는 런타임도 같은 규칙을 쓰면 해소 — 스냅샷에 pins가 이미 있다(`IntentConfigSnapshot.pins`). 라이브 신규 쿼리엔 결정 자체가 없으니 보장 범위 밖(정의가 일반화 담당) — 스터디 로그(아카이브)에서는 보장이 완전하다.
- **Layer 2 · 테스트 주도 fold**: 라벨 = 테스트 스위트. fold 후보를 사용자에게 보여주기 **전에 라벨 쿼리 N개만 실제 judge로 평가**, 실패 라벨을 피드백해 내부 재시도 ≤K회(교수님 루프의 자동화·경계화). 리뷰 모달의 자기 보고를 **실측 ✓/✗**("결정 8개 중 7개를 정의 단독으로 재현")로 교체. 비용: N×K judge 호출(예: 8×3=24, 짧은 텍스트) — Apply 전체 재평가 대비 무시 가능. 보조: 정의 템플릿을 [요약 + Counts:/Doesn't count: 불릿]로 구조화(fold 프롬프트의 목록 금지 완화) — why-not 이유가 곧 불릿 재료, 한-층 원칙 유지하면서 few-shot의 구체성 복원.
- **Layer 3 · 은퇴 (수렴)**: Apply 후 정의 단독 판정이 held 핀과 일치하면 marker로 은퇴("v3에서 흡수됨 ✓" — conflictRows 계산의 역방향). corrections 카드 → "Decisions" 카드(흡수 ✓ n / 핀 유지 📌 m). held 핀은 이후 모든 fold의 입력+테스트 스위트에 자동 재포함 → 같은 세션 안에서도 재시도·은퇴가 돈다. 단 **수동 수렴은 공짜 부수 경로일 뿐, 스터디(1시간 세션)의 주 경로는 아래 실패-순간 인터랙션** (2026-08-11 결정).

**실패-순간 인터랙션 (2026-08-11 채택)** — 검증이 K회 내에 못 배운 라벨은 리뷰 모달 안에서 3지선다:
1. **이유 고쳐 다시 가르치기 (주 경로)**: 검증 판정의 judge **rationale을 증거로 표시**("judge는 이렇게 읽었습니다: '…'") → 재설명이 추측이 아닌 표적 반박이 된다. exclusion-reasons 라우트에 오독 내용을 넘겨 날카로운 이유 후보 제안 가능. 제출 → 해당 라벨만 fold+검증 1회 추가, 모달 제자리 갱신. 재실패 시 다시 조르지 않고 2로 수렴(루프 방지).
2. **핀으로 유지**: 보장 폴백, 원클릭. 모달을 건너뛰거나 무시해도 이것이 **조용한 기본값**(Apply를 인질로 잡지 않음).
3. **라벨 철회**: rationale을 읽고 judge가 맞다고 판단하는 경우 — 오라벨이 핀으로 박제되는 것을 막는 출구.
스터디 텔레메트리: 이유 재작성 빈도·재작성 후 성공률 = 가르침의 articulation 비용 데이터.

**최소 델타 구현**: 새 테이블·상태 불요 — fold의 `applyFold`가 correctionIds 전부가 아니라 **검증 통과분만 consume**하면 pending 상태 기계가 그대로 Layer 1이 된다. `effectiveRatings`(+배포 컴파일러)가 held 핀을 다시 존중하도록 1개 함수 수정. 검증 판정의 rationale은 rating 기계가 이미 생성·저장.

**확정 (2026-08-11)**: Layer 2(fold-시점 실측 검증+내부 재시도) + Layer 1(실패분 held 핀 override) + 실패-순간 3지선다 채택. override 발동 시점은 (b) — fold 실패분만, "fold 전엔 아무것도 안 변한다" 철학 유지.

**UI 통합 (요약)**:
- 왼쪽 컬럼이 루프의 서사: 정의(Apply·undo/redo) → **Decisions 카드**(구 Corrections waiting; 대기 n → Update definition 버튼 / 📌 유지 m / ✓ 흡수 k, C의 스핀오프 버튼도 여기) → History(major+draft 행, Save). 주 행동은 Apply→Update→Save 순으로 하나씩 점등.
- 리뷰 모달은 기존 FoldReviewModal 골격 유지: 왼쪽 rail의 outcome을 자기 보고에서 **실측 ✓/✗**로 교체(After 패널의 span 번호 밑줄 ↔ rail 매핑은 그대로 — ✓ 결정이 어느 문장에 사는지 보여줌). ✗ 항목은 rail에서 펼쳐져 judge rationale + [이유 재작성(주)|핀 유지|철회] 인라인. footer "Apply" 옆에 "미해결 n건은 핀으로 유지됩니다".
- 적용 후: held 핀 행은 인라인 diff의 빨간 행 + 📌 배지로 표시. 카드에서 📌→✓ 전환은 조용히(한 줄 알림). 흡수된 marker가 후에 다시 어긋나면 ⚠ 칩에서 원클릭 재보류.

**baseline 서사 (사실관계 확정)**: 베이스라인은 핀 자체가 ablation 대상(`FilterWorkbench.tsx:9` "Ablated: pins") — 티칭 루프는 이미 SCORE 전용 개입이다. G는 새 비대칭을 만드는 게 아니라 기존 개입 축을 강화하는 것. 교수님과 정리할 것: 논문에서 SCORE 효과의 귀속(트리 구조 vs 신뢰 가능한 티칭 루프)을 어떻게 서술할지 — G를 "intent 메커니즘의 일부"로 명시하는 방향 제안.

## 구현 순서 (커밋 단위)

작은 것 → 큰 것, 워크벤치 → 대시보드. 각 단계가 독립 동작.

1. **A** 라벨 단순화 (ND 탭 제거 + pane별 단일 버튼)
2. **F-2/F-3** 워크벤치 shadowed 숨김 + send here 제거 (A와 같은 파일 영역이라 연달아)
3. **B-1/B-2** Apply를 무버전 임시 저장으로 + savePending 재정의
4. **B-4** History major-only + 작업본(draft) 행
5. **B-3** Undo/Redo
6. **B-5** Diff 모달 + 인라인 git-diff (스트립 제거)
7. **C** out 스핀오프 (corrections 카드 버튼 + chooser 오버레이 배선 + `seedQueries[]`)
8. **D** 타입 레벨 New intent 4버튼 상시 노출 (SCORE + 베이스라인 New filter 대칭)
9. **F-1** ⚠ 칩 클릭 → shadowed 필터
10. **E** drag & drop reorder (+ 화살표 제거)

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `src/app/instructor/assignments/[id]/score/IntentWorkbench.tsx` | A, B 전체, C(버튼), F-2/3 — 최대 변경 |
| `src/app/instructor/assignments/[id]/score/IntentBoard.tsx` | C(배선), D, E, F-1 |
| `src/app/instructor/assignments/[id]/score/candidate-chooser.tsx` | C — out 시드 수신·표시 (anchorRow 자리에 out 무더기 요약) |
| (신규) `IntentDiffModal.tsx` 또는 워크벤치 내부 | B-5 모달 |
| `src/app/api/.../score/intent-suggestions/route.ts` | C 시드용 `seedQueries[]` 수용 (additive, 유일한 서버 변경) |
| 그 외 서버 | **변경 없음** (PATCH `minorVersion`·pins `routeHere`는 legacy 수용으로 존치; 선택적 정리만) |

## 결정 필요 / 확인 사항

1. **C의 스핀오프 디자인 확정 대기** (2026-08-11 논의): child는 fold 완료 시 out 쿼리에 닿을 수 없어 구조적으로 배제. 제안 = corrections 카드의 out 무더기에서 **sibling으로 스핀오프**, chooser 모달이 워크벤치 위로(보드 왕복 없음), out 쿼리+이유로 제안 시드. 사용자 승인 시 §C대로 구현. 이때 `/intent-suggestions`에 `seedQueries[]` 추가 — **유일한 서버 변경**(additive).
2. **Undo 히스토리는 세션 로컬**(새로고침 시 소실, 임시 저장된 작업본 자체는 유지) — 워드프로세서와 동일. OK?
3. **인라인 diff의 빨간(left) 행에 in 버튼 유지** — 복구 유일 경로. OK?
4. **ND에서 probably_out·미평가 행 완전 비노출** — 되살릴 경로 없음(정의를 넓혀 Apply하면 clearly/probably_in으로 올라오는 것이 유일한 경로). OK?
5. ~~베이스라인 비대칭~~ → **확정(2026-08-11)**: 베이스라인도 "New filter in {type}" 4버튼 상시 노출로 대칭 유지 (§D).
6. 기존 참가자 데이터의 **minor 버전 행은 DB에 남고 UI에서만 숨김** — export-metrics 등 스크립트 영향 없음.

## 검증

- `npx tsc --noEmit` + `npm run lint` + `npm run build`
- 수동: (1) 새 intent 생성→Apply×2→undo/redo→Save→History에 v1·v2만, (2) Apply 후 diff 모달/인라인 표시·기준 버전 변경, (3) out 핀 2개→스핀오프 버튼→chooser가 워크벤치 위로→Create→sibling으로 등록·시드 definition이 out들을 캡처하는지, A로 돌아가 fold하면 ⚠ 해소되는지, (4) SCORE 4버튼+베이스라인 New filter 4버튼 상시 노출·선택 무관, (5) 드래그로 순서 변경→라우팅(shadowed 카운트) 변화 확인, (6) ⚠ 클릭→리스트 필터, (7) 체크아웃/Revert 회귀 없음, (8) 베이스라인 보드: 필터 트리 외 무영향.

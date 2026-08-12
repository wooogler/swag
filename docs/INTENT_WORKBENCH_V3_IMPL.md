# Intent Workbench v3 — 구현 스펙 (커밋 단위)

작성: 2026-08-11 · 대상 브랜치: study-tools · 설계 근거: `docs/INTENT_WORKBENCH_V3_PLAN.md` (§A~§G)
이 문서는 **구현자가 그대로 따라가는 작업 지시서**다. 라인 번호는 2026-08-11 working tree 기준 근사치 — **심볼 이름으로 앵커**하고, 라인은 힌트로만 쓸 것.

## 공통 규칙

- 커밋 1개 = 아래 섹션 1개. 커밋 메시지는 기존 스타일(영어 명령문 한 줄, 예: `Let the out pile spin off a sibling intent`).
- 각 커밋 후 `npx tsc --noEmit` 통과 확인. 마지막에 `npm run lint && npm run build`.
- **DB 마이그레이션 없음.** `score_intent_pins.status`는 text 컬럼이라 'held' 값 추가에 DDL 불요.
- **건드리지 말 것**: RuleWorkbench의 rule 버전 시스템(minor 포함 그대로), `deploy-store.ts`의 라이브 라우팅(신규 쿼리는 정의 단독 판정 — held 핀은 로그 표시·보드에만 적용), baseline FilterWorkbench의 ablation(핀 없음 유지).
- 주석은 주변 스타일(제약·이유 서술형)을 따르되 과잉 금지.
- 서버 라우트를 수정하기 전에 **반드시 해당 파일 전체를 읽고** 이 문서의 가정("확인:" 표시)을 검증할 것.

## 상태 모델 요약 (구현 후의 최종 그림)

핀(`score_intent_pins.status`)의 일생: **`pending`(대기 — fold 전, 아무 효과 없음) → fold 검증 → 통과 시 `consumed`(✓ marker) / 실패+유지 선택 시 `held`(📌 — 로그 라우팅·멤버십 override) → 이후 Apply에서 정의가 재현하면 `consumed`로 은퇴**. 철회는 DELETE(행 삭제).
버전: Apply = 버전 기록 없음(스펙만 영속), Save = major 기록. fold 라우트가 남기는 minor 행은 유지하되 UI에서 숨김(marker의 consumedAtVersion 용도).

---

## 커밋 1 — [A] 라벨 단순화

파일: `src/app/instructor/assignments/[id]/score/IntentWorkbench.tsx`

1. `pinButtons(row)` (~L1752) → `pinButtons(row, pane: 'in' | 'nd')`로 변경. 렌더 규칙:
   - `pane === 'in'`: **out 버튼만**. 단 `row.pinned === 'in'`이면 활성 in 필도 렌더(철회 경로 — 클릭 시 `togglePin(row,'in')`으로 withdraw).
   - `pane === 'nd'`: **in 버튼만**. 단 `row.pinned === 'out'`이면 활성 out 필도 렌더(철회 경로).
   - 호출처 3곳 모두 pane 전달: `renderRow`(~L1741), `renderConvo` 헤더(~L1838 — `convo.pane` 사용).
2. Needs decision을 probably-in 전용으로:
   - `needsDecision` memo(~L1234): 조건을 `r.rating === 'probably_in'`로 교체(기존 not-clearly-in/out + busy 조건 삭제).
   - 삭제: `ndFilter`/`setNdFilter`(~L520), `ndSortIn`/`ndSortOut`(~L524-527) → 단일 `const [ndSort, setNdSort] = useState<NdSort>('out-like')`, `ndProbablyIn`/`ndProbablyOut`/`ndFiltered`(~L1377-1387), 탭 UI 블록(~L2380-2402).
   - 오른쪽 패널 리스트는 `sortRows(needsDecision, ndSort, ndSearch)` 직접 사용. 헤더 카운트 = `needsDecision.length`. 빈 상태 문구에서 "switch tabs" 분기 삭제.
3. 문구: ND 헤더는 "Needs decision" 유지(내용이 probably-in만임은 탭 제거로 자명). in 패널 정렬 옵션·검색 등 나머지 불변.

수동 테스트: 양 패널에 버튼이 하나씩만 보이고, 기존에 반대 verdict로 핀된 행(있다면)은 활성 필로 철회 가능. probably_out 행이 화면에서 사라짐.

## 커밋 2 — [F-2/3] 워크벤치 shadowed 숨김 + send here 제거

파일: `IntentWorkbench.tsx`

1. **멤버십 헬퍼 도입** (이후 커밋 6·9도 사용):
   ```ts
   const isMember = (r: { rating: RatingLevel | null; shadowedBy: number | null }) =>
     r.rating === 'clearly_in' && r.shadowedBy === null;
   ```
   - `inThisIntent`(~L1230): `scopedRows.filter(isMember)`.
   - `effectiveIn`(~L1278): `rowsIn.filter(...)` 조건을 동일 술어로 (baseline 스냅샷 rows에도 shadowedBy 필드가 옴 — ratings 라우트가 두 모드 공통으로 계산. 확인: `ratings/route.ts` ~L256).
2. 삭제 목록:
   - `pinButtons` 내 "send here" 버튼 블록(~L1779-1787)과 `togglePin`의 `routeHere` 파라미터·분기(~L1071-1133 중 routeHere 관련), in 버튼 title의 shadowedBy 분기(~L1768-1770).
   - `redirectedBy` state(~L294)와 그 갱신 로직(togglePin 내), "also marked out of …" 노트(~L1652-1657).
   - `renderRow`의 `overlapChip`(~L1588-1597, JSX ~L1681-1712)과 `priorLabel`(~L1598-1601; stale 표기는 유지 — priorLabel 부분만 제거).
   - 중간 패널 상단 "Taken first by:" 배너(~L2237-2252)와 `data.shadowedBy` 소비.
   - `overlapsFirst`(~L1420-1424)와 그 호출 2곳(정렬은 `sortRows` 결과 그대로).
   - `onEditIntent` prop과 배선(IntentBoard.tsx의 `onEditIntent` 전달 ~L2198-2205 포함) — overlap 칩 전용이었음. `guardLeave`는 exit용으로 유지.
3. 서버는 무변경(shadowedBy 필드는 계속 내려옴 — isMember가 소비).

수동 테스트: shadow가 있는 intent를 열어 "In this intent"에 amber 칩·배너·send here가 없고, 그 쿼리들이 목록에 없음. 카운트도 제외 반영.

## 커밋 3 — [B-1/2] Apply 무버전 임시 저장 + savePending 재정의

파일: `IntentWorkbench.tsx`

1. `persist()`(~L717)의 payload(~L753-759) 교체:
   ```ts
   // Save(force)와 create 첫 persist만 버전을 기록한다 — Apply는 워드프로세서의
   // 임시 저장: 스펙은 영속되지만 History에 남지 않는다 (§B).
   ...(opts?.silent || (!force && !isCreate)
     ? { recordVersion: false }
     : { recordVersion: true }),
   ```
   `minorVersion`·`pinsFromVersion`(~L778, checkout 분기)은 더 이상 보내지 않음(서버는 legacy로 계속 수용 — 서버 무변경).
2. `savePending`(~L1865) 교체:
   ```ts
   const latestMajor = versions?.find((v) => !v.minor) ?? null;
   const savePending =
     latestMajor != null &&
     (latestMajor.definition ?? '').trim() !== savedRef.current.definition.trim();
   ```
   Save 버튼 disabled 조건·title 문구에서 "Nothing new to save" 분기는 `!savePending` 그대로. (rename은 버전 없이 반영되므로 title은 비교에 넣지 않는다.)
3. 문구 수정: Apply 툴팁(~L1944-1947) "the change is kept (revertible from History)" → "the change is kept as the working draft — Save records it as the next version". persist docstring·주석에서 minor 서술 갱신.
4. **주의**: fold 라우트(`fold/route.ts:133`)는 계속 minor 버전을 기록한다 — 의도된 유지(marker의 consumedAtVersion 근거). UI는 커밋 4에서 숨긴다. `revertToCheckout`/`openVersion`은 무변경(대상이 major뿐이어도 동작 동일).

수동 테스트: Apply를 여러 번 해도 `/versions` 응답에 새 행이 늘지 않음(create 첫 Apply의 v1 제외). fold 후 Apply→Save 흐름에서 Save가 정확히 "마지막 major와 definition이 다를 때"만 활성.

## 커밋 4 — [B-4] History major-only + working draft 행

파일: `IntentWorkbench.tsx`

1. 렌더용 `const majors = useMemo(() => (versions ?? []).filter(v => !v.minor), [versions])`. History `<ul>`(~L2119-2153)을 아코디언 없이 `majors.map(v => versionEntry(v, false))`로 교체. 삭제: `versionGroups`(~L1358-1372), `groupToggles`, `versionEntry`의 `compact` 분기(라벨 요약 `labeledTooltip` 사용부는 major 행 tooltip으로 이동 가능하면 유지, 아니면 삭제), `versionLabel`의 minor 분기(`v${v.intentVersion}`만), `versionAction`의 'applied' 분기.
2. **draft 행**: `savePending`일 때 목록 맨 위에 비클릭 행 렌더:
   ```
   ● working — not saved yet   [current 칩]
   ```
   이때 기존 `isNewest` 하이라이트/‘current’ 칩 로직(~L1454, ~L1520-1524)은 **savePending이면 비활성**(최신 major 클릭 = 일반 checkout으로 동작: `activate()`에서 `isNewest && !savePending`일 때만 `backToLatest()`). `checkout !== null`이면 draft 행은 dim 처리.
3. `diffSel`/diff 버튼은 major 행에만 남으므로 무변경. 안내문 "Every applied version is…"(~L2117) → "Every saved version is a snapshot you can click to revisit."

수동 테스트: minor가 많은 legacy intent를 열어 History에 major만 보임. Apply 후 draft 행+current 칩, Save 후 draft 행 소멸·최신 major에 current.

## 커밋 5 — [B-3] Undo / Redo

파일: `IntentWorkbench.tsx`, `workbench-shared.tsx`(필요 시 DefinitionEditor action 영역만)

1. state: `const [past, setPast] = useState<{title: string; definition: string}[]>([]); const [future, setFuture] = useState<...[]>([]);`
2. `apply()` 성공 경로에서: persist 호출 **전에** `const prevSpec = { ...savedRef.current }` 캡처, persist 성공 후 `prevSpec.definition !== savedRef.current.definition`이면 `setPast(p => [...p, prevSpec]); setFuture([]);` (create 첫 Apply는 prevSpec.definition이 ''라 push 제외: `prevSpec.definition.trim() !== ''` 가드).
3. ```ts
   async function undo() {
     if (busy || saving || checkout !== null || past.length === 0) return;
     const target = past[past.length - 1];
     setPast(p => p.slice(0, -1));
     setFuture(f => [...f, { ...savedRef.current }]);
     await restoreSpec(target);
   }
   ```
   `redo()` 대칭. `restoreSpec(spec)`: `setTitle/setDefinition` → `persist` 상당의 PATCH를 `recordVersion:false`로 직접 호출(기존 persist 재사용: `persist(undefined, false, spec, { silent: true })` — silent는 버전 없음·버전 리로드 생략) → `fetchRatings(intentId, ...)` → `setBaselineNonce(n=>n+1)`. 해당 def_hash는 이미 평가돼 있어 즉시 로드됨; 일부 stale이면 Apply 버튼이 자연 점등(기존 메커니즘).
4. UI: DefinitionEditor `action` prop 안에서 Apply 왼쪽에 `Undo2`/`Redo2`(lucide) 아이콘 버튼. disabled: 스택 빔/busy/saving/checkout. title: "Undo to the previous applied definition (kept until reload)" 류.

수동 테스트: Apply×3 → undo×2(즉시 로드) → redo → 정의·목록 일치. undo로 마지막 저장 정의에 도달하면 Save 꺼짐.

## 커밋 6 — [B-5] Diff 모달 + 인라인 git-diff

파일: `IntentWorkbench.tsx` (모달은 같은 파일 내 컴포넌트로)

1. 삭제: "NEW SINCE BASE"/"LEFT SINCE BASE" 스트립(~L2256-2300), `newOpen`/`leftOpen`(~L351-352), `newInRows`(~L1345-1348)의 스트립 소비부.
2. 인라인 diff: 중간 패널 본문(~L2301-2321)을
   ```ts
   const members = inThisIntent;                 // isMember 필터 완료 상태
   const combined = [...members, ...leftRows];   // leftRows: baseline in → now not member
   const sorted = sortRows(combined, inSort, inSearch);
   ```
   행 렌더 시 variant: `leftSet.has(id)` → rose 배경 + 좌측 2px rose 보더 + **in 버튼만**(복구 경로; pane 'in'이지만 leftRow는 예외적으로 in 렌더 — `renderRow(r, 'in', { diff: 'left' })` 3번째 인자 추가), `newlyIn?.has(id)` → emerald 배경/보더(버튼은 일반 in-패널 규칙 = out). `leftRows` 계산(~L1336-1342)은 `effectiveInNow` 기반 그대로(커밋 2에서 isMember 반영됨).
3. 헤더의 `+N · −N compared to vK` 칩(~L2196-2210)을 버튼으로: `GitCompareArrows` 아이콘 추가, 클릭 → `setDiffModalOpen(true)`.
4. `DiffModal`: fixed overlay(z-[70]), 2컬럼 — 왼쪽 "Left this intent (−n)" rose / 오른쪽 "New in this intent (+n)" emerald. 각 행: 쿼리 텍스트(줄임+펼치기, `QueryTextButton` 재사용 가능하나 onOpen 없이 읽기 전용이면 plain 렌더로 충분) + rationale 이탤릭. 헤더에 "compared to {diffBaseLabel} — 기준 변경은 History의 diff". 백드롭/X/Esc 닫기.

수동 테스트: 정의를 좁혀 Apply → 빠진 쿼리가 정렬 위치에 빨간 행으로, 새 쿼리가 초록으로; 칩 클릭 → 모달 2컬럼; 빨간 행 in 클릭 → 핀 복구 동작.

## 커밋 7 — [G-1] 서버: fold 검증 루프

파일: `src/lib/score/intent-agent.ts`, `src/app/api/.../intents/[intentId]/refine/route.ts`

1. `foldCorrections` 확장 — 옵션 인자:
   ```ts
   previousAttempt?: {
     definition: string;
     failures: { id: number; verdict: 'in'|'out'; queryText: string; reason: string | null;
                 judgeRating: RatingLevel; judgeRationale: string }[];
   }
   ```
   존재 시 user 프롬프트에 블록 추가: `PREVIOUS ATTEMPT (failed verification):\n<definition>\n\nThe classifier, reading that text alone, still judged these wrong:\n- [id N] "…" — instructor: out ("reason") / classifier said clearly_in: "rationale"\nRewrite so the classifier's reading flips on these WITHOUT losing the other corrections.`
2. refine 라우트에 검증 단계 (`maxDuration 300` 이미 있음):
   - **확인**: `rate/route.ts`가 messageId별 컨텍스트(prevQueryText/prevResponseText/dissection)를 어떻게 조립하는지 읽고 동일하게 로드(공용 헬퍼가 있으면 재사용, 없으면 최소 복제 — 대상은 이 intent의 correction messageId들뿐이라 소량).
   - 후보마다: `rateMessageIntents({ queryText, prev…, intents: [{ id: intentId, definition: candidate }], includeDissection: false, dissection, model: SCORE_RATING_MODEL })`를 correction별 병렬(Promise.all, 상한 50) 실행. **DB 기록 없음**(ephemeral — Apply가 어차피 전량 재평가). `SCORE_RATING_MODEL` import 위치는 보드가 쓰는 곳과 동일(**확인**: `models.ts` 또는 `intents.ts`).
   - pass 판정: verdict 'in' → rating === 'clearly_in', 'out' → rating === 'clearly_out'.
   - 루프: 시도 1 실패 라벨 있으면 `previousAttempt`로 재fold → 재검증, **최대 총 3회 fold**. 전 라벨 pass면 조기 종료. 최종 후보 = pass 수 최대(동률이면 마지막).
   - 실패한 개별 rate 호출(파싱 실패 등)은 해당 correction을 `pass:false, judgeRationale:'(verification call failed)'`로 처리 — 검증 실패가 fold 전체를 죽이면 안 됨.
   - **다중 intent(구 send-here sibling) 대상은 검증 생략** 가능(mine만 검증) — send here는 커밋 2에서 제거되어 신규 유입 없음.
3. 응답 확장: 각 correction에 `verified: { rating, rationale, pass } | null`(검증 자체가 불가했으면 null — OPENAI 미설정 등), proposal에 `verifiedPass: number, verifiedTotal: number, attempts: number`.
4. refine 라우트의 pending 조회(~L99-104)를 `status IN ('pending','held')`로 확장 — **held 핀은 모든 후속 fold의 입력+테스트에 재포함**(§G Layer 3).

검증: curl 또는 임시 스크립트로 refine 호출 → 응답에 verified 필드·attempts 확인. 소요 수십 초 정상.

## 커밋 8 — [G-2] 서버: held 상태 + 보드/워크벤치 override

파일: `fold/route.ts`, `pins/route.ts`, `ratings/route.ts`, `page.tsx`, `IntentBoard.tsx`, `IntentWorkbench.tsx`, `src/db/schema.ts`(타입 주석만, DDL 없음)

1. `fold/route.ts` body에 `holdIds: z.array(z.number().int().positive()).max(500).optional()` 추가. 트랜잭션에서 consume 업데이트와 나란히:
   ```ts
   if (body.holdIds?.length) await tx.update(scoreIntentPins)
     .set({ status: 'held' })
     .where(and(assignment, inArray(status, ['pending','held']), inArray(intentId, targetIds), inArray(id, body.holdIds)));
   ```
   consume 쿼리의 status 조건도 `IN ('pending','held')`로(재fold에서 held가 검증 통과하면 consume — 은퇴 경로 그 자체).
2. `pins/route.ts`: 라벨 재기록(POST)은 held 위에도 동작해야 함 — set의 `status:'pending'`이 held를 되돌리는 건 의도된 동작("다시 가르치기"). **retire 추가**: `PATCH { retireMessageIds: number[] }` 핸들러 — 이 intent의 held 핀 중 해당 messageId를 `status:'consumed', consumedAt:now, consumedAtVersion:null`로. 버전 기록 없음.
3. `ratings/route.ts`: **확인** 후 — live 모드에서 pin 필드를 채우는 지점(~L90-179)에서 `pinned`는 status pending **또는 held**의 verdict로, 신규 필드 `pinStatus: 'pending' | 'held' | null` 추가. marker(consumed)는 기존대로. 클라 `RatingRow`에 `pinStatus` 추가.
4. `page.tsx`(~L266): pinsByMessage는 유지하고, held만 담는 `heldByMessage: Map<number, Record<number,'in'|'out'>>` 추가 → row에 `heldPins` 필드로 전달. `ScoreQueryRow` 타입(IntentBoard.tsx)에 `heldPins: Record<number,'in'|'out'>` 추가.
5. `IntentBoard.tsx` `effectiveRatings`(~L1371): held override 적용 —
   ```ts
   for (const [idStr, v] of Object.entries(r.heldPins))
     ratings.set(Number(idStr), v === 'in' ? 'clearly_in' : 'clearly_out');
   ```
   주석: held는 "정의가 아직 못 담아 시스템이 잡아둔 결정" — pending과 달리 라우팅에 반영(§G Layer 1). resolutions/treeDiagnostics/deletePreview가 자동 상속.
6. `IntentWorkbench.tsx`: `isMember` 확장 —
   ```ts
   r.pinStatus === 'held' ? r.pinned === 'in' : (r.rating === 'clearly_in' && r.shadowedBy === null)
   ```
   held-out 행: 멤버가 아니므로 인라인 diff의 빨간 행 조건에 들어옴(leftRows 아님이어도 — baseline에 있었다면 leftRows로 잡힘; baseline에 없던 held-out은 그냥 비표시) + 📌 배지 "held by your decision — the definition doesn't carry this yet"(renderRow에서 `pinStatus==='held'`일 때 기존 "waiting" 문구 대신).
7. **은퇴 클라 로직**: `apply()`의 최종 `fetchRatings` 후 — `rows.filter(r => r.pinStatus==='held' && !r.stale && r.rating!==null && ((r.pinned==='in') === (r.rating==='clearly_in')))`의 messageId들을 `PATCH /pins`로 retire → 성공 시 refetch + Decisions 카드에 1줄("N decision(s) absorbed into the definition" — 일회성 배너 state).

수동 테스트: fold에서 hold된 핀이 보드 라우팅(⚠ 수치·리스트 소속)에 반영, 워크벤치 멤버십에서 제외/포함. Apply 후 정의가 따라잡으면 자동 은퇴.

## 커밋 9 — [G-3] 리뷰 모달 실측 ✓/✗ + 3지선다 + Decisions 카드

파일: `FoldReviewModal.tsx`, `IntentWorkbench.tsx`

1. `FoldCorrectionView`에 `verified` 필드 추가(커밋 7 응답). rail 항목:
   - `verified.pass` → 초록 "✓ verified" (기존 span 밑줄 매핑 유지).
   - `!verified.pass` → 빨강 "✗ not learned" + 펼침 영역: judge rationale 인용("The classifier read it as: …") + 액션 3개:
     - **[Fix the reason & retry]** (primary): reason 인라인 textarea(기존 reason prefill) → 제출 시 `onReteach(correction, newReason)` 콜백 → 워크벤치가 `POST /pins`(재기록, reason 교체) 후 `openFoldReview()` 재실행(모달 유지, 로딩 상태 재사용). 한 correction당 1회만 노출(재실패 시 아래 두 개만).
     - **[Keep as pin 📌]** — 로컬 결정 표시만(적용 시 holdIds에 포함).
     - **[Withdraw label]** — `onWithdraw(correction)` → DELETE pins?messageId= → 목록에서 제거.
   - `verified === null`(검증 불가) → 기존 reflected 자기 보고 표기로 폴백.
2. footer Apply: `applyFold`가 `correctionIds = pass된 것들`, `holdIds = 실패 중 철회 안 된 것들`(명시 선택 없어도 기본 hold — "미해결 n건은 핀으로 유지됩니다" 문구를 버튼 옆에). 실패 0이면 문구 생략.
3. `applyFold`(IntentWorkbench ~L906) 갱신: body에 holdIds 추가, 이후 fetchRatings/loadVersions 기존 유지.
4. **Decisions 카드**(구 Corrections waiting, ~L1965-2023): 3단 구성 —
   - 대기 n(기존 목록) + "Update definition · n" 버튼(기존).
   - `📌 held m`: `data.rows.filter(r=>r.pinStatus==='held')` 목록(verdict + 텍스트 요약). 항목에 은퇴는 없음(자동) — 철회만 x 버튼으로.
   - `✓ absorbed`: marker 수 요약 한 줄(`r.marker && !r.pinned` 카운트), 접힘 기본.
   - 카드 표시는 `pinCount>0 || heldCount>0 || absorbedCount>0`일 때.
5. ⚠ conflict 칩(~L2177-2187): 대상이 "marker가 있는데 정의가 어긋난 행"(held는 제외 — held는 어긋날 수 없음). 칩에 원클릭 "hold these again" 추가: 해당 행들 `POST /pins` 재기록(verdict=marker.verdict) 후 즉시 fold 없이 held로 만들 수 없으므로 → **단순화: 재기록으로 pending 복귀만**(기존 "teach again" 경로). 문구 유지.

수동 테스트: 일부러 안 배워질 라벨(모호한 이유)로 fold → ✗ + rationale 표시 → 이유 수정 재시도 → ✓ 전환 or 핀 유지 → 적용 후 카드 3단 상태 일치.

## 커밋 10 — [C] out 스핀오프

파일: `intent-suggestions/route.ts`, `candidate-chooser.tsx`, `IntentBoard.tsx`, `IntentWorkbench.tsx`

1. `intent-suggestions/route.ts` bodySchema에 추가:
   ```ts
   seedQueries: z.array(z.object({ text: z.string().trim().min(1).max(2000),
     reason: z.string().trim().max(400).nullable().optional() })).min(1).max(12).optional(),
   ```
   `messageId`는 `seedQueries` 있을 때 optional로 완화(**확인**: 라우트가 messageId로 무엇을 로드하는지 읽고, seedQueries 모드에선 그 로드를 건너뛰기). SYSTEM/user 프롬프트: seedQueries 모드일 땐 "다음 쿼리들(강사가 현재 intent에서 out시킴; reason은 그 이유)을 OWN할 새 intent 후보 3개" — 기존 3-고도(SPECIFIC/…) 구조 유지.
2. `IntentBoard.tsx`: `newIntentRequest`에 `spinOffSeed?: { text: string; reason: string | null }[]` 추가. `IntentWorkbench`에 prop `onSpinOff?: (scope: {type: ScoreQueryType; parentIntentId: number|null}, seeds: {text,reason}[]) => void` 전달(edit 모드만):
   ```ts
   onSpinOff={(scope, seeds) => setNewIntentRequest({ scope, anchorRow: null, spinOffSeed: seeds })}
   ```
   chooser `onPick`(~L2923): `setEditIntent(null)` 추가(스핀오프로 열렸을 때 워크벤치 스왑 — `workbenchMode`가 editIntent 우선이므로 필수).
3. `candidate-chooser.tsx`: prop `spinOffSeed` 수용 — 있으면 anchorRow 블록 대신 seed 쿼리 목록(텍스트+reason) 렌더, AI 제안 fetch body를 `{ seedQueries, scopeType }`로. `wantsAi` 조건에 seed 모드 추가.
4. `IntentWorkbench.tsx`: Decisions 카드에 out 핀(≥1)일 때 버튼 "+ New intent from these N out queries" — `guardLeave(() => onSpinOff({ type, parentIntentId }, outs))`. type/parent: edit 모드 `mode.intent.type`/`mode.intent.parentIntentId`(**sibling** — 부모가 같음). type이 null인 legacy intent에선 버튼 숨김. outs = `pinnedOut.map(r => ({ text: r.queryText, reason: r.reason }))` (+ held-out도 포함: `pinStatus==='held' && pinned==='out'`).

수동 테스트: out 2개 → 버튼 → chooser가 워크벤치 위 모달로, seed 목록 표시 → Create → 새 create 워크벤치(placement = 부모 동일 sibling) → exit 후 보드 트리에서 형제로 확인.

## 커밋 11 — [D] New intent/filter 4버튼 상시 노출

파일: `IntentBoard.tsx`

1. SCORE(~L2392-2404): `createsAtTypeLevel` 게이트 삭제 — 타입 섹션마다 항상:
   ```ts
   { key: 'new', node: <NewIntentRow scope={{ label: `Create an intent inside ${QUERY_TYPE_LABELS[root.type]}`,
       buttonLabel: `New intent in ${QUERY_TYPE_LABELS[root.type]}` }}
       onClick={() => openIntentChooser({ type: root.type, parentIntentId: null }, anchorRow)} /> }
   ```
2. `newIntentScope` memo(~L1910): type/residue-root 분기 삭제, intent-scope 분기만 유지(`createsHere` 행 용).
3. Baseline(~L392-395, ~L413-428): `scopeHere` 게이트 삭제 — 4개 타입 모두 "New filter in …" 상시 렌더.

수동 테스트: 아무 선택 상태에서도 SCORE 4버튼·baseline 4버튼 노출, intent 선택 시 "inside" 행 추가 노출.

## 커밋 12 — [E] Drag & drop 순서 변경

파일: `IntentBoard.tsx`

1. state: `const [drag, setDrag] = useState<{id:number; parentId:number|null; type:ScoreQueryType}|null>(null);`
   `const [dropAt, setDropAt] = useState<{beforeId:number|null; parentId:number|null}|null>(null);`
2. `renderTreeNode` 행 div에: `draggable={!placementBusy}` + `onDragStart`(drag set, `e.dataTransfer.effectAllowed='move'`), `onDragEnd`(둘 다 clear). 좌측에 hover 시 `GripVertical` 핸들(기존 ▲▼ 자리 — ▲▼ 버튼 2개 삭제, 휴지통 유지).
3. 드롭 타깃 = **같은 parentId·같은 type의 형제 행만**: `onDragOver`에서 조건 맞으면 `e.preventDefault()` + 커서 상/하 절반(`e.clientY` vs `rect.top+rect.height/2`)으로 `dropAt={beforeId: 위면 이 행 id, 아래면 다음 형제 id ?? null, parentId}` 설정, 삽입선은 행 위/아래 `border-t-2 border-[hsl(var(--primary))]` 류 조건부 클래스.
4. `onDrop`: `if (drag && dropAt) void moveIntent(drag.id, { beforeIntentId: dropAt.beforeId });` (자기 자신 앞뒤 no-op 가드: beforeId === drag.id거나 현재 위치와 동일하면 skip). 실패 alert·`placementBusy`·refresh는 기존 `moveIntent` 그대로.
5. 시각: 드래그 중 원본 행 `opacity-50`.

수동 테스트: 형제 3개 재배열(맨 위/중간/맨 아래), 다른 부모/타입으로는 드롭 불가, 순서 변경 후 ⚠/라우팅 변화 확인, History에 reorder major 기록(기존 서버 동작).

## 커밋 13 — [F-1] ⚠ 칩 클릭 → shadowed 쿼리 필터

파일: `IntentBoard.tsx`

1. `IntentSelection`(~L261)에 `| { kind: 'shadowed'; id: number }`.
2. `treeDiagnostics`(~L1682): `shadowed`를 `Map<number, { intentId: number; ids: Set<number> }>`로 — count 지점에서 `ids.add(r.messageId)`. 소비처(`shadow.count` ~L1775-1777)는 `shadow.ids.size`로.
3. `filteredRows`(~L1489) case 추가:
   ```ts
   case 'shadowed': return treeDiagnostics.shadowed.get(selection.id)?.ids.has(r.messageId) ?? false;
   ```
4. `selectionLabel`(~L1650): `case 'shadowed': return `${titleOf(selection.id)} · taken by earlier intents`;`
5. selection 소멸 가드(~L1475): shadowed인데 intent가 없거나 `ids.size===0`이면 타입 폴백.
6. ⚠ `SmallChip`을 클릭 가능하게(SmallChip이 span이면 감싸는 button 또는 onClick+role — `e.stopPropagation()` 필수, 행 클릭과 분리). 활성 상태(`selection.kind==='shadowed' && selection.id===intent.id`)면 amber 진하게. title 유지.

수동 테스트: ⚠ 3 클릭 → 리스트가 그 3개, 헤더 라벨 확인, 다시 intent 클릭으로 복귀.

---

## 최종 검증 체크리스트

1. `npx tsc --noEmit` · `npm run lint` · `npm run build`
2. 설계 문서(§검증)의 수동 시나리오 8개 + 각 커밋의 수동 테스트.
3. 회귀 확인: baseline 보드(필터 트리 외 무영향), RuleWorkbench(무변경), checkout/Revert, 스터디 콘솔·provision 흐름(무관 확인만).
4. 기존 데이터: minor 버전 행·legacy 핀이 있는 intent를 열어 History/카드가 깨지지 않는지.

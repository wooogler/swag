# Decision Ledger — 핀을 소비하지 않는 워크벤치 (v3 §G 개정)

작성: 2026-08-18 · 상태: **구현 중** (D1·D2 확정 — §4) · 대상 브랜치: study-tools
선행 문서: `docs/INTENT_WORKBENCH_V3_PLAN.md` §G(2026-08-11 확정: 3층 구조 — Layer 1 held override · Layer 2 fold 시 실측 검증+재시도 · Layer 3 marker 은퇴), `reports/JELSON/analysis.md` §3.2, `docs/STUDY_TRAIL_SPEC.md` §2.6.

## 0. 왜 다시 여나 — 파일럿이 §G의 어느 층을 깼는지

§G는 "라벨이 반영될 때까지"를 세 층으로 풀었다. JELSON 파일럿(intent 7059, 13.7분, 핀 17회, fold 10회)에서 각 층이 어떻게 됐는지:

| 층 | 설계 의도 | 파일럿에서 실제로 |
|---|---|---|
| Layer 1 · held override | fold가 못 배운 결정은 핀이 판정을 지배 | 발동 0회 — 17개 핀 전부 fold 시점 검증을 통과해 consumed. **문제는 통과한 뒤에** 났다 |
| Layer 2 · fold 시 검증+재시도 | 후보를 실제 판정기로 재보고 실패분 재시도(≤3) | 작동했다. 그러나 재시도의 목적함수가 "핀 N개 재현"뿐이라 정의가 판정기의 문자 그대로 읽기에 맞춰졌다 — 288 → 1,127자, 핀 4개짜리 첫 fold부터 "terse noun-phrase requests… example jobs, uses, places" 식 열거 |
| Layer 3 · marker 은퇴 | 흡수된 결정은 ✓ marker, 다시 어긋나면 ⚠ | **여기가 깨졌다.** 재판정 12회에 핀한 판정의 회귀 4건 → 참가자는 ⚠를 보고 같은 질문을 다시 핀(129941 ×3, 130051 ×3) → 다시 fold → 텍스트 누적. marker는 행 안의 한 줄이라 "내 결정 12개 중 2개가 뒤집혔다"가 어디에도 집계되지 않았고, 재핀은 이전 핀을 덮어써 "세 번째 가르치는 중"이라는 사실도 사라졌다 |

그리고 검증(Layer 2)은 핀만 보고 **나머지 모집단**은 보지 않아, fold 하나가 핀 안 한 질문 10개를 in으로 밀어 넣어도(v2) 아무 신호가 없었다 — 그 뒤 fold 6번이 그걸 되돌리는 데 쓰였다. 부수 flip 43건 중 정의 무변화 재판정에서 난 것도 4건(순수 잡음 9%)이고, 참가자는 잡음도 텍스트로 "고쳤다".

**개정 방향** — 결정을 **소비하지 않는다**. 핀은 참가자가 유심히 보고 내린 판단의 흔적이고, 그 흔적을 정의가 계속 지키는지 확인하는 **상시 테스트 세트**로 남긴다. 그러면 (a) 회귀가 카운터로 보이고, (b) fold는 언제나 결정 전체를 입력으로 받아 원칙을 뽑을 재료가 생기며(batch), (c) 반복해서 안 맞는 결정은 "다른 범주"라는 신호가 되어 분리(spin-off)로 이어지고, (d) 재핀 압력이 사라져 재판정 횟수가 준다. 런타임은 그대로 정의만 본다.

## 1. 한눈에

| # | 항목 | 대상 |
|---|---|---|
| A | 데이터 모델 — `pin` 3상태(pending/held/consumed) → **decision** 2상태(new/taught) + 계산값 `holds` | `intent-store.ts`(DDL), `ratings/route.ts`, `pins/route.ts`, `fold/route.ts` |
| B | fold — 입력은 결정 전체 · 검증은 전체 · **재시도는 새 결정에만** · 검토 세트 델타(+N/−M) 반환 | `refine/route.ts`, `intent-agent.ts` |
| C | 워크벤치 — 왼쪽 "Your decisions" 카드(✓/✗ 카운터) · 행 주석 칩 하나 · rationale은 처리 필요 시에만 | `IntentWorkbench.tsx` |
| D | fold 모달 — rail = 결정 전체 ✓/✗ · "Also moves +N −M" 한 줄 | `IntentWorkbench.tsx`(FoldReviewModal) |
| E | 프롬프트 — fold 길이 예산·"요청 종류로 정의"·"이미 지켜지는 결정엔 절 추가 금지" · reason 스펙트럼 · 씨앗 요청 종류 | `intent-agent.ts`, `exclusion-reasons/route.ts`, `intent-suggestions/route.ts` |
| F | 로깅 — `rating_run.decisions{hold,dont}` · `suggest_fold.wouldGain/Lose` · `fold_apply.notHeld` | 라우트 3개, `trail.ts` |

DB: 컬럼 **1개 추가**(`taught_count`, additive), 상태값 재해석(마이그레이션 = UPDATE 한 줄). 나머지는 서버 라우트 4개 + 클라이언트.

## 2. 상세

### A. 데이터 모델 — decision

**현재.** `score_intent_pins.status ∈ {pending, held, consumed}`, `consumed_at_version`. `ratings/route.ts`가 pending/held → `pinned · pinStatus · correctionId`, consumed → `marker{verdict, versionNo}`로 분리해 내려주고, 워크벤치는 이 셋을 각각 다른 문장으로 그린다.

**수정.**
- 상태는 둘: **`new`**(아직 fold에 들어간 적 없거나, 다시 가르치는 중) · **`taught`**(fold가 한 번 이상 접음). 저장 컬럼은 그대로 쓰되 값만: `pending`→new, `consumed`/`held`→taught, `consumed_at_version`→`taught_at_version` 의미. 추가 컬럼 `taught_count integer default 0`(재교육 횟수 — 파일럿의 "세 번째 핀"이 보이게).
- **`holds`는 저장하지 않는다.** 읽을 때 계산: 이 intent의 fresh rating이 있고 `(verdict==='in') === isIncludedRating(rating)`이면 true, 어긋나면 false, stale/미판정이면 null. (지금 `conflictRows`가 하는 계산을 결정 전체로 확장한 것.)
- ratings 행: `pinned`(verdict)는 유지, **`decision: {id, verdict, reason, reasonSource, status, taughtAtVersion, taughtCount, holds}`** 추가, `pinStatus`·`marker`·`correctionId` 제거. 워크벤치가 유일한 소비자.
- `pins/route.ts` POST: 같은 질문에 다시 핀 → 같은 verdict면 "다시 가르치기"(status→new, reason 갱신, `taught_count` 유지), 다른 verdict면 마음 바뀜(status→new). DELETE = 철회(있음). `pin_set` 이벤트에 `reteach: boolean` 추가.
- 스냅샷(`IntentConfigSnapshot.pins`)은 지금 pending만 담는데 결정 전체(status 포함)를 담는다 → trail의 `pins_changed` diff가 실제로 살아난다.

### B. fold — 결정 전체를 접고, 새 것만 재시도하고, 모집단 델타를 보여준다

**현재 (`refine/route.ts`).** pending/held만 로드 → `foldCorrections` → 후보를 **핀한 질문에만** 실제 판정기로 검증 → 실패분 피드백 재시도 ≤3 → 자기 보고 outcome + 검증 verdict 반환. `fold/route.ts`가 적용 시 correctionIds를 consumed로, 못 지킨 것은 held로.

**수정.**
- 입력 = 이 intent의 **결정 전체**(new + taught, 이유 포함). 프롬프트에 결정마다 `status`를 넘긴다 — 모델이 "이미 지켜지는 결정"과 "새로 가르치는 결정"을 구분하도록(E 참조).
- 검증 = 결정 전체를 후보 정의로 재판정 → `holdsAfter` per decision. **재시도 조건은 "new 결정 중 실패"뿐.** taught 결정이 깨지는 건 재시도 사유가 아니라 **보고 사항**("이 수정은 당신의 이전 결정 2개를 뒤집습니다"). 이유: 재시도가 곧 판정기 문자 그대로 읽기에 맞추는 압력이고, 결정이 12개면 그 압력이 12배가 된다. `MAX_ATTEMPTS` 3 → 2.
- **모집단 델타**: 최종 후보로 그 type의 **검토 세트 질문**(스터디 클론: `study_review_questions` ∩ type, 15개; 일반 보드: 현재 clearly_in + Potential 목록, 상한 20)을 판정 → 지금 판정과 비교 → `wouldGain[]`, `wouldLose[]`(messageId + 텍스트). 5.4-mini 15~20 호출, 모달 대기 몇 초 증가. **재시도에는 쓰지 않는다** — 부수 이동이 의도인지 모델은 알 수 없다.
- 응답: `proposals[].decisions: [{id, verdict, status, holdsNow, holdsAfter}]`, `proposals[].delta: {gain, lose}`, `attempts`.
- `fold/route.ts` 적용: consume 없음. 포함된 결정 전부 `status='taught'`, `taught_at_version=versionNo`, `taught_count+1`. `holdIds` 폐기(지키지 못한 결정 = taught && !holds로 자연히 표현). 그 뒤 Apply 재판정은 지금과 같다.

### C. 워크벤치 — 한 결정에 한 줄, 한 비트, 한 위치

**현재.** 왼쪽 원장 = "Decisions waiting"(이유 포함 목록) + "📌 Held"(목록) + "✓ n absorbed"(숫자만). 행 = 필 + `why: 이유`(원장과 중복) + 상태 문장 3종("marked out — waiting…" / "held out by your decision — the definition can't say this yet, so this decision is what routes it" / "you marked this out · v2", 어긋나면 ⚠) + 판정기 rationale + expand + 재료 태그. 어휘: waiting·held·absorbed·marked·reproduced·pin.

**수정.**

왼쪽 카드 → **Your decisions**
```
YOUR DECISIONS · 12                    10 hold · 2 don't
 in   what does the future of automation…   ✗   taught 3×
 out  Automation is generally seen as…      ✗
 in   Unemployment rate in the 1950s        ✓
 in   Any ideas for syllogisms I can use…   ✓
 out  …what do you think about this issue   ✓
      + 7 more
 [✨ Update definition · 2 to teach]
```
- 정렬: ✗ → new(`…`) → ✓. 헤더 카운터가 두더지잡기의 계기판.
- 이유는 **여기서 뺀다**(행에만). `taught 3×`는 2회 이상일 때만.
- ✗ 행 hover/클릭 → `Move to new intent` · `Withdraw`. Teach again 버튼은 없다 — Update definition이 언제나 전체를 다시 접으니까. 결정이 0개거나 전부 ✓면 버튼 비활성 + "All decisions hold".
- 없어지는 것: waiting/held/absorbed 소제목·설명문, absorbed 카운트, "folded on update, then cleared" 문구. `New intent from N ruled out`(§C 스핀오프)은 유지 — 목적이 다르다(out 결정의 거처).

행 주석 → **칩 하나 + 이유 한 줄**
```
Give me reasons why automation is good…        [in][out]
you: out ✓                                     Asks for reasons, not examples.
```
```
what does the future of automation look like   [in][out]
you: in ✗ · definition says out · held by your call    Future-oriented labor impacts are valid research material.
   judge: Requests an opinion, not evidence or examples.
```
- 상태 문장 3종 → `you: <verdict> ✓|✗|…`. D1이 override 유지면 ✗ 뒤에 `· held by your call`.
- **rationale 노출 규칙(2026-08-18 결정): 처리가 필요한 곳에만 기본 노출** — (a) 미결정 행(Potential 목록), (b) `holds === false`인 결정 행(왜 판정기가 어긋나는지가 곧 재설명·이동·철회의 근거). 그 밖(✓ 결정, 핀 없는 clearly_in)은 `▸ why` 토글 뒤(hover 아님 — 스터디 참가자가 발견 못 함).
- diff 색조(빨강/초록 행)는 기본 꺼짐, 헤더의 `+N −M` 칩을 누르면 켜짐. 기본 목록은 "지금 안에 있는 것"만.
- `isMember`: D1에 따라 — override 유지면 `decision && holds===false ? decision.verdict==='in' : rating==='clearly_in'`(오늘의 held와 같음), 폐지면 rating만.

### D. fold 모달

**현재.** rail = pending 결정(이유 + "the definition says this by itself"/"can't say this yet" + Say it differently/Withdraw) · BEFORE · AFTER(변경 하이라이트) · What changed · 경고줄 · Apply. 구조는 좋다.

**수정 (두 곳).**
- rail = **결정 전체** ✓/✗(`holdsAfter`), new는 `new` 표시. ✗는 펼쳐서 judge rationale + [Say it differently] [Withdraw] [Move to new intent]. 헤더: "from your 12 decisions · 11 of 12 hold in the new text".
- What changed 아래 한 줄: **"Also moves: +3 in · −1 out among this type's questions ▸ show"**(펼치면 질문 목록). 지금 apply *뒤에* 가운데 헤더에 뜨는 `+10 −10 vs v1`을 apply *앞*으로 옮긴 것.
- footer: D1-유지면 "N decisions the new text can't say — kept as your call", 폐지면 "— shown as ✗ after apply".

### E. 프롬프트

- **fold (`REFINE_SYSTEM`)**: 결정에 status 동봉 + "이미 현재 정의가 지키는 결정을 위해 문구를 추가하지 말라 — 새 결정이 새 경계를 요구할 때만 바꾼다" · **길이 예산**(소프트: 80단어를 넘으면 반드시 줄일 것; 스키마 `maxLength` 하드 상한 700자 — D2) · "요청의 **종류**(행위+대상 부류)로 정의하고, 과제 주제(automation, unemployment…)는 이유가 주제적일 때만" · "열거 대신 상위어; 'such as/including'은 1회 이하" · 재시도 메시지에 "실패한 질문을 사실상 지목하는 문구를 넣지 말 것".
- **reason (`exclusion-reasons`)**: 세 후보를 좁게/넓게/**원칙**으로, 원칙을 1순위(참가자는 1순위를 고른다 — 13/15) · 과제 주제어 금지(경계가 주제적일 때 제외).
- **씨앗 (`intent-suggestions`)**: 앵커 질문의 재서술이 아니라 요청 종류로("Provide Examples — asks the chatbot to provide examples — for example…" 꼴).
- **재현 스크립트 `scripts/score/fold-replay.ts <intentId>`**: 결정 원장(JELSON 7059에 이유 달린 12개가 그대로 있다)을 씨앗 정의(v1, 288자)에 **한 번에** 접어 옛 프롬프트 vs 새 프롬프트 결과·길이를 나란히 찍고, 판정기로 12개 + 검토 15개 재판정해 소속을 비교. 강한 모델 2회 + 판정 ~30회. **UI에 손대기 전에 E의 근거를 만든다.**

### F. 로깅·트레일

- `rating_run` payload: `decisions: [{intentId, hold, dont}]` (핀 테이블 join, 호출 0).
- `suggest_fold` payload: `delta: {gain, lose}`, `decisionsAfter: [{id, holdsAfter}]`, `attempts`(있음).
- `fold_apply` payload: `notHeld: [decisionId]`.
- 새 `pin_set.reteach`, 스핀오프 씨앗 출처 `seedFrom: 'decisions'`.
- `trail.ts` describeEvent 갱신; export README 한 줄.

## 3. 구현 순서 (커밋 단위)

1. ~~**E-replay** — `fold-replay.ts` + 새 fold 프롬프트. 7059로 옛/새 비교.~~ **완료 (§4b)**
2. **A+B 서버** — pins 상태 재해석 + `taught_count` DDL + 마이그레이션 UPDATE · ratings 행 `decision` · refine(전체 로드·전체 검증·새 것만 재시도·델타) · fold(consume 제거) · pins POST reteach. *(1일)*
3. **C 워크벤치** — Your decisions 카드 · 행 칩 · rationale 규칙 · diff 토글 · isMember(D1). *(1일)*
4. **D 모달** — rail 전체 ✓/✗ · Also moves · footer 문구. *(0.5일)*
5. **보드** — `page.tsx heldPins`를 계산값(taught && !holds)으로(D1-유지) 또는 제거(D1-폐지); `effectiveRatings` 그대로/제거. *(0.25일)*
6. **F 로깅·트레일 + 문서** — payload 3종, describeEvent, `STUDY_TRAIL_SPEC.md` §2.6 추가, `INTENT_WORKBENCH_V3_PLAN.md` §G에 개정 링크. *(0.25일)*
7. **검증** — §5. *(0.5일)*

합계 약 4일. 1→2→(3,4 병행)→5→6→7.

## 4. 결정

- **D1 (확정 2026-08-18: 유지).** ✗ 결정은 보드/워크벤치에서 계속 판정을 덮는다(§G Layer 1 그대로). 파일럿이 깬 건 Layer 1이 아니라 Layer 3이고, 본 스터디 전에 의미론을 두 번 바꾸지 않는다. 정직함은 ✗ 카운터와 행 칩(`· held by your call`)이 맡는다. 런타임(신규 쿼리)은 지금처럼 정의 단독 — 바뀌지 않는다.
- **D2 (확정 2026-08-18: 소프트 80단어 / 하드 700자).** replay에서 후보가 68단어·479자로 나와 예산 안에 편안히 들어왔고, 같은 원장에서 옛 시스템은 166단어·1,127자였다. 예산이 무는 지점이 맞다.
- **D3. 델타 모집단(일반 보드).** 스터디 클론은 검토 세트 15개로 확정. 연구자 보드는 "현재 in + Potential, 상한 20"이면 충분한가 — 구현 시 확인.

## 4b. Replay 결과 (2026-08-18, 커밋 1)

`scripts/score/fold-replay.ts 7059 --verify` — 파일럿의 이유 달린 결정 12개를 씨앗 정의(288자)에 **한 번에** 접고, 검증 루프를 옛 라우트와 같은 모양으로 돌린 뒤, planning 44문항을 후보로 재판정:

| | 옛 시스템 (fold 10회, 세션 실제) | 새 프롬프트 (fold 1회 + 재시도) |
|---|---|---|
| 정의 길이 | 1,127자 · 166단어 | **479자 · 68단어** |
| 결정 재현 (정의 단독) | 12/12 | **9/12** |
| planning 44문항 소속 | 22 | 24 (+4 / −2) |

읽는 법:
- **길이 예산과 배치 fold가 듣는다** — 열거가 사라졌다("historical labor-market rates, future labor-market effects, trends, or predictions…" → "employment data, trends, or impacts").
- **12/12 → 9/12는 비용이 아니라 설계의 이전**이다. 옛 12/12는 정의를 1,127자로 만들어 산 것이고(=과적합), 새 9/12는 일반화하는 479자 + **원장이 보장하는 3개**다. D1(override 유지)이 바로 이 거래를 성립시킨다. 못 지키는 3개는 붙여넣은 프롬프트 경계 — 파일럿에서도 참가자가 세 번 다시 핀한 바로 그 항목들이다.
- **+4는 실제 후퇴이고, 그래서 델타 패널이 계획에 있다.** 그중 2개는 핀된 out이라 override가 잡지만, 나머지 2개("Hi! I have an essay…")는 핀이 없어 잘못 들어온다. 참가자는 apply 전에 "Also moves +4 −2"로 보고 결정할 수 있어야 한다.
- **판정 잡음 주의**: 같은 live 정의를 두 번 재판정했더니 20/44와 22/44가 나왔다(≈9%, 파일럿에서 관찰한 수치와 같다). 표의 한 자리 차이를 해석하지 말 것.
- `--seq`(결정 하나씩 12회 fold)는 프롬프트 효과와 배치 효과를 분리하지만 강한 모델 12회라 이번엔 돌리지 않았다.

## 5. 검증

- **replay**: 7059 원장 12개 → 옛/새 fold 정의 길이·주제어 유무·판정 소속 비교(새 쪽이 짧고 소속이 같거나 더 넓어야 함).
- **run-swag**: 연구자 NIRVANA 보드에 임시 intent(템플릿 Provide Examples) → 핀 4개 → Update(모달에 결정 4개 ✓/✗ + Also moves) → Apply → 카드 "4 hold · 0 don't" → 정의를 손으로 좁혀 Apply → 카드 "2 hold · 2 don't", ✗ 행에 rationale·액션 노출, ✓ 행은 `▸ why` → Move to new intent → 스핀오프 씨앗 확인 → purge + 이벤트 정리 (2026-08-18에 같은 절차로 확인한 바 있음).
- `tsc --noEmit` · `next lint` · `next build`.
- export: JELSON 재생성 시 기존 consumed 12개가 `taught`로 읽히고 trail이 깨지지 않을 것.

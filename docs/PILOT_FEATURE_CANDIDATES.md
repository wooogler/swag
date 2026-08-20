# JELSON 파일럿 → 시스템에 적용할 기능 후보 (2026-08-18)

> 근거: `reports/JELSON/analysis.md` (§3.2 fold 루프, §3.3 rule 없는 배포, §6, §7 인터뷰) + 2026-08-18 룰 생성 과정 재검토(`rules/block2`, `score_rule_versions.instruction`, `propose-prompt.ts`) + 부모→자식 rule 전파 논의(설계 §3.5 carve-out).
> 형식: **지금 이렇게 된다 → 이렇게 바꾼다 → 화면에서는** 순. 크기 S/M/L, 상태(바로 / 결정 필요 / 진행 중).

## 한눈에

| 지금 당장 (S) | 곧 (M) | 결정 필요 |
|---|---|---|
| 1 배포 전 "rule 없음" 게이트 · 5 type 기본 rule 배지 · 6 제목 재검토 넛지 · 9 rewrite 앵커 누출 방지 · 12 스터디 도구(비교 설문·인터뷰 가이드·타이머) · 13 계측 | 2 Apply 전 교차 질문 미리보기 · 3 fold 결과 검토 목록(결정 원장 계획과 합침) · 4 부모 rule → 안 건드린 자식 따라가기 | 4(설계 §3.5 carve-out) · 7 rule에 WHEN 안 쓰기(프롬프트, 재측정 필요) · 8 강제 장치(푸시백·상한·빈칸) · 10 Phase 2 pre-seed/시간 · 11 type 경계 |

---

## A. 배포 전

### 1. "rule 없음" 확인 게이트 — S · 바로
- **지금**: Deploy 모달에 "No rule yet"이 표시되지만 JELSON은 마지막 저장 **7초 뒤** 배포. 결과: 가장 막고 싶어 한 *Draft Prompt Essay*, *Proofread*, *Interpret Assignment Requirements* + type 기본 4개가 시스템 프롬프트 없이 배포 → 테스트 8문항 중 4문항이 맨 GPT 응답(1·1·2·4점). 인터뷰에서도 rule을 "못 쓴" 게 아니라 "못 본" 것.
- **바꾸면**: Deploy 버튼 → 한 단계 확인. rule 없는 곳의 목록(질문 수 포함)과 그 의미를 한 문장으로.
- **화면에서는**:
  ```
  Deploy chatbot v1?
  ⚠ 3 sets and 4 type defaults have no rule — students asking those questions get NO instructions.
    · Draft Prompt Essay (5 questions in your review set)
    · Proofread (10)   · Interpret Assignment Requirements (1)
    · Planning / Translating / Reviewing / Drafting defaults
  [Write rules first]   [Deploy anyway]
  ```

## B. Rule 쓰기

### 2. Apply 전 교차 질문 미리보기 — S~M · 바로
- **지금**: 피드백 → 변형 3개(앵커 응답만) 고르기 → Apply. 다른 질문 응답은 Apply **뒤** 보드가 만들고, 그 전에 보려면 탭을 직접 눌러야 함(JELSON 0회 — `rule_apply` "v4 on 6…" 카운트가 저장 응답 수와 정확히 일치). 4개 rule 전부 **질문 1개로만 검증**되고 라이브. Baseline에선 저장마다 59개 프리뷰가 보였고 "7~8번째에 across the board로 클릭"(인터뷰 7.4).
- **바꾸면**: 변형을 고르면(또는 Apply 옆) 같은 set의 다른 질문 2~3개(subtype 다른 것 우선)에 자동으로 돌려 나란히 표시. Apply는 그걸 보고 누른다.
- **화면에서는** (7064 *Draft Body Paragraph* v3 선택 후):
  ```
  Tried on 3 more questions in this set:
   ✓ "write a conclusion"                        → 4-part scaffold, no prose
   ✓ "Write the third body paragraph"            → scaffold
   ✗ "write my second paragraph using these…"    → 5 sentences of finished prose
  [Apply v3]   [Give feedback on ✗]
  ```
- 비용: 선택당 프리뷰 2~3회. `generateUpdated(ids, …)`가 이미 다건을 지원.

### 5. Type 기본 rule을 먼저 쓰게 유도 — S · 바로
- **지금**: JELSON은 type 기본 rule 4개 중 **0개** 작성. rule 4개 내용이 사실상 하나("쓰지 말고, 짧게, 출발점만, 빈칸 금지")인데 intent마다 다시 썼고 3개는 못 씀. 기본 rule을 쓸 수 있다는 걸 몰랐거나 못 봤음.
- **바꾸면**: 보드 type 헤더에 "No default rule" 배지 + 첫 intent 생성 전 "Planning 질문 전부에 적용될 기본 rule부터 쓸까요?" 한 줄. (4번과 합치면 기본 rule이 그 안의 안 건드린 set에 그대로 흘러감 — stance를 **type당 1번**만 쓰면 됨.)
- **화면에서는**: `Planning · 12 questions · ⚠ No default rule — questions no set claims get no instructions. [Write it]`

### 7. Rule에 적용 조건(WHEN)을 쓰지 않기 — **2026-08-19 적용**
- **지금이었던 것**: rule 4개 전부 "When a student asks you to X… (but not Y)"로 **정의를 rule 안에 다시 베껴 넣음**. 원인은 빈-rule 강도 사다리가 트리거 폭으로 등급을 매긴 것. fold로 정의가 바뀌면 rule 속 사본이 어긋나고, one-layer라 else가 없어 지시가 0이 된다. 이식성도 깎인다.
- **적용**: 사다리를 **행동 서술 깊이**로 교체 + 적용 조건 금지 명시(baseline 단일 프롬프트는 예외 — 거긴 조건이 필요하다).
- **측정**(30생성/arm): 준수 **25/5/0 vs 24/6/0**(동률), 조건절로 시작한 rule **12/18 → 0/18**, 과제 주제어 **2/18 → 0/18**. 1차 시도는 minimal에서 "대신 무엇을"이 빠져 canonical 2/2/2로 나빠졌고, 모든 등급에 복원해 10/2/0으로 회복.
- **화면에서는** (같은 피드백 "dont rewrite for them but guide them"): 전 *"When a student asks you to directly rewrite… This applies to … but not to feedback…"* → 후 *"Guide the student on how to revise the text instead of rewriting it for them. Name the changes to make — tone, clarity, word choice — and give only incomplete stems."*

### 8. 강제 장치(푸시백 절 · 숫자 상한 · 빈칸 예시) — **2026-08-19 3줄→1줄, 2026-08-20 그 1줄의 조건을 코드로**
- **문제였던 것**: 프롬프트가 **모든 변형에** 셋을 강제. 사용자는 그런 요구가 있는 줄 몰랐고, JELSON은 빈칸을 빼는 데 한 라운드를 썼다. `analysis.md` §2.1/§6.8이 "모델 습관"이라 한 것은 오기 — 우리 요구였다.
- **1차 측정**(12생성×4설정): 세 줄 **8/4/0** · 미완성-예시 한 줄만 **9/3/0** · 추상 표현 **3/8/1** · 전부 제거 **1/11/0** → 한 줄만 남김.
- **그 한 줄이 오작동했다**(데모, 2026-08-20): "예문 하나 달라"는 피드백에 **9/9 룰이 빈칸을 강제**하고 챗봇도 따랐다(`exaggeration — The report may ___ the risks.`). 조건("감춘 출력의 대체물일 때")을 모델이 무시한다. 문구 변형 4종 전부 실패 — 오염을 잡으면 억제 케이스가 무너진다(4/6/2 · 6/6/0 · 7/4/1 vs 무조건 11/1/0).
- **적용**: 조건을 **코드로**. `classifyWithholding`이 피드백만 보고 "학생이 요청한 출력을 빼앗는가"를 판정 → 프롬프트는 무조건 문장을 받거나 아무것도 안 받는다. **오염 0/9 + 억제 12/0/0.** 분류기 15/15(실패 시 false = 순수 프롬프트).

### 9. rewrite 모드 앵커 누출 방지 — **2026-08-19 적용**
- **지금이었던 것**: 7064 v6/v7 *"including a rephrase like 'write the second paragraph,'"* = 앵커 130025 원문.
- **적용**: 프롬프트에 "앵커는 증거일 뿐 — 학생의 표현을 인용·환언하지 말고 그들이 가져온 텍스트나 주제를 지목하지 말 것" + 라우트에서 앵커 n-gram 검출 시 그 변형만 제외(전부 걸리면 전부 통과 — 문체 규칙이 저작을 막아선 안 된다).
- **결과**: 금지 전 39개 rule 중 1건 인용, 금지 후 0건. 모델에게 대놓고 인용하라고 시켜도 인용하지 않아, **라우트 필터가 실제로 발동하는 것은 관측되지 않았다**(검출기 자체는 파일럿의 실제 유출로 검증).

## C. 부모 ↔ 자식 rule

### 4. 부모 rule 수정 → 안 건드린 자식은 따라가고, 고친 자식은 알림만 — M · 결정 필요(설계 §3.5 carve-out)
- **지금**: 자식은 생성 시 부모(가장 가까운 rule 있는 상위, 최종 type 기본) rule의 **복사본**으로 시작하고, 이후 부모를 고쳐도 자식은 그대로. 알림도 없고(설계가 약속한 "N개 검토?" 넛지 미구현), 보드 칩(`IntentBoard.tsx:585`)은 부모 **현재** 텍스트와 비교하므로 안 건드린 자식이 `own rule`로 뒤집히며 툴팁 "the difference is what it adds"는 거짓. SWAG 조건에선 모든 새 intent가 Planning 기본 260자로 시작 → 나중에 Planning 기본 rule을 고치면 그 안의 set들만 옛 rule(자식 ⊆ 부모라 instructor 눈엔 "Planning 질문"인데). 파일럿 흐름은 정의 22분 → rule 10분의 bottom-up이라 copy-on-create가 할 일이 없었음. DB에 중첩 intent 0개 — 실제 부모는 type 기본.
- **바꾸면**: 부모(set 또는 type 기본) Apply 시 "아직 부모와 글자 그대로 같은" 자식만 새 텍스트로 갱신(각 자식에 버전 기록 `Follows Planning v3` — 되돌리기 가능), 이미 고친 자식은 건드리지 않고 목록으로 알림. 원칙 한 문장: **"A set answers like the set around it until you give it its own rule."** 레이어 합성·자동 머지는 하지 않음(one-layer 유지: Try에서 본 것 = 학생이 받는 것).
- **화면에서는**:
  ```
  Apply Planning's default rule v3?
   Also updates 2 sets still using this rule: Interpret Assignment Requirements, Generate Task Examples
   1 set started from this rule and changed it: Draft Prompt Essay → [Review]
  [Apply]
  ```
- **최소안**(전파를 안 하기로 해도): 칩을 자식의 v1 seed와 비교해 `unchanged since created (Planning changed since)`로 정직화 — S.

## D. 정의 만들기 (fold 루프)

### 3. 결정을 모아서 fold + fold 결과를 "검토 목록"으로 — M · 결정 원장 계획과 합침
- **지금**: 핀 1~2개마다 fold → 44개 전체 재판정 → 부수 flip 43건, 핀 결정 회귀 4건 → 재핀 5회, 한 intent에 13.7분. JELSON: "첫 find 이후엔 도구가 스스로 추가하지 말고 사이드바에 올려 내가 in/out 하게"(인터뷰 7.3).
- **바꾸면**: (a) "결정 N개 대기 중" 카운터로 fold를 모아서; (b) fold 뒤 소속이 바뀐 질문을 들어옴/나감 목록으로 정면에 — 각 행에 in/out + 이유. 본인이 결정한 건 hold(결정 원장). D3(델타 모집단)에서 "검토 세트 15개"보다 넓게 갈지는 이 발언을 근거로 결정.
- **화면에서는**:
  ```
  Your definition changed. 11 questions moved:
   ↑ now in (8):  "what does the future of automation look like" · you said in ✓ …
   ↓ now out (3): "Unemployment rate in the 1950s" · you said in → still routed in (holds)
  [Keep these]   [Review one by one]
  ```

### 6. 제목 재검토 넛지 — S · 바로
- **지금**: 7059 정의 288→1,127자(×3.9)로 자랐는데 제목 "Generate Task Examples" 그대로. 실제 내용은 planning의 리서치 요청 catch-all.
- **바꾸면**: fold로 정의가 크게 바뀌면(길이 ×2, 또는 `suggestedTitle`이 다르면) "제목이 아직 맞나요? 제안: 'Research material requests'" 한 줄. (`suggestedTitle`은 이미 있음 — 제목이 빌 때만 쓰임.)

### 11. Type 경계 마찰 — 지금은 계측만
- 인터뷰 7.2 "criteria should be based on the entire question set rather than planning/translating/reviewing". 기능화(cross-type set)는 v7 근간을 건드리므로 본 스터디에선 인터뷰 문항으로. 선택: 워크벤치에서 다른 type 질문을 찾았을 때 "이 질문은 Translating입니다 — Translating에 set을 만드세요" 안내.

## E. 스터디 도구·프로토콜

### 10. Phase 2 작업량 비대칭 — 결정
- **지금**: SCORE 블록 = 정의 22분 + rule 10분, baseline = rule만. JELSON: "phase two가 훨씬 컸다. intents가 미리 있거나, phase two는 intents만"(7.7).
- **선택지**: (a) 마스터 큐레이션 intent 2~3개/type를 rule 없이 pre-seed → 참가자는 정의 다듬기 + rule 쓰기(RQ1 '조직' 측정이 일부 주어진 것이 됨), (b) SCORE 블록 시간 +5~10분, (c) 3·4·5번으로 정의·rule 시간을 줄여 대응.
- **화면에서는** (a): 블록 2 시작 화면에 Planning 아래 "Interpret Assignment Requirements", "Answer a topic question" 등이 이미 있고 각각 `No rule yet`.

### 12. 설문·인터뷰·시간 — S · 바로
- 두 시스템 **직접 비교 설문**(마지막 1회): "다음 학기에 어느 쪽? 왜?" + 항목별(통제감·간섭·커버리지·노력).
- **인터뷰 가이드**: type 경계 적합성(7.2) · fold 후 자동 변경 vs 검토 목록 선호(7.3) · 정의 이식성 실측 — "이 정의를 다른 과제에 그대로 쓸 수 있나, 읽어보라"(7.5) · 조건별 작업량 체감(7.7).
- **25분 타이머·진행자 알림**(§6.1). 블록 테스트는 2-pass 유지, 5문항 축소는 시간 레버 옵션(7.6).

## F. 계측 — S · 바로
### 13.
- `variant_choose{strength}` (고른 강도가 기록 안 됨 — title/note만), `proposal_dismiss` (7064 18:32:51 라운드처럼 제안을 전부 버린 경우 구분 불가).
- 핀 이유 이력 보존(재핀 시 덮어써 이전 이유가 사라짐), fold별 flip 리포트, trail export에 instruction 원문·실제 라우팅·질문 텍스트·검토 세트 목록(§6.9–14).

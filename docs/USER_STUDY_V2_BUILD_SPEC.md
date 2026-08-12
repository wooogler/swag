# 유저스터디 v2 반영 — 확정 빌드 스펙 (Opus 핸드오프)

> 작성 2026-08-12. `USER_STUDY_V2_DELTA_PLAN.md`의 결정 4건이 확정되어 이 문서가
> **구현 지시서**다. 소스 오브 트루스: `USER_STUDY 설계 v2.md` + `USER_STUDY 문항지
> v1.md`(UI 카피는 문항지 **원문 그대로**). 아래 파일·라인 앵커는 2026-08-12
> HEAD(`a382a86`) 기준 — 구현 시 grep으로 재확인하고 시작한다.
>
> **확정된 결정.**
> - **D1** 큐레이션은 현행 유지 — LLM 등급을 보며 2~3인이 같이 고르는 admin 도구로 충분. 인간 독립 라벨링 기능 만들지 않음.
> - **D2** Baseline 포인팅 = RULES 문서에서 **드래그 하이라이트**.
> - **D3** A/B는 데이터까지 삭제하고 기능 전면 제거.
> - **D4** 데모는 기존 구현 유지(이미 완성 — V4는 검증만).

## 지상 규칙 (기존 스펙과 동일)

- 새 컬럼·테이블은 `ensureStudyTables()`(`src/lib/study/store.ts`)에 `ADD COLUMN IF
  NOT EXISTS`로, `src/db/schema.ts`에 미러. drizzle 마이그레이션 안 씀.
- 참가자 대면 카피는 문항지 §0·3·4의 영어 원문을 **글자 그대로** 싣는다.
- 각 마일스톤 끝: `npx tsc --noEmit` + `rm -f tsconfig.tsbuildinfo && npx next build`
  + 해당 check 스크립트. 실 DB 검증은 `npx tsx --env-file=.env`(env 없으면 인증 실패로
  죽는다 — 알려진 함정).
- 파괴적 실행(STOP 표시)은 지우기 전에 지울 것을 출력하고 확인받는다.

---

## V1 — A/B 전면 제거 (+ 데이터 삭제)

### 코드 제거 (전부 확인된 앵커)

| 파일 | 할 일 |
|---|---|
| `src/lib/study/phases.ts:19-30` | `STUDY_PHASES`에서 `'ab'` 제거. `PHASE_LABELS`(:47), `PhaseAccess.showAb` 필드 + `phaseAccess`의 `case 'ab'`(:160-161) 제거. `blockOf` 주석 정리 |
| `src/lib/study/advance.ts:36-37` | 생성 요구 맵의 `block1_survey/block2_survey: { kind: 'ab' … }` 두 엔트리 제거 — survey에서 나갈 때 ab 생성을 기다리던 로직. 파일 전체에서 ab 분기 소거 |
| `src/app/study/session/page.tsx:143-151` | `access.showAb` 분기(랜딩의 A/B 카드) 제거 |
| `src/app/study/session/ab/` | 디렉토리 삭제 (`BlindAb.tsx`, `page.tsx`) |
| `src/app/api/study/session/ab/` | 디렉토리 삭제 |
| `src/lib/study/measure-store.ts:277-417` | `AbChoice`·`AbItem`·`sideSeed`·`getAbItems`·`recordAbChoice` 제거 (seededShuffle은 test가 쓰므로 유지) |
| `src/lib/study/config.ts:102-113` | `DEFAULT_SET_TARGETS` → `{ review: 15, test: 2 }`. `SET_TARGET_LIMITS`에서 ab 제거. `CurationSetKind`가 `review \| test`로 좁아짐 — member/clear 라우트의 zod enum은 `CURATION_SET_KINDS`를 따라 자동 |
| `src/lib/study/curation.ts:798,860-866` | violation code 유니온에서 `'ab_balance'` 제거 + 해당 검증 블록 제거. `boundaryTargetFor`·`validateCuration`에서 ab 참조 소거 |
| `src/app/study/admin/curation/CurationBoard.tsx` | `SET_LABELS`에서 ab 제거 → 진행 카드 3→2 (`lg:grid-cols-3`→`lg:grid-cols-2`), 타깃 모달의 A/B 행·"A/B is drawn from both datasets…" 문단 제거, 행 hover 배정 버튼의 A/B 제거 |
| `src/lib/study/console-store.ts:65,90,212,300-341,369,414-416,464` | 클론 준비도·참가자 진행의 `ab` 필드, ab 뱅크 카운트, `GENERATION_KINDS` → `['test']`, advance blocker의 A/B 메시지 제거 |
| `src/app/study/admin/console/SessionConsole.tsx:66,145,285,473,527-529` | A/B 진행 표시·`generate('ab')` 버튼·완료 판정에서 ab 항 제거 |
| `src/lib/study/generate.ts:52` | `BankKind = 'test'`로 좁힘 (타입은 유지 — warm.ts·console-store가 import) |
| `src/lib/study/warm.ts:82` 부근 | kinds 루프가 GENERATION_KINDS를 따르면 자동; ab 하드코딩 있으면 제거 |
| `scripts/study/build-question-bank.ts` | ab 블록(균형 블록 생성부) 제거 — test 8문항만. 파일이 48줄로 작으니 통째 정리 |
| `scripts/study/export-metrics.ts:170-178` | `score_was_home` 등 ab 섹션 제거 (V5에서 재편) |
| `src/lib/study/store.ts:278-287` | `study_ab_answers` CREATE/INDEX 제거. `src/db/schema.ts:795-804` `studyAbAnswers` 테이블 + `StudyAbAnswer` 타입(:908) 제거 |
| check 스크립트 | `check-measure.ts`(side 배정 테스트 삭제), `check-session-walkthrough.ts`(v2 페이즈 흐름으로), `generate-responses.ts`(kind 인자), `seed-fake-curation.ts`(ab 시드 제거) |

### 데이터 삭제 — `scripts/study/remove-ab.ts` 신규 【STOP: --apply 전 확인】

```
--apply 없으면 개수만 출력:
  DELETE FROM study_generated_responses WHERE purpose = 'ab';
  DELETE FROM study_question_bank      WHERE kind = 'ab';
  DELETE FROM study_set_members        WHERE set_kind = 'ab';
  UPDATE study_participants SET phase = 'done' WHERE phase = 'ab';
  DROP TABLE IF EXISTS study_ab_answers;
```
phase='ab'에 걸린 참가자는 테스트 계정뿐(무시 승인됨) — 'done'으로 밀어 콘솔이
안 깨지게 한다.

### 검증
- `check-session-walkthrough` 전 구간(…block2_survey → done) 통과
- 큐레이션 보드: 카드 2개, 타깃 모달 2행, lock 검증에 ab 규칙 없음
- 콘솔 로드 + Generate(test)만 노출. tsc/build.

---

## V2 — 블록 테스트 4단계 (포인팅 + 게이트 확장)

시스템이 담는 것: **짐작 → 포인팅 → (게이트) 공개 → 판정**. 서술(①)과 프로브(④)는
구두(문항지 §3) — UI에 넣지 않는다.

### DDL — `study_test_answers`에 추가 (store.ts + schema.ts:778-790)

```sql
ALTER TABLE study_test_answers ADD COLUMN IF NOT EXISTS pointed_kind text;        -- 'intent'|'none'|'not_sure' (SCORE) / 'span'|'nothing'|'not_sure' (Baseline)
ALTER TABLE study_test_answers ADD COLUMN IF NOT EXISTS pointed_intent_id integer;
ALTER TABLE study_test_answers ADD COLUMN IF NOT EXISTS pointed_span_start integer;
ALTER TABLE study_test_answers ADD COLUMN IF NOT EXISTS pointed_span_end integer;
ALTER TABLE study_test_answers ADD COLUMN IF NOT EXISTS pointed_text text;
ALTER TABLE study_test_answers ADD COLUMN IF NOT EXISTS pointed_at timestamp;
```
`pointed_text`는 하이라이트 원문 그대로 — 오프셋은 재배포로 rules 텍스트가 바뀌면
어긋날 수 있으니 원문을 함께 저장(분석은 원문 우선).

### measure-store.ts

- `recordGuess`: **응답을 더 이상 반환하지 않는다** (guess 저장만, 첫 답 고정 유지).
- 신규 `recordPointing(args: { cloneAssignmentId, bankItemId, pointing })`:
  - guess가 아직 없으면 `{ error: 'guess_first' }` (UI 순서 강제 — 문항지 §3 순서
    서술→짐작→포인팅).
  - `pointed_at IS NULL`일 때만 기록(첫 답 고정, guess와 동일 규칙).
  - 생성 응답이 없으면 `{ error: 'no_response' }` (기존 recordGuess와 같은 이유).
  - 성공 시 `{ response }` 반환 — **공개는 여기서**.
- `getTestItems`: 게이트 조건을 `guess !== null && pointedAt !== null`로. TestItem에
  `pointing` 상태 필드 추가(재접속 복원용).

### API — `src/app/api/study/session/test/route.ts`

action 유니온 확장:
```ts
const pointingSchema = z.object({
  action: z.literal('pointing'),
  bankItemId: z.number().int().positive(),
  pointing: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('intent'), intentId: z.number().int() }),
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('not_sure') }),
    z.object({ kind: z.literal('span'), start: z.number().int().min(0),
               end: z.number().int().positive(), text: z.string().min(1).max(2000) }),
    z.object({ kind: z.literal('nothing') }),
  ]),
});
```
intentId는 스냅샷 config의 intent id와 대조해 검증(임의 숫자 거부).

### UI — BlockTest.tsx (문항지 §3 원문 카피)

아이템별 단계 머신: `guess==null` → 짐작 카드 → `pointing==null` → 포인팅 카드 →
응답 + 판정 카드.

- **짐작 카드** (현행 :153-178 유지, 버튼 라벨만): 질문 문구는 이미 원문과 일치
  ("Will your chatbot answer this the way you intend?"). 버튼 `Yes` / `No`로 단순화.
- **포인팅 카드 (SCORE)**: *"Which intent do you expect this question to fall under —
  if any?"* — `config.intents.filter(i => i.kind === 'intent')`를 제목 버튼 목록으로
  (트리 순서 = SnapshotConfigView의 `orderChain` 재사용), + `None of them` +
  `Not sure`.
- **포인팅 카드 (Baseline)**: *"Which part of your Rules document do you expect to
  shape the response — if any?"* — 안내문 "Drag over the part of your rules on the
  left, then confirm." + 선택 미리보기(따옴표 인용) + `Confirm highlight`(선택 없으면
  비활성) + `Nothing specific` + `Not sure`.
- **판정 카드** (:190-213): 헤드라인을 원문으로 — *"How well does this response match
  what you intended?"* 앵커 *"Not at all what I intended"* / *"Exactly what I
  intended"*.
- 공개 전에는 응답 카드 미렌더(게이트가 payload에서 이미 막지만 UI도 단계를 따름).

### SnapshotConfigView.tsx — 드래그 캡처

- 옵셔널 prop `onRulesSelection?: (sel: { start: number; end: number; text: string })
  => void`. baseline 분기의 `<pre>`(:57-59)에 `ref` + `onMouseUp`:
  `window.getSelection()` → range가 pre **내부**인지 확인 → pre 기준 문자 오프셋 계산
  (pre의 자식은 단일 텍스트 노드 — `config.rules` 문자열 하나 — 이므로
  `anchorOffset`/`focusOffset` 정렬로 충분하나, 방어적으로 Range를 pre 시작에서 접어
  `toString().length`로 계산). 접힌(빈) 선택은 무시.
- prop 미전달 시 기존과 동일(작업 화면·데모에서 재사용되므로 기본은 읽기 전용).

### 함정 (검증됨)

- **재접속 복원**: guess만 있고 pointing이 없는 채 새로고침 → 포인팅 카드부터
  재개되고 응답은 여전히 잠겨 있어야 한다 (`getTestItems` 게이트가 근거).
- 첫 답 고정: pointing 재제출은 무시(guess와 동일) — 응답을 본 뒤 포인팅을 바꿀 수
  없어야 객관 채점이 성립.
- 판정(rating)은 pointing 없이 도달 불가 — recordRating 앞에 상태 확인 추가.
- walkthrough 스크립트가 guess만 넣고 응답을 기대하면 깨진다 — pointing 단계 추가.

### 검증
- 실 클론 SCORE/Baseline 각 1회: 게이트(포인팅 전 응답 없음), 드래그 오프셋·원문
  일치, 첫 답 고정, 새로고침 복원. `check-measure.ts`에 pointing 케이스 추가.

---

## V3 — 미니 설문 교체 (문항지 §4 원문)

- `src/lib/study/survey-items.ts` — 기본 문항 9개(:34-96)를 **5개로 교체**
  (construct 유니온 `'control'|'trust'|'load'` 유지 — load가 문항지의 '부담'):

| key | construct | 문항 (원문 그대로) |
|---|---|---|
| `control_future` | control | I felt in control of how the chatbot will behave. |
| `control_achieve` | control | I could get the chatbot to behave the way I wanted. |
| `load_mental` | load | Setting up the chatbot was mentally demanding. |
| `load_frustration` | load | I felt frustrated while setting it up. |
| `trust_future` | trust | I trust this chatbot to handle future student questions in line with my intent. |

- 앵커: `Strongly disagree` / `Strongly agree`. 기본 척도 7(이미 기본값) —
  5/7 선택지는 [파일럿]용으로 유지.
- 참가자 설문 화면(`BlockSurvey`) 지시문을 원문으로: *"Thinking about the version you
  just used, please rate your agreement with each statement."*
- **저장된 구성·응답 리셋** 【STOP】: `study_survey_answers`의 테스트 응답 삭제 +
  `resetSurveyItems` (respondent가 남아 있으면 scale_locked에 걸리므로 응답 삭제가
  먼저). `remove-ab.ts`에 `--reset-survey` 플래그로 같이 싣거나 별도 스크립트.

---

## V4 — 데모(라이브 튜토리얼) 검증 — **완료 2026-08-12**

검증 결과: 데모 인프라는 v2 요구를 그대로 충족했고, 코드 변경은 **취소된 영상 슬롯
제거 한 건**뿐이었다.
- 양 조건 진입 확인 — SCORE는 intent 트리 스튜디오(New intent / Deploy), Baseline은
  RULES 에디터(Deploy). 재료는 격리 subtype 학생들의 대화 32문항(전체 507 아님).
- `is_demo` 제외 실측 — 콘솔 12명에 DEMO 행 없음, export도 participants 12.
- **운영 메모: 데모 버튼은 진입까지 ~20초** 걸린다(클론을 지우고 다시 만든다). 12초
  대기로는 아무 일도 안 일어난 것처럼 보인다 — 시연 전에 미리 눌러 둘 것.
- `TUTORIAL_VIDEOS` / `TutorialStep`의 16:9 빈 슬롯 제거: v2가 영상을 영구 취소했으므로
  (§5) 오지 않을 것을 위한 자리를 비워두지 않는다. 문구는 진행자 시연을 명시.

### (원 계획) 검증 항목

`src/lib/study/demo.ts`가 v2 요구를 이미 충족한다: 실제 시스템(프리뷰 아님), 격리
demo subtype 대화만으로 클론 재구축(진입마다 재생성), DEMO-SCORE/DEMO-BASELINE 두
참가자(조건별), `is_demo`로 콘솔·export 제외, `/study/admin` 복귀 쿠키.

할 일은 **워크스루 검증**뿐:
1. `/study/admin` → 데모 진입(양 조건 × 양 데이터셋) → 시연 사이클(§5: intent 생성→
   수정→rule→예제→프리뷰→배포 / Baseline: 검색→filter 저장→rule 수정→프리뷰→배포)이
   데모 클론에서 전부 동작.
2. `is_demo` 제외가 콘솔·export·`remove-ab` 카운트에 실제로 걸리는지 grep + 실행 확인.
3. 랜딩의 튜토리얼 스텝(`TUTORIAL_VIDEOS` null → 클릭 진행)이 라이브 시연의 페이싱
   스텝으로 그대로 쓰임 — 카피만 확인: "Your facilitator will walk you through this
   version" 계열로 되어 있는지, 아니면 한 줄 수정.

---

## V5 — export 재편 + 큐레이션 소프트 경고

### export-metrics.ts

- `test.csv`에 추가: `pointed_kind, pointed_intent_id, pointed_text,
  applied_intent_id, applied_outcome, pointing_correct`.
  - `applied_*`는 `study_generated_responses.applied` JSON에서
    (`{ intentId, intentTitle, rule, outcome: 'intent'|'type_default', type }` —
    deploy-store.ts:313-319 확인됨).
  - `pointing_correct` (SCORE만): `kind='intent'` → `pointed_intent_id ===
    applied.intentId`; `kind='none'` → `applied.outcome === 'type_default' ||
    applied == null`; `not_sure` → 공란. Baseline은 채점하지 않고 kind·원문만 내보냄
    (설계 §6: "Baseline은 포인팅 양상 자체를 코딩").
- 블록·조건별 요약에 **확신 보정** 추가: 짐작 '예' 개수 vs 판정 4–5 개수.
  (`prediction_correct`의 ≤3 접기는 이미 구현되어 있음 — :119,132 확인.)
- misalignment 코딩 재료: 판정 ≤3 문항만 모은 `misalignment.csv`
  (participant, block, condition, question, rating, guess, pointed_*, applied_*).

### curation.ts — validateCuration에 경고 추가

- code `'test_subtype_spread'`, severity `warning`: 각 유형의 test 멤버가 그 유형
  **최빈 2 subtype**(state.subtypes의 clearlyIn 상위 2) 밖이거나, 최빈 2가 한 문항에
  몰려 있으면 표시. 차단하지 않는다(§4는 지침, 큐레이션 재량).

---

## 순서·게이트

```
V1 (A/B 제거+삭제)   0.5일   게이트: walkthrough v2 흐름 + remove-ab 리포트
V3 (설문)            0.25일  게이트: 설문 왕복 + 7점 저장
V2 (4단계 테스트)     1.0일   게이트: 양 조건 실 클론 + check-measure
V5 (export/경고)     0.5일   게이트: export 실행 + pointing_correct 스팟 체크
V4 (데모 검증)        0.25일  게이트: 양 조건×양 데이터셋 워크스루
문서 정리             0.25일  v1 설계 → docs/_archive/ (완료), 메모리 갱신
──────────────────────────────
합계                 ~2.75일
```

STOP 지점은 두 곳뿐: `remove-ab.ts --apply`(V1), 설문 응답 리셋(V3).

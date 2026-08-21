# SCORE Simple — 시스템 적용 계획 · 구현 완료

**작성:** 2026-08-20 · **기준:** `docs/SCORE_SIMPLE_DESIGN.md`(v2.1) ↔ `study-tools` working tree 실측 대조 · **as-built 참조:** `docs/SCORE_BASELINE_DESIGN.md`(08-05) + 이후 study-tools 커밋들
**지위:** 설계 문서의 의미론을 현행 코드에 배선하는 **구현 계획**. 설계와 이 계획이 어긋나면 설계 문서가 이기고, 코드 서술이 낡았으면 코드가 이긴다.

> **구현 상태 (2026-08-20).** WS1~WS5 전부 구현·검증 완료, 5커밋(`42f3fea`~`1a98b42`). 67파일 +5,546/−234. `npx tsc --noEmit` 통과 · `npm run build` 통과 · `npm run lint` 기존 경고 2건 외 없음 · `scripts/study/check-simple.ts` **score 29/29, baseline 23/23 통과**. 실기동 확인: intent 생성→저장→판정→라우팅 칩→응답 스트리밍→버전 이름 자동 생성까지 브라우저에서 동작 확인.
>
> **계획 대비 바뀐 결정 4건** (모두 구현 중 근거가 생겨 변경):
> 1. **템플릿 intent 복사를 건너뛰지 않는다** — 계획은 simple 클론에서 스킵이었으나, `cloneStarterSet`의 1:1 어서션·핀 순서·격리 검증 스크립트를 건드리는 위험 대비 이득이 작다. 유지하면 두 family의 클론이 프로비저닝 시점에 **바이트 동일**해져 조건 간 출발선이 같다는 이점도 있다. simple 보드는 `score_intents`를 아예 읽지 않으므로 그 행들은 무해한 사문(死文)이다.
> 2. **연구자 프리뷰 허용** — `simpleContext`가 "simple 클론이 아니면 거절"이었으나, 그러면 `?view=simple_score` 프리뷰가 전 요청 409가 되어 패리티 점검이 불가능했다. 지금은 **다른 family의 클론만** 거절하고, 클론이 아닌 과제(연구자 소유)는 통과시킨다. 풀 버전의 기존 관례(라우트는 클론을 따르고 `?view`는 그리기만 바꾼다)와 동일.
> 3. **판정 이벤트는 라우트가 아니라 판정 지점(`judgeBatch`)에서 적재** — 저장 후 백그라운드 패스가 판정의 대부분을 하는데 라우트에서만 로깅하면 그 작업이 기록에서 통째로 빠진다. 검증 스크립트가 이걸 잡았다.
> 4. **보드는 저장의 백그라운드 판정을 기다린다** — 계획에 없던 경합. 보드 루프와 after-save 잡이 같은 캐시를 읽고 같은 쌍을 각자 판정해 **저장마다 LLM 비용이 두 배**였다. `state`가 `working` 플래그를 실어 보드가 대기·재조회하도록 수정. 이것도 검증 스크립트가 잡았다.

> 실측 방법: 워킹 트리 전수 탐색(스튜디오 UI 23파일 ~14.5k줄 · 스터디 기계 · 판정/응답 백엔드 · DB 스키마 4갈래). 아래 파일:라인 참조는 2026-08-20 워킹 트리 기준이다.

---

## 0. 한눈에 — 재사용 대차대조표

설계 §8의 재사용 힌트는 **전부 현존한다**(이름까지 일치). 의미론이 다른 곳만 갭이다.

**이미 있는 것 (그대로 또는 거의 그대로 씀):**

| 설계 요구 | 현행 대응물 | 상태 |
|---|---|---|
| 판정 캐시 = (쿼리, definition 텍스트) §6.2 | `intentDefHash`(`src/lib/score/intents.ts:372`) + `score_intent_ratings` unique **(message, intent, def_hash)** — 해시 키 **이력 보존형**, 되돌리면 즉시 히트 | **일치.** 텍스트 키 판정은 `score_probe_ratings`(assignment, defHash, message)가 intent 행 없이도 이미 함 |
| 소속 = 등급 은닉, 여부만 §6.2 | `INCLUDED_RATINGS=['clearly_in']`, `isIncludedRating`(`intents.ts:94-96`) 한 함수 | **일치.** 5-level 판정기 유지, 렌더만 안 하면 됨 |
| 소속 diff (초록/빨강) §5.5 | `membershipSnapshot`/`membershipDelta`(`rate/route.ts:270-325`)가 intent별 `{gained[],lost[]}` 계산 → `rating_run` 이벤트 | **서버측 재료 있음.** 클라이언트는 두 defHash의 판정 집합 비교로 렌더 |
| first-match 라우팅 §5.1 | `compileChains`(후위 DFS)/`resolveRoute`(포함 보장)(`intents.ts:514/619`) | **타입 무관 변형 필요** — 현행은 타입별 4체인, untyped intent는 skip(`:519`) |
| lazy 응답 (저장 시 생성 안 함) §6.1 | 커밋 `a898356` "reply when someone looks" — 열람 시 단건 생성 + in-place 패치 + 재선택 시 abort(`IntentBoard.tsx:2052-2088`) | **일치.** 커밋 메시지의 근거가 곧 §6.1의 논거 |
| 응답 캐시 = (쿼리, 적용 rule 텍스트) §6.3 | `score_rule_previews`는 unique **(message, intent)** — 룰 고치면 이전 응답 증발. **`baseline_previews`가 정확히 원하는 형태**: unique (message, prompt_hash)(`schema.ts:623`) | **키 갭.** 신규 테이블로 해소 (§2-WS2) |
| digest 컨텍스트 §6.3 | `score_conversation_digests` — 앵커당 1행, **rule 독립**이라 전 버전 재사용(`conversation-digest.ts`) | **일치** |
| 모델 패리티 §6.3 | 모든 프리뷰가 `getChatModel()=OPENAI_MODEL(gpt-4o)`(`injection.ts:65`) — 학생 챗과 동일이 이미 불변식 | **일치** |
| 빈 rule = 시스템 메시지 없음 §5.3 | `preview-service.ts` · `/api/chat` 모두 빈 프롬프트 → 시스템 메시지 생략 (NIRVANA 패리티) | **일치** |
| LLM 버전 이름 §3.3 | `generateIntentTitle`(`intent-agent.ts:46`, nano 모델, 실패 시 null 폴백) + `resolveName` 3단 폴백(`rule-versions/route.ts:66-75`) | **선례 있음, 단 동기 호출** — 비동기화 필요. 백그라운드 패턴은 `warm.ts` |
| 비동기 백그라운드 작업 §6.1 | `src/lib/study/warm.ts` — 모듈 Map + floating promise + latest-wins 재실행 (long-lived `node server.js` 전제) | **템플릿 그대로 복제** |
| 동시성 리미터 §6.3 | `createLimiter(SCORE_LLM_CONCURRENCY)`(기본 64, cap 128) 전 경로 공유 | **일치** |
| 조건 저장·배정 §8 | `study_clones.condition`(plain text, CHECK 없음) · 셀 배정 `CELL_FIRST`(`phases.ts:123`) · `provision.ts:514-528` | **값 추가는 무마이그레이션.** 단 타입·분기 스윕 필요 (§2-WS1) |
| 헤더 칩 설정 가능 §8 | `CONDITION_NAMES` + `NEXT_PUBLIC_STUDY_NAME_*`(`config.ts:171`) | **키 2개 추가** |
| 이벤트 적재 §7 | `logStudyEvent/logParticipantEvent`(`events.ts`) + `ui-events` 라우트(클라이언트 열람 행위, 화이트리스트) | **일치.** 이름 추가만 |
| 판정 배치·진행 표시 §6.2 | `rate` 라우트(shard 파라미터) + `rate-runner.ts`(6샤드 폴링, 진행 집계) | **패턴 재사용** (스트리밍은 원래 없음 — 폴링이 현행 관례) |
| 지표적 결과 명시 §3.4 | 명시적 disclaimer 문구는 **없음**. 기존 관례 = 뷰어의 정직한 상태 문장("This reply is under the rule vN" / "as delivered" / 파란 틴트 + 행 단위 재시도 문구, `IntentBoard.tsx:818-863`) | **이 문장 패턴이 계승 대상** |
| 대화 뷰어·자료 태그·diff 렌더 | `ConversationThread`/`ChatMessages` · `materials.tsx` · `rule-diff.tsx`(무의존 word-diff) · `StudioShell` 프레임 | **leaf 컴포넌트 재사용** |

**없는 것 (이번에 만들 것):**

1. `simple_score`/`simple_baseline` **조건 쌍**과 그 배선 (타입·배정·게이팅·측정·트레일·스크립트).
2. **Simple 대시보드** 컴포넌트 일습 (3컬럼 원페이지: 단일 루트 트리 + 아코디언 에디터 / 프롬프트 인라인 에디터, flat 쿼리 리스트, 뷰어).
3. **전역 스냅샷 버전 축** (Save 단일 동사, 복원=롤백+soft-delete, 비동기 LLM 이름) — 현행은 4축(config/rule/deploy/baseline-prompt)이고 soft-delete는 리포 어디에도 없음.
4. **(message, rule_hash) 응답 캐시** + **스트리밍 프리뷰**(현행 스트리밍은 `/api/chat`뿐) + **프리페치**(현행 전무).
5. **의미론 없는 Pin** (신규 상태 — `score_intent_pins`는 correction이라 재사용 금지, `review_set_items`도 생성 스코프에 쓰여 부적합).
6. `simple_*` **이벤트 8종+** 및 커버리지 검증.

---

## 1. 아키텍처 결정 3개

### D1. 조건 모델 = **family × arm** 2축, 저장은 4값 문자열

`StudioView`를 4값으로 넓히되, 분기는 축 헬퍼로만 한다:

```ts
// src/lib/study/config.ts
export type StudioView = 'score' | 'baseline' | 'simple_score' | 'simple_baseline';
export type StudioArm = 'score' | 'baseline';          // 표현: intent–rule vs monolithic
export type StudioFamily = 'full' | 'simple';           // AI 보조 유무
export function armOf(v: StudioView): StudioArm;        // simple_score → 'score'
export function familyOf(v: StudioView): StudioFamily;
export function pairedCondition(v: StudioView): StudioView; // 같은 family, 반대 arm
```

- **근거**: 실측된 함정 — `phases.ts:137`의 블록2 조건이 **이진 flip**(`=== 'score' ? 'baseline' : 'score'`)이고, `console-store.ts:93` · `measure-store.ts:177` · `generate.ts:168` · `trail.ts:346,705` · `trail-files.ts:451` 등의 `=== 'baseline' ? … : 'score'` 강제 변환은 **미지의 값을 조용히 'score'로 삼킨다.** 이 자리들을 전부 `armOf()`/`familyOf()`로 치환하면 4값이 조용히 깨질 길이 사라진다. 블록 테스트 포인팅(intent 클릭 vs 구간 선택), SnapshotConfigView, 콘솔 요약 등 **대부분의 기존 분기는 실제로는 arm 분기**라 이 치환만으로 Simple이 올바르게 흐른다.
- **배정**: 셀 4개는 그대로 (셀 = 순서×데이터셋 짝). family는 **참가자 속성**으로 추가 — `study_participants.condition_family text NOT NULL DEFAULT 'full'` (런타임 DDL). `blockPlan`이 `CELL_FIRST`의 arm에 family를 합성해 4값 condition을 산출하고, `provision.ts`는 지금처럼 그걸 클론에 도장 찍는다. 연구자 콘솔의 참가자 생성 폼에 family 토글 한 개 추가. → 셀 8개 확장·기존 참가자 마이그레이션 불필요, "기존 참가자·클론·배정 기계 재사용"(설계 §8) 충족.
- **참가자 대면 명칭**: 설계 §8 "기결정된 값" = **Slate/Clay를 simple 쌍에도 재사용** (같은 비교의 무보조판이므로). `CONDITION_NAMES[simple_score] = env(NEXT_PUBLIC_STUDY_NAME_SIMPLE_SCORE) ?? env(NEXT_PUBLIC_STUDY_NAME_SCORE) ?? 'Slate'` 식 폴백 체인 — 논문 렌더링 치환 요건 계승.

### D2. Simple 대시보드는 **신규 컴포넌트로 짓는다** (IntentBoard 게이팅 아님)

`IntentBoard.tsx`는 3,796줄에 `isBaseline` 분기 ~28곳, 워크벤치 3종·모달 6종·진단 칩·검색·정렬이 얽혀 있다. 설계 §2의 "없는 것"이 이 파일 내용물의 대부분이므로, 게이트로 빼내면 죽은 진입점 사냥이 끝나지 않는다(§8 "없는 기능은 부재로 읽혀야"). **`SimpleStudio.tsx`를 새로 조립**하고 leaf만 재사용한다: `StudioShell` 프레임, `ConversationThread`+`ChatMessages`, `materials.tsx`, `rule-diff.tsx`, `ResponseVersionBar`의 문장·상태 패턴. 진입은 `score/page.tsx`의 뷰 분기 한 곳 — `familyOf(studioView)==='simple'`이면 `<SimpleStudio condition={studioView}>` 렌더, `ensureTypeRoots`(`page.tsx:134`)·baseline state 로드는 건너뛴다. 설계 §1-5 "Baseline = intent 0개인 SCORE"는 SimpleStudio 내부의 arm 분기로 구현(같은 3컬럼, 좌측 내용만 트리 ↔ 프롬프트 에디터).

### D3. Simple 상태의 진실 = **전역 스냅샷 단일 축** (live `score_intents` 행 없음)

Simple 설정은 `simple_config_versions.snapshot`(jsonb)이 유일한 진실이다. tip 스냅샷이 곧 현재 설정; live `score_intents` 행을 만들지 않는다.

- **근거**: 현행 intent 행은 타입 불변식(`ensureTypeRoots`, 타입별 partial unique, `compileChains`의 untyped skip)과 얽혀 있고, 4축 버전 기계가 따라온다. Simple의 "버전 = 설정 전체 스냅샷, Save 단일 동사"는 스냅샷-온리가 구조적으로 단순하고 복원이 자명하다.
- **판정**: 스냅샷 안 intent에 **assignment 내 안정 id**(스냅샷 간 보존)를 부여하고, 판정은 **definition 텍스트 키**로 캐시 — `score_probe_ratings`와 같은 형태의 신규 `simple_ratings`(assignment, def_hash, message) unique. intent 행이 없어도 판정·복원·재정렬 전부 성립한다(재정렬·이동·복원 = LLM 비용 0, §6.2 귀결 그대로).
- **응답**: 신규 `simple_previews` unique **(message_id, rule_hash)** — `baseline_previews`의 검증된 키 형태. 적용 rule 텍스트가 같으면 버전 불문 히트(§6.3 귀결 그대로).
- **런타임**: `compileSimpleChain(snapshot)`/`resolveSimpleOwnership(chain, ratings)`를 `intents.ts` 옆에 클라이언트-안전 모듈로 신설 — 단일 루트, 형제 순서 = 배열 순서, 포함 보장 동일. 타입 분류 호출은 **소멸**(§5.1 — 라이브 판정도 한 call만).

---

## 2. 워크스트림

### WS1. 조건 축 리팩터 + 배정·게이팅 (전제 작업)

1. `StudioView` 4값 확장 + `armOf/familyOf/pairedCondition`(`config.ts:127`). TS가 `Record<StudioView,…>` 누락을 잡아 주는 곳: `CONDITION_NAMES`(`:171`), `STUDY_DEMO_VIDEOS`(+`.common`, `:210`).
2. **조용한 강제 변환 스윕** (grep 실측 목록 — 전부 `armOf()`화):
   `phases.ts:137`(블록2 flip → `pairedCondition`) · `console-store.ts:58,92-93` · `measure-store.ts:163,177` · `generate.ts:76,168` · `trail.ts:346,705` · `trail-files.ts:451` · `demo.ts:45-47` · `SessionConsole.tsx:347` · `export-metrics.ts:66,158,350`.
3. **Zod enum 확장 2곳**: `api/study/admin/curation/demo/run/route.ts:31`, `api/study/session/final/route.ts:25`.
4. `resolveStudioView`(`view.ts:21`)의 `?view=` allowlist에 simple 쌍 추가 (연구자 프리뷰용; 참가자는 저장 조건 고정 — 현행 규칙 그대로).
5. **라우트 게이트**: full 전용 mutation 라우트(intents CRUD·rate·probe·propose·refine·fold·pins·rule-versions·deploy·baseline/*)는 simple 클론이면 403 — "라우트가 참가자를 거절"(커밋 `6e51498`) 원칙의 조건판. 신규 `simple/*` 라우트는 역방향으로 full 클론 거절. `score/page.tsx`에서 simple 뷰는 full 데이터 로드 자체를 건너뜀.
6. **provision**: `cloneStarterSet`에 family 인자 — simple 클론은 **템플릿 intent 복사 단계(7,9,13,15)를 건너뛴다**(starter·chooser가 없어 죽은 데이터; 클론 더 빨라짐). 나머지 단계·1:1 어서션 불변. `study_participants.condition_family` DDL + 생성 폼·`create/route.ts` 토글.
7. env: `.env.example`에 `NEXT_PUBLIC_STUDY_NAME_SIMPLE_*` 2종, `NEXT_PUBLIC_STUDY_DEMO_SIMPLE_*` 데모 영상 id들(`demoSegmentsFor`가 `SIMPLE_SCORE` 등으로 자동 조합 — `config.ts:238` 실측), 데모 계정명 `DEMO-SIMPLE-*`(`demo.ts:46`), 큐레이션 보드 데모 실행 버튼 2개 추가(`CurationBoard.tsx:804,817`).

### WS2. 데이터층 + 판정·응답 서비스

**신규 테이블 4개** — 관례대로 `ensureStudyTables()`류 런타임 DDL(`CREATE TABLE IF NOT EXISTS`) + `schema.ts` 미러. FK 없음, 판별자는 text (리포 전례).

```sql
simple_config_versions (
  id serial PK, assignment_id text NOT NULL,
  version_no int NOT NULL,              -- 내부 단조 증가 (hidden 포함)
  snapshot jsonb NOT NULL,              -- §아래 형태
  name text, summary text,              -- LLM 도착 시 채움; 그 전 폴백 "v{표시번호} · {시각}"
  hidden_at timestamptz,                -- 복원이 소실시킨 버전 (soft-delete, 사용자 비가시)
  created_by text, created_at timestamptz DEFAULT now(),
  UNIQUE (assignment_id, version_no)
)
-- snapshot: { arm: 'score'|'baseline',
--   prompt?: text,                      -- baseline arm
--   rootRule?: text,                    -- score arm 루트("전체")의 else rule
--   intents?: [{ sid, title, definition, rule, parentSid, position }] }  -- sid = 안정 id

simple_ratings (
  id serial PK, assignment_id text, message_id int, def_hash text,
  rating text, rationale text, model text, rated_at timestamptz,
  UNIQUE (assignment_id, def_hash, message_id)      -- score_probe_ratings와 동형
)

simple_previews (
  id serial PK, assignment_id text, message_id int,
  rule_hash text, response text, model text, created_at timestamptz,
  UNIQUE (message_id, rule_hash)                     -- baseline_previews와 동형
)

simple_pins (
  id serial PK, assignment_id text, message_id int, created_at timestamptz,
  UNIQUE (assignment_id, message_id)                 -- 순수 북마크, 의미론 없음
)
```

표시 버전 번호 = **비-hidden 행 중의 서수**(읽기 시 계산) — 복원 후 번호가 이어져 "이후 버전 소실"이 사용자 관점에서 완결된다 [제안]. 로그·configRef는 내부 `id`/`version_no`를 쓴다(안정 키).

**신규 라우트** `…/assignments/[id]/score/simple/` (인증·소유 검사는 기존 `authorizeAssignment` 경유):

| 라우트 | 동사 | 역할 |
|---|---|---|
| `state` | GET | tip+버전 리스트(표시번호·이름·요약)+판정 요약(디스플레이 등급 규칙: 현행 해시 우선, `pickDisplayRatings` 관례)+소속 카운트+핀. 특정 버전 열람 파라미터(`?version=`) 지원 |
| `save` | POST | {snapshot} → 버전 insert 후 **즉시 반환**(§6.1 저장은 LLM 무대기). 커밋 후 fire-and-forget: ① 이름 생성(nano, `generateIntentTitle` 변형 — null이면 폴백 유지) ② 바뀐 definition 재판정 패스 ③ 프리페치 (warm.ts 패턴의 모듈 큐, latest-wins) |
| `restore` | POST | {versionId} → 이후 버전 `hidden_at` 마킹(연구 데이터 보존, §3.3), 그 버전 tip화 |
| `judge` | POST | {defHashes?}: probe식 배치 판정, 진행 카운터 반환 — 클라이언트는 rate-runner식 폴링·intent별 진행 표시. 우선순위: 화면 가시 메시지 → 핀 → 나머지 |
| `respond` | POST | {messageId, versionId?} → 적용 rule 해석 → 캐시 히트면 즉시 JSON, 미스면 **SSE 스트리밍**(`/api/chat`의 스트림 배관 이식, 첫 토큰 ≤2s 목표) + write-through. `simple_response_view`(cacheHit) 적재 |
| `prefetch` | POST | {messageIds[]} 배치 비스트리밍 생성(6개 단위, 리미터 공유) — save 후 백그라운드 티어 ①펼친 intent 소속/리스트 상단 ②핀 ③최근 열람 |
| `pins` | POST/DELETE | 토글 |

**판정 서비스**: `rateMessageIntents`(메시지 1건 × stale definition 전부 한 call, `MAX_INTENTS_PER_CALL=40`)를 스냅샷의 합성 intent 디스크립터로 호출하도록 어댑터를 씌우고, 결과를 `simple_ratings`에 텍스트 키로 적재. dissection steer는 그대로(판정 품질 재료, LLM-프리). 단일 definition 수정의 재판정도 같은 경로(메시지당 1 call, 정의 1개)라 비용 하한이다.

**응답 서비스**: `preview-service.generatePreview`의 입력 조립(digest 우선, 빈 rule = 시스템 메시지 생략)을 공유하되 캐시 read/write를 `simple_previews`로. 스트리밍 변형은 같은 입력 조립 + `stream:true`.

### WS3. SimpleStudio UI (최대 워크스트림)

`src/app/instructor/assignments/[id]/score/simple/` 신설:

- **`SimpleStudio.tsx`** — 3컬럼 그리드(좌 ~400px 유동 | 중 | 우). 헤더는 기존 `StudioShell`+칩(`conditionName`)+참가자 크롬(`WorkElapsed` 등은 `page.tsx`가 이미 공급). 전역 상태: tip 스냅샷 draft, 선택(intent/루트/쿼리), 전역 버전 선택, 로컬 버전 오버라이드 맵(전역 변경 시 리셋 — §3.4 우선순위), 판정 진행.
- **좌측** — arm 분기:
  - score: 루트("전체") 행 + 중첩 트리. 행 클릭 = 아코디언 펼침(한 번에 하나, §5.2): title 입력 + description·rule 인라인 에디터 2개 + Save. 루트는 rule 에디터만. hover ↑↓(형제 순서; 클릭 즉시 구조 Save — 순서는 first-match 의미론이므로 버전을 남긴다, LLM 비용 0) + "{intent} 안에 만들기" 점선 행. **+ New intent** = 좌측 컬럼 모드 전환(§5.3): description 빈 채, rule은 부모(최상위면 루트) rule 프리필. 카운트 = 실제 소속 수, 판정 중엔 intent별 진행 표시.
  - baseline: monolithic prompt 인라인 에디터(자동 성장 textarea) + Save. `STUDY_PROMPT_CHAR_LIMIT` 공유.
  - 아래 공통 **버전 리스트**: 이름·요약·시각(이름 미도착 시 폴백), 클릭 = 전역 선택 → 에디터 잠금 + "이 버전으로 복원" + **전신 diff**(`rule-diff.tsx` 재사용) [제안 채택].
- **중앙** — 전체 쿼리 flat 리스트(정렬 고정 PID↑, 검색·필터·타입 섹션 없음) + 핀 sticky 섹션. intent 선택 시 = 그 definition 매치 전체(선점된 행 포함, 회색 처리 + "적용: {이름}" 중립 칩 — 경고 아이콘·색 금지 §5.4). definition 저장 직후 직전 버전 대비 **초록/빨강 행 표시**(빠진 행은 잠시 잔존, §5.5; 과거 버전 열람 중엔 그 버전의 직전 대비 — 양쪽 defHash 판정이 캐시라 즉시). 수백 행 성능: 우선 CSS `content-visibility` + 청크 렌더로 실측(§6.4), 부족하면 가상화 도입 [제안 — 신규 의존성은 실측 후 결정].
- **우측** — `ConversationThread` 재사용 뷰어. 응답은 "현재 보는 버전" 기준 first-match 진실 + 적용 출처 칩. 로컬 버전 드롭다운은 `ResponseVersionBar`의 상태 문장 패턴 이식("This reply is under …" / 생성 중 문구 / 실패 시 행 단위 재시도) — 이것이 §3.4 "지표적 결과" 관례의 계승이다. 캐시 미스 시 스트리밍 표시.
- **없는 것의 부재 확인**: 워크벤치·모달 import 0, AlertTriangle 0, 검색·정렬 UI 0, Try/Apply/Deploy 어휘 0 (동사는 Save·Restore 둘). 자료 태그(`materials.tsx`)는 유지 [제안] — dissection은 LLM-프리 데이터 사실이고 §1-1 판정(설정을 쓰지도 해석하지도 않음)을 통과하며, 블록 테스트가 이미 같은 태그를 보여준다.

### WS4. 스터디 통합 (기존 절차 그대로 흐르게)

- **advance 게이트**(`advance.ts:116-122`): simple family는 `not_deployed` 대신 **"저장된 버전 없음"** 거절 — 마지막 버전 = 최종 상태(§3.3, Deploy 소멸). `StudyDeployButton`은 simple 뷰에서 렌더하지 않음(죽은 진입점 금지).
- **생성 하네스**(`generate.ts`): simple 분기 — configRef = `{simpleVersionId}`(생성 전 1회 고정, 현행 패턴 그대로). simple_baseline: tip 프롬프트로 `runChatTurn`. simple_score: **`resolveSimpleAgainstSnapshot`** — 뱅크 문항을 tip 스냅샷 definition 전체에 대해 한 call 판정(타입 call 없음) → `compileSimpleChain` first-match → 적용 rule로 생성, `applied {sid, outcome}` 저장(포인팅 V2 채점 근거). fail-open 거부·재시도 정책은 현행 그대로. `isGenerationCurrent`는 tip 버전 대조.
- **`/api/chat`**: simple 분기 추가(위 resolve 재사용) — 스터디 플로우엔 학생 챗이 없지만 데모·검증 스크립트가 지나가는 경로라 싸게 배선.
- **블록 테스트**: `SnapshotConfigView.tsx:30,117`에 simple 분기 — simple_score: 타입 그룹 없는 중첩 트리 + 루트 카드, simple_baseline: 프롬프트 전문(현 baseline 분기와 동일 렌더). 포인팅은 arm 분기 그대로(intent 클릭 ↔ 구간 선택, `BlockTest.tsx:457-460` · `test/route.ts:32-43,129-133` — sid 검증은 스냅샷 대조).
- **측정·콘솔·트레일**: `measure-store.deployedConfigFor` simple 분기(tip 스냅샷). `SessionConsole` 요약("N intents · vM"/"M chars · vM"). `trail.ts` — simple 블록은 `simple_config_versions` 인접 diff에서 kind 파생(스냅샷이 진실, 이벤트는 보완 — 트레일 스펙 §0 원칙 그대로), `describeEvent`에 simple 이벤트 항목, 최종 설정 = tip. `export-metrics`·`trail-files`는 armOf 치환으로 대부분 해소.
- **튜토리얼**: `demoSegmentsFor`가 env 조합으로 자동 해결(WS1-7). 영상 제작 자체는 연구 리포 준비물.

### WS5. 로깅 + 커버리지 검증

설계 §7 표의 구현 지점 (전부 서버측 — mutation 라우트 안, 성공 후 `logStudyEvent`; 열람 행위만 `ui-events` 화이트리스트 경유 — 트레일 스펙 §2.6에서 확립된 관례):

| 이벤트 | 적재 지점 |
|---|---|
| `simple_version_save` (condition, versionNo, 대상 prompt/root/intentSid, ±자수) | `simple/save` |
| `simple_intent_create/update/delete` · `simple_intent_reorder/move` | `simple/save` — 스냅샷 델타에서 파생해 save와 함께 명시 적재 |
| `simple_version_restore` (from→to, 소실 수) | `simple/restore` |
| `simple_pin_add/remove` | `simple/pins` |
| `simple_response_view` (messageId, versionNo, cacheHit) | `simple/respond` |
| `simple_rating_run` (defHash, processed, membership 델타) [제안 — rating_run 선례] | `simple/judge` |
| `simple_version_switch` (global/local, from→to, conversationId) · `simple_intent_expand` | `ui-events` 화이트리스트 추가(`ui-events/route.ts:34-57`) |

**검증 (스터디 전 필수, §7 "미구현 이벤트 전례" 경계)**: ① 신규 `scripts/study/check-simple.ts` — 실 HTTP로 save→judge→respond→reorder→restore→pin 시퀀스 후 이벤트 타입·순서·payload assert (`check-trail.ts` 스타일). ② `check-session-walkthrough.ts`에 simple family 참가자 1명 전 페이즈 주행 추가(배포 없는 advance 게이트 포함). ③ `check-generate.ts`의 조건쌍 하드코딩(`:62-64,111-112`)을 family 인자화.

### WS6. 성능 실측 리포트 (§6.4 산출물)

구현 후 `docs/SCORE_SIMPLE_PERF.md`로 실측 보고 — 측정 6항목: ① 판정 패스 완료 시간(정의 1개 재판정, 실데이터 N — swag 507이면 메시지당 1 call ≈ N/동시성 라운드; N≈100 수 초 하한 대비 실측) ② 응답 첫 토큰·완료 지연(캐시 미스) ③ 캐시 히트 전환 지연 ④ Save→UI 반영 ⑤ 프리페치 적중률(`simple_response_view.cacheHit` 집계로 공짜) ⑥ 동시성 병목. 개선 후보(동시성 상향·프리페치 범위·판정 배칭(메시지 K건/call)·스냅샷 사전 컴파일)는 수치와 함께 제안.

---

## 3. 필수 잔손질

| # | 항목 | 근거 |
|---|---|---|
| 1 | **워킹 트리 선커밋** — 현재 26파일 +442/−248 미커밋 | 이 위에 새 워크스트림을 얹으면 회귀 원인 분리가 안 됨 |
| 2 | full 라우트의 simple 클론 거절 + simple 라우트의 역방향 (WS1-5) | "라우트가 거절"(6e51498) 원칙 |
| 3 | `ui-events` 화이트리스트에 simple 이름 추가 없이는 열람 이벤트가 **조용히 204로 버려짐** | 화이트리스트 구조 실측 |
| 4 | 데모 기계 4값화: `demoParticipantNumber`·큐레이션 데모 버튼·`demo/run` zod | 튜토리얼 녹화·검증 경로 |
| 5 | `.env.example` 갱신 (이름·데모 영상 env) | 논문 렌더 치환 요건 |
| 6 | simple 클론 템플릿 스킵 후에도 `check-isolation.ts` 카운트 기대치 조정 | 격리 검증 스크립트가 개수 대조 |

## 4. 구현 순서 · 결과

| 순서 | WS | 커밋 | 상태 |
|---|---|---|---|
| 0 | 선커밋 + 안정화 | `781f2e9` `6377ab9` `ce453d9` | 완료 (기존 WIP 3주제 분리) |
| 1 | WS1 조건 축 리팩터 | `42f3fea` | 완료 |
| 2 | WS2 데이터층 + 서비스 + 라우트 | `c36df6c` | 완료 |
| 3 | WS3 SimpleStudio UI | `c6e1c8a` `82b49ce` | 완료 |
| 4 | WS4 스터디 통합 | `45f4db9` | 완료 |
| 5 | WS5 로깅·검증 | `1a98b42` | 완료 |
| 6 | WS6 실측 리포트 | — | **미착수** — 실데이터셋(507/348) 대상 측정 필요 |

## 4.1 남은 것

1. **WS6 성능 실측** (§6.4) — 지금까지의 확인은 4문항짜리 스크래치 과제라 §6.4의 6개 항목이 의미 있는 수치를 내지 못한다. 실데이터셋 규모(N=348/507)에서 판정 패스 완료 시간·첫 토큰 지연·캐시 히트 전환·Save→반영·프리페치 적중률·동시성 병목을 재고 `docs/SCORE_SIMPLE_PERF.md`로 보고할 것.
2. **데모 영상 4편** — simple 쌍은 자체 영상이 필요하다(보드가 다르므로 풀 버전 footage로 대체 불가, 폴백도 의도적으로 막아 둠). `NEXT_PUBLIC_STUDY_DEMO_SIMPLE_*` / `_COMMON_SIMPLE_*` 설정 전까지 튜토리얼은 빈 슬롯 + 변수명을 표시한다.
3. **실참가자 리허설** — `check-simple.ts --participant <번호>`로 simple family 참가자 1명을 만들어 전 페이즈(작업→설문→블록 테스트→최종 설문) 주행. 특히 블록 테스트의 포인팅(단일 루트 트리 클릭)과 고정 응답 생성이 실제 뱅크 문항으로 도는지 확인.

## 5. 확정된 결정 (2026-08-20 연구자 회신)

| # | 질문 | **확정** |
|---|---|---|
| 1 | 루트 rule / monolithic 프롬프트 초기값 | **base prompt 시드.** 양 arm 동형으로 — simple_score의 루트("전체") rule과 simple_baseline의 프롬프트 모두 `assignmentBasePrompt`의 복사본에서 시작(클론 최초 진입 시 1회, copy-on-create). 이후 사용자가 고치는 것은 그 복사본이고 live 상속은 없다. 두 arm이 **같은 텍스트에서 출발**하므로 조작 변인 밖의 비대칭이 생기지 않는다 |
| 2 | 브리핑 모달 | **포함.** `AssignmentBriefing`을 그대로 재사용(과제 프롬프트 + 원 시작 프롬프트 + 참가자면 Your task). §1-1 판정 통과 — 설정을 대신 쓰지도 해석하지도 않는다 |
| 3 | intent 제목 | **사용자 직접 입력 title 필드.** 아코디언 상단에 텍스트 입력 하나. LLM 제안·auto-title 없음 |
| 4 | 참가자 대면 명칭 | **유지** — simple 쌍도 Slate/Clay. env 오버라이드는 폴백 체인으로 열어 둔다 |

그 외 [제안] 표기 사항(표시 번호 서수화, 템플릿 스킵, 자료 태그 유지, `simple_rating_run` 이벤트, 가상화는 실측 후 결정)은 합리적 기본값으로 진행한다.

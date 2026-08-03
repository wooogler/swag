# SCORE 유저 스터디 — Baseline 조건 + SCORE 변경 구현 스펙

**작성:** 2026-07-16 | **대상 구현자:** Claude Opus | **선행 문서:** `references/RELATED_WORK.md`, 메모리 `study-mode`
**전제:** study mode(참가자 셀프서비스 로그인 + 데이터셋 클론)는 이미 구현·검증됨. 이 문서는 그 위에 얹는 작업만 다룬다.

---

## 0. 배경 & 설계 원칙 (구현 판단이 필요할 때 이 절로 돌아올 것)

유저 스터디: **within-subject, 2조건(SCORE vs Baseline) × 2데이터셋(swag, nirvana), 참가자별 카운터밸런스.**
Baseline은 SCORE의 ablation이다. 제거하는 것은 **"로그-근거 구조화 설정" 패키지 하나**이고, 나머지는 전부 패리티를 유지한다.

핵심 원칙 (우선순위 순):

1. **Claim 격리**: Baseline과 SCORE는 "구조화(intent/rule 객체 + 상시 커버리지 + 국소 수정 타깃)"에서만 달라야 한다. AI 능력(judge 검색, 3모드 수정 에이전트, 프리뷰)은 양쪽 동등.
2. **셸 패리티**: 같은 대시보드/워크벤치/모달 셸을 재사용하고 세부 패널만 교체한다. 두 조건은 "같은 제품의 기능 티어 차이"로 보여야 한다 (demand effect 통제).
3. **비-strawman**: Baseline은 2026 상용 표준(GPT Builder/SchoolAI 등: 모놀리식 instructions + test chat + 로그 열람 + coarse 버전) 이상이어야 한다. "기능을 일부러 뺐다"는 인상을 주는 UI 비일관성 금지.
4. **한 문장 방어**: "Baseline은 **저장 가능한 검색**을 가진다; SCORE는 검색이 아니라 **설정 객체**를 가진다 — 카테고리가 rule을 소유하고, 커버리지가 로그 위에 상시 표시되며, 경계 사례(pins)로 판정을 조정한다." 구현 중 애매하면 이 문장에 비춰 판단.
   - **(v7 갱신)** "상시 커버리지"의 형태가 바뀌었다: 전역 Uncategorized 버킷과 Overlaps 큐가 사라지고, **4개 쿼리 타입 섹션 + 스코프별 Uncategorized**가 그 자리를 차지한다. 커버리지는 여전히 로그 위에 상시 표시되지만 이제 계층적이다 — 각 타입 섹션의 합계 = (하위 세트 서브트리들) + (그 타입 자신의 미claim 분). **Overlaps는 지표에서 완전히 사라진다**: v7은 first-match라 한 쿼리가 두 세트에 동시에 속할 수 없다. 그 자리를 대신하는 진단은 **shadowing**("앞선 세트가 이 세트의 매치 N개를 먼저 가져감")이다.

### 0.1 용어

| 용어 | 정의 |
|---|---|
| **condition** | 클론별 조건: `'score'` \| `'baseline'` |
| **probe rating** | intent 없이 정의(definition) 텍스트만으로 judge가 로그 전체를 평가한 결과. `intentDefHash(definition, [])` 키로 캐시 |
| **clearly_in 리스트** | probe/intent rating 중 `rating === 'clearly_in'`인 쿼리 목록. **Baseline에는 이것만 노출** (5-level 등급 노출 금지) |
| **검토 세트 (review set)** | Revise 모달 안의 "이 수정이 다른 쿼리에도 괜찮은가" 평가 대상 쿼리 집합 |
| **anchor** | Revise 진입의 기준이 된 (쿼리, 응답) 쌍 |
| **draft** | 저장/배포되지 않은 에디터의 현재 프롬프트 텍스트. 서버에 저장하지 않고 요청에 실어 보낸다 |

---

## 1. 조건 배정 & 라우팅 (P0)

### 1.1 DB

```sql
ALTER TABLE study_clones ADD COLUMN condition text NOT NULL DEFAULT 'score';
-- 'score' | 'baseline'
```

`src/lib/study/store.ts`의 `ensureStudyTables()` 런타임 DDL에 추가 (기존 마이그레이션 패턴 그대로: `ADD COLUMN IF NOT EXISTS`).

### 1.2 배정 로직 — `src/lib/study/config.ts`

```ts
// 참가자 번호에서 결정론적으로 조건을 배정한다.
// 숫자 접미사 N (없으면 문자코드 합) 기준:
//   N % 2 === 0 → swag=score,   nirvana=baseline
//   N % 2 === 1 → swag=baseline, nirvana=score
export function conditionForDataset(participantNumber: string, datasetKey: string): StudyCondition
```

- 세션 **순서**(어느 조건을 먼저 하는지)는 앱이 아니라 진행자 런북이 관리한다. 4셀 표:

| cell | 참가자 번호 예 | 1세션 | 2세션 |
|---|---|---|---|
| 1 | P01 (N=1,홀) | swag=baseline | nirvana=score |
| 2 | P02 (N=2,짝) | swag=score | nirvana=baseline |
| 3 | P03 | nirvana=score | swag=baseline |
| 4 | P04 | nirvana=baseline | swag=score |

(순서 카운터밸런스는 진행자가 번호 발급으로 통제. 코드는 pairing만 책임.)

- `provisionClone()`에서 `condition: conditionForDataset(...)` 기록. **클론 데이터는 조건과 무관하게 동일하게 복사한다** (starter 템플릿 + rating 캐시는 baseline의 프리셋 검색에 필요).

### 1.3 라우팅 & 뷰 리졸버

URL은 양 조건 동일: `/instructor/assignments/[id]/score`. 어떤 뷰를 그릴지는 **단일 리졸버 함수** 하나가 결정한다. 격리는 이 함수 한 곳에서만 켜고 끄므로, 접근 로직을 버튼·라우트에 흩뿌리지 않는다 (이게 "나중에 격리" 를 안전하게 만드는 유일한 규율).

```ts
// src/lib/study/view.ts
export type StudioView = 'score' | 'baseline';

// 뷰 결정의 유일한 진실. PHASE 전환 = 아래 주석 한 줄.
export function resolveStudioView(opts: {
  storedCondition: StudioView | null;  // study_clones.condition (클론 아니면 null)
  viewParam: string | null;            // ?view=score|baseline
  isParticipant: boolean;              // getCurrentStudyParticipant() != null
}): StudioView {
  // ── PHASE 2 (스터디 시작 전 켤 것): 참가자는 배정 조건으로 고정, ?view 무시 ──
  // if (opts.isParticipant) return opts.storedCondition ?? 'score';
  // ── PHASE 1 (현재, 개발/파일럿): 열림 — 누구나 ?view 로 양쪽 프리뷰 ──
  if (opts.viewParam === 'score' || opts.viewParam === 'baseline') return opts.viewParam;
  return opts.storedCondition ?? 'score';
}
```

**PHASE 1 (현재 — 개발/파일럿, 격리 없음):**
- `score/page.tsx`는 `resolveStudioView(...)` 결과로 `<IntentBoard/>`(기존) 또는 `<BaselineStudio/>`(신규)를 렌더.
- assignment 개요 페이지 헤더에 **`[SCORE] [Baseline]` 두 버튼을 누구에게나** 노출 (각각 `?view=score` / `?view=baseline`로 링크). study clone이 아닌 assignment(마스터·일반)에서도 admin이 baseline을 프리뷰할 수 있게 둘 다 노출.
- `condition`은 여전히 클론에 기록한다 — **학생 런타임(`/api/chat`, §5.6)은 항상 저장된 `condition`을 쓴다.** `?view`는 UI 프리뷰 전용이라 학생이 받는 챗봇을 바꾸지 않는다. (baseline을 end-to-end로 테스트하려면 condition='baseline' 클론에서.)

**PHASE 2 (스터디 시작 전 켜는 격리 — 이번 구현 범위 밖):**
- `resolveStudioView`의 주석 처리된 참가자 분기를 활성화 → 참가자는 `?view`를 무시하고 배정 조건 고정.
- 개요 페이지 버튼: 참가자면 단일 `[Chatbot Studio]`(중립 명명, "SCORE"/"Baseline" 문자열 숨김), admin이면 기존 두 버튼.
- 헤더 타이틀도 참가자 세션에서 "SCORE" → "Chatbot Studio"(§S-4).
- 이 전환은 **리졸버 1함수 + 개요 페이지 버튼 분기 1곳**만 건드리면 끝나도록 PHASE 1을 짠다.

---

## 2. 신규 테이블 (P0, 전부 `ensureStudyTables()` 또는 intent-store 패턴의 런타임 DDL)

```sql
-- ① probe rating 캐시: intent 없는 judge 스윕. defHash는 intentDefHash(definition, []) 그대로 사용.
CREATE TABLE score_probe_ratings (
  id serial PRIMARY KEY,
  assignment_id text NOT NULL,
  def_hash text NOT NULL,
  message_id integer NOT NULL,
  rating text NOT NULL,            -- RatingLevel 전체 저장 (노출은 clearly_in만)
  raw_response text, model text, rated_at timestamp NOT NULL,
  UNIQUE (assignment_id, def_hash, message_id)
);

-- ② baseline 저장 검색 (커스텀). 프리셋은 기존 is_template intents를 읽는다(신규 테이블 불필요).
CREATE TABLE baseline_searches (
  id text PRIMARY KEY,
  assignment_id text NOT NULL,
  description text NOT NULL,       -- 라벨 = description 앞부분. title 필드 없음(의도적)
  def_hash text NOT NULL,
  created_at timestamp NOT NULL,
  last_run_at timestamp
);

-- ③ baseline 프롬프트 버전 (coarse). draft는 저장하지 않는다 — Save가 곧 버전 생성.
CREATE TABLE baseline_prompt_versions (
  id serial PRIMARY KEY,
  assignment_id text NOT NULL,
  version_no integer NOT NULL,
  prompt text NOT NULL,
  deployed_at timestamp,           -- null이면 미배포 버전
  created_at timestamp NOT NULL,
  UNIQUE (assignment_id, version_no)
);

-- ④ baseline 프리뷰 캐시 (score_rule_previews와 대칭)
CREATE TABLE baseline_previews (
  id serial PRIMARY KEY,
  assignment_id text NOT NULL,
  message_id integer NOT NULL,
  prompt_hash text NOT NULL,       -- stableHash(model + prompt)
  response text NOT NULL, model text, created_at timestamp NOT NULL,
  UNIQUE (message_id, prompt_hash)
);

-- ⑤ 검토 세트 (양 조건 공용)
CREATE TABLE review_set_items (
  id serial PRIMARY KEY,
  assignment_id text NOT NULL,
  scope text NOT NULL,             -- SCORE: 'intent:<intentId>' / Baseline: 'prompt'
  message_id integer NOT NULL,
  source text NOT NULL,            -- 'auto' | 'manual' | 'similar' | 'search'
  created_at timestamp NOT NULL,
  UNIQUE (assignment_id, scope, message_id)
);

-- ⑥ 행동 이벤트 로그 (양 조건 공용, 과정 지표의 원천)
CREATE TABLE study_events (
  id serial PRIMARY KEY,
  assignment_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamp NOT NULL
);
```

---

## 3. Baseline Studio 화면 스펙 (P0~P1)

`src/app/instructor/assignments/[id]/score/BaselineStudio.tsx` + 하위 컴포넌트. 전체 레이아웃은 SCORE 보드의 3-구역 구조를 미러링:

```
┌ 헤더: ← · "Chatbot Studio" · [Save] [Deploy] · InstructorHeaderActions ┐
├───────────────┬───────────────────────────┬───────────────────────────┤
│ 검색 목록       │  쿼리 로그 (원문)           │  System Prompt 패널        │
│ (프리셋 31 +   │  대화 뷰어 재사용            │  에디터 + 글자수 + 버전     │
│  저장된 검색)   │  키워드/시맨틱 검색          │  Test Chat 패널            │
└───────────────┴───────────────────────────┴───────────────────────────┘
```

### B-1. System Prompt 에디터 (P0)
- 플레인 textarea. **글자수 제한 8,000자**(하드 리밋 + 카운터, `STUDY_PROMPT_CHAR_LIMIT` env로 조정 가능).
- 초기값: 최신 버전이 있으면 그것, 없으면 assignment의 `customSystemPrompt` (클론에 이미 복사돼 있음 — 섹션 헤딩 있는 시드로 사용).
- **[Save]** → `baseline_prompt_versions`에 새 버전 (version_no = max+1). draft 자체는 서버 저장 안 함.
- **[Deploy]** → 현재 텍스트가 마지막 저장과 다르면 먼저 Save, 그 버전에 `deployed_at` 기록. SCORE의 DeployControls와 같은 위치/스타일.
- 버전 드롭다운: `v3 · 14:02 (배포됨)` 형식, 선택 시 **전문을 에디터로 복원**만 (diff 뷰 없음 — 의도적).

### B-2. 검색 목록 + SearchWorkbench (P0)
- 좌측 패널: **프리셋 31개**(클론의 `is_template` intents; 라벨 = intent title) + **저장된 커스텀 검색**(라벨 = description 앞 ~60자). 하나의 리스트로 통합.
- 항목 클릭 → **SearchWorkbench** 화면(모달 또는 우측 대체 패널): SCORE의 IntentWorkbench와 **같은 셸**이되,
  - **title 입력 없음**, description(정의) textarea만
  - 결과 영역: **clearly_in 쿼리 리스트만** (스니펫 + [대화 열기] + [검토 세트에 담기])
  - [검색 실행] 버튼 → probe 스윕(§5.1) → 결과 갱신, `last_run_at` 업데이트
  - [저장] → `baseline_searches` upsert
- 프리셋의 clearly_in은 기존 `score_intent_ratings`(현재 defHash 행)에서 즉시 조회 — LLM 비용 0.
- **구현 주의**: IntentWorkbench에 `mode` flag를 꽂지 말 것. 정의 에디터·결과 리스트를 공용 서브컴포넌트로 추출해 SearchWorkbench를 별도 조립 (SCORE 전용 어포던스 누출 방지).

### B-3. 쿼리 로그 브라우저 (P0)
- SCORE의 conversation viewer(`conversation.tsx`) 재사용. 쿼리 리스트 + 스레드 열람.
- **키워드 검색 + 시맨틱 검색**(`score_query_embeddings` 코사인, 순위만). 
- **제거**: rating 칩, 커버리지 표시, dissection/materials 칩, Jelson 태그, intent 열. 순수 원문만.
- 쿼리 행 액션: [대화 열기] · [검토 세트에 담기] · [이 쿼리로 테스트](→ B-6 프리뷰).

### B-4. Revise 모달 (P1) — 공유 셸 (§4.1)
- 진입: 로그/검색 결과/검토 세트에서 응답 선택 → [Revise].
- 좌: anchor 쿼리+응답, **3모드 입력** — ① 피드백(자연어) ② 직접 편집(에디터로 포커스 이동) ③ 응답 고쳐쓰기.
- ①/③ → 수정 에이전트(§5.2) → **전체 프롬프트의 최소 편집 diff** 표시 → [승인]=에디터에 반영(자동 Save 아님) / [거부].
- 우: **검토 세트 테이블**(§4.2) — scope='prompt', assignment당 1개 지속.
- 세트 채우기: [비슷한 질문 제안](anchor 임베딩 nearest, 순위만) + 공유 픽커(§4.3) + 검색 결과에서 담기. **자동 시드 없음** (SCORE와의 유일한 차이).

### B-5. Test Chat (P1)
- 우측 하단 패널. 현재 **draft** 텍스트로 실행 (stateless: 메시지 배열 + promptOverride를 요청에 실음). [초기화] 버튼.
- **학생 로그에 절대 기록하지 않는다.** 대화 내용은 `study_events`(`test_chat_message`)로만 남긴다.

### B-6. 쿼리 프리뷰 (P1)
- "이 쿼리로 테스트": 해당 로그 쿼리를 draft로 실행 → 응답 표시. `baseline_previews`에 (message, prompt_hash) 캐시.
- 검토 세트 테이블의 행별 [재생성]/[세트 전체 갱신]도 같은 엔드포인트 사용.

### B-7. Baseline 누출 금지 체크리스트 (구현 후 하나씩 grep/육안 확인)
- [ ] 5-level 등급 문자열(clearly_in 외) 렌더 없음
- [ ] 쿼리 테이블에 검색/카테고리 멤버십 칩 없음 (멤버십은 검색 결과 뷰 안에서만)
- [ ] 커버리지 집계·요약("N% 커버") 없음
- [ ] pins / exception links / ownership UI 없음
- [ ] stale/re-rate 표시 없음
- [ ] 검색에 rule 붙이는 경로 없음
- [ ] before/after 나란히 비교 뷰 없음 (프리뷰는 항상 "현재 draft 응답" 단일)
- [ ] rule/config 버전 타임라인 없음 (버전은 전문 복원 드롭다운만)
- [ ] intent 제안(NewIntentSuggest) 진입점 없음
- [ ] dissection/Jelson 칩 없음
- [ ] **(v7)** 4개 쿼리 타입 섹션 / 타입별 브라우징 없음 — baseline 좌측은 Searches + All 그대로
- [ ] **(v7)** intent 트리(들여쓰기·중첩), 형제 순서 조절(↑↓) 없음
- [ ] **(v7)** 스코프별 "Uncategorized" 항목 없음
- [ ] **(v7)** shadowing 칩("앞선 intent가 N개를 가져감") 없음
- [ ] **(v7)** 타입 else-rule 편집 진입점 없음 (baseline의 Revise는 단일 rules 문서만)
- [ ] **(v7)** "New intent for this query" 버튼 없음
- [ ] **(v7)** 클론에 `kind='type_root'` 행이 생기지 않음 (ensureTypeRoots는 SCORE 뷰에서만 호출)

---

## 4. 공유 컴포넌트 (P1) — 두 조건이 같은 코드를 쓴다

`src/components/study-shared/` (또는 score 하위 공용 디렉토리)에 배치.

### 4.1 ReviseModal 셸
- 레이아웃(anchor + 3모드 + diff 승인 + 검토 세트 테이블)은 동일. 주입되는 것만 다름:
  - **SCORE**: 수정 타깃 = 해당 intent의 rule (기존 RuleWorkbench/propose 흐름 재사용), 세트 scope=`intent:<id>`, **자동 시드 있음**
  - **Baseline**: 수정 타깃 = 전체 프롬프트, scope=`prompt`, 자동 시드 없음
- SCORE 쪽 기존 Revise(RuleWorkbench) 기능은 유지하되 이 셸로 감싼다. 기존 edge-case sweep 결과가 검토 세트의 'auto' 행이 된다.

### 4.2 ReviewSetTable (검토 세트)
- 행: 쿼리 → 현재 draft 응답(생성 전이면 [생성]) · [제거] · 출처 배지(auto/manual/similar/search — SCORE만 auto 존재).
- [세트 전체 갱신]: 세트 내 전 행 재생성 (SCORE: rule preview 경로 / Baseline: B-6 경로).
- **SCORE 자동 시드**: intent revise 최초 진입 시 기존 edgecases 스윕 결과(먼 순, 상한 12개)를 `source='auto'`로 insert. 이후 사용자가 추가/제거 자유.
- Baseline은 시드 없이 빈 세트에서 시작.

### 4.3 QueryPickerModal
- 쿼리 리스트 + conversation viewer + 멀티 선택 + [N개 세트에 담기].
- 내부 탐색: 키워드/시맨틱 검색(공통). SCORE에서는 intent 그룹 필터 추가, Baseline에서는 프리셋/저장 검색 결과 소스 추가.
- 진입점: 검토 세트 테이블의 [+ 추가], 그리고 (SCORE) 보드 멀티셀렉트 → "검토 세트에 담기".

### 4.4 DiffApproval
- 원문/수정문 단어 단위 diff 렌더 + [승인]/[거부]. SCORE의 rule diff와 Baseline의 prompt diff가 같은 컴포넌트 사용.

### 4.5 TestChat
- 패널 UI 공용. 백엔드만 조건별(§5.3, §5.4).

---

## 5. API & LLM 계약 (P0~P1)

기존 `/api/instructor/assignments/[id]/score/` 아래에 추가. 전부 `authorizeAssignment` 가드.

### 5.1 Probe 검색 — `POST …/score/probe`
```
req:  { description: string }
res:  { defHash, total, clearlyIn: [{ messageId, queryText, conversationId }] }
```
- defHash = `intentDefHash(description, [])` — **기존 함수 재사용** (프리셋 캐시와 정합).
- 로그 전 쿼리에 대해 `score_probe_ratings` 캐시 조회, 미스만 judge 실행 (기존 intent rating 프롬프트 머신 재사용, pins 빈 배열). 배치는 기존 rate 경로의 배치 로직을 따른다.
- 응답은 clearly_in만. (전체 등급은 테이블에 저장하되 API가 노출하지 않는다.)

### 5.2 Baseline 수정 에이전트 — `POST …/score/baseline/revise`
```
req:  { mode: 'feedback' | 'edit_response', promptText, anchorMessageId,
        feedback?: string, editedResponse?: string }
res:  { revisedPrompt: string, rationale: string }
```
- **패리티 요구(타협 불가)**: SCORE의 rule 수정 에이전트(intent-agent)와 **같은 모델, 같은 수준의 프롬프트 튜닝**. 시스템 프롬프트 계약: "주어진 전체 프롬프트에 대해 **최소 편집**(관련 없는 부분 보존)으로 피드백/교정을 반영한 전문을 반환하라. 반환은 전문 텍스트."
- anchor의 쿼리·응답 텍스트를 컨텍스트로 포함.

### 5.3 Baseline 프리뷰/테스트챗
```
POST …/score/baseline/preview    { messageId, promptText } → { response }   (baseline_previews 캐시)
POST …/score/baseline/test-chat  { messages[], promptText } → { response }  (무저장, 이벤트만)
```

### 5.4 SCORE 테스트챗 (신규, 패리티용) — `POST …/score/test-chat`
> **상태: 미구현 (양 조건 모두).** baseline의 `…/score/baseline/test-chat`도 라우트가 없다.
> 서버 코어(`resolveChatPromptFromSnapshot`)는 존재하고 v7 런타임과 동일 경로를 쓰므로, 붙이면
> 즉시 패리티가 성립한다. **비대칭은 없다** — 어느 조건에도 자유 대화 테스트가 없다.
```
req:  { messages[] }  → draft intent 세트로 end-to-end 실행
```
- `buildChatDeploySnapshot(assignmentId)`(저장 없이 현재 상태 스냅샷) → 런타임과 **같은 함수**로 응답 생성(v7: 타입 판정 ∥ 판정 병렬 → 체인 first-match → 미claim 시 타입 rule). 무저장.
- 구현할 때 SCORE/baseline 양쪽에 동시에 붙일 것.

### 5.5 기타
```
GET  …/score/similar-log?messageId=…&limit=…   → 임베딩 nearest 쿼리 (intent 무관, 순위만) — 검토 세트 '비슷한 질문 제안'용
CRUD …/score/baseline/searches                  → baseline_searches
CRUD …/score/review-set?scope=…                 → review_set_items
POST …/score/baseline/versions | /deploy        → 버전 저장/배포
POST …/score/events                             → study_events 적재 (클라이언트 이벤트용; 서버 액션은 서버에서 직접 적재)
```

### 5.6 `/api/chat` 분기 (P0)
- assignment가 study clone이고 condition='baseline'이면: **최신 deployed `baseline_prompt_versions.prompt`를 시스템 프롬프트로 사용** (분류·주입 없음). 이 분기는 **어떤 분류 호출보다도 먼저** 실행되므로 baseline 클론은 타입 분류기 비용을 한 번도 내지 않는다.
- 배포 버전이 없으면 기존 base prompt로 fail-open (SCORE와 동일 원칙).
- condition='score' 또는 비-study assignment는 v7 경로: **타입 판정 ∥ 세트 판정 두 콜을 병렬**(각 15s/재시도 0)로 던지고 → 그 타입의 체인을 first-match로 걷고 → 아무것도 매치 안 하면 **그 타입 자신의 rule**이 답한다.
  - **base prompt는 이제 오류 전용 fail-open이다**: 배포 없음 / v7 이전 스냅샷 / 분류기 오류·타임아웃 / 판정 부분 실패. "아무 세트도 매치 안 함"은 오류가 아니다.
  - 세트도 타입 rule도 비어 있으면 **시스템 메시지를 아예 보내지 않는다**(빈 rule = 빈 프롬프트, base prompt로 대체하지 않음).
  - 비용: 학생 메시지당 LLM 콜이 1 → 2로 늘지만 병렬이라 대기시간은 max(a,b)다. baseline은 0으로 변함없다.

---

## 6. SCORE 변경 사항 (P1)

| # | 변경 | 내용 |
|---|---|---|
| S-1 | 검토 세트 명시화 | 기존 Revise(RuleWorkbench)의 edge-case sweep을 ReviewSetTable(§4.2)로 교체. 자동 시드(먼 순, 상한 12) + 수동 추가/제거. 기존 스윕 계산 로직(edgecases 라우트) 재사용 |
| S-2 | 공유 픽커 연결 | 보드에서 응답 멀티 선택 → [검토 세트에 담기] (선택들이 세트에 들어가고 anchor는 하나) |
| S-3 | TestChat 패널 | §5.4. draft 스냅샷 기준 자유 대화 |
| S-4 | 중립 명명 (**PHASE 2**) | 참가자 세션에서 헤더 "SCORE" → "Chatbot Studio". 격리와 함께 스터디 시작 전 켠다 (§1.3 PHASE 2). PHASE 1에선 기존 명명 유지 |
| S-5 | 이벤트 로깅 | §7의 taxonomy를 SCORE 액션에도 심기 (intent 생성/수정, rate 실행, pin, revise 제안 승인/거부, deploy 등) |
| S-6 | **변경하지 않는 것** | ~~템플릿 활성화 플로우 유지~~ → **v7에서 대체됨**(아래). create intent → workbench 직행 플로우는 유지(search-first 승격 모델 기각). probe 미리보기를 SCORE workbench에 넣지 않음 (스터디 후 과제) |
| S-6a | **(v7) 템플릿 활성화 대체** | SCORE의 스타터 세트 "Add Intent" 활성화는 제거됐다. 생성은 ① 타입 섹션에서, ② 선택된 intent 안에서(subset), ③ 질문에서 "New intent for this query" — 셋 다 **호출한 스코프가 곧 부모**다. subtype은 생성 시 템플릿 추천으로만 남는다. **baseline의 프리셋은 그대로**: `is_template` 행과 그 전 로그 판정이 저장 검색의 근거이므로 데이터·프로비저닝·`StarterSetTree`(browse 전용)는 전부 유지된다 |

---

## 7. 이벤트 로깅 taxonomy (P1, 양 조건 공통 계약)

`study_events.event_type` / payload 주요 필드:

```
prompt_save {versionNo, chars} · prompt_deploy {versionNo}
search_run {defHash, cached: bool, resultCount} · search_save {searchId}
picker_open {} · set_add {messageId, source} · set_remove {messageId}
revise_open {anchorMessageId, scope} · revise_submit {mode}
agent_proposal {mode, accepted: bool}
preview_generate {messageId, cached}
test_chat_message {role}
intent_create {intentId} · intent_edit {intentId} · rating_run {intentId?, count}
pin_add {intentId} · link_add {} · version_restore {versionNo}
deploy {condition, versionNo}
```

이 로그로 계산할 지표(참고): probe/검색 반복 횟수, 검토 세트 크기·출처 분포·anchor 대비 의미 거리 분포, 제안 승인율, 프롬프트 길이 추이, 수정 국소성. **회귀 측정**은 세션 후 스크립트로: 승인된 제안의 anchor들을 최종 배포 설정으로 재실행 (`scripts/study/replay-eval.ts`, P2).

---

## 8. 패리티 체크리스트 (구현 완료 조건)

- [ ] judge/에이전트/프리뷰/테스트챗의 **모델·온도 동일** (양 조건)
- [ ] Baseline 시드 = 클론의 base prompt (빈 에디터 금지)
- [ ] 프리셋 31개가 baseline 검색 목록에 노출되고 clearly_in이 **즉시**(캐시) 뜸
- [ ] 커스텀 검색 재실행이 캐시로 즉시 동작 (같은 description → 같은 defHash)
- [ ] 양 조건 모두 TestChat + 쿼리 프리뷰 + 검토 세트 보유
- [ ] 양 조건 모두 Save/Deploy 2단계, 같은 버튼 위치
- [ ] 양 조건 모두 §7 이벤트가 빠짐없이 적재
- [ ] 참가자 화면 어디에도 "SCORE"/"baseline" 문자열 노출 없음
- [ ] baseline 테스트챗/프리뷰가 학생 로그(chat_messages)에 기록되지 않음
- [ ] SCORE 조건 참가자가 baseline API를(또는 그 반대) 호출할 수 없음 — condition 검사

## 9. 구현 순서 제안

1. **P0**: §1 조건 배정/라우팅 → §2 테이블 → B-1 에디터+버전+Deploy → §5.6 chat 분기 → §5.1 probe + B-2 검색 → B-3 로그 브라우저 *(이 시점에 baseline 조건이 최소 기능으로 동작)*
2. **P1**: §4 공유 컴포넌트(픽커→검토 세트→diff) → B-4 Revise+§5.2 에이전트 → §5.3/5.4 테스트챗·프리뷰 → §6 SCORE 변경(S-1~S-5) → §7 이벤트
3. **P2**: replay-eval 스크립트, 미세 폴리시(누출/패리티 체크리스트 전수 확인)

검증: study-mode 때와 동일하게 — 테스트 참가자 프로비저닝 → 양 조건 렌더/기능 e2e(curl+DB 검증) → 누출 체크리스트 grep → 정리(deprovision). `.env`는 `POSTGRES_URL`, dev 서버 3030.

## 10. 열린 값 (기본값으로 진행, 연구자 확인 시 조정)

- 글자수 제한 기본 8,000 (`STUDY_PROMPT_CHAR_LIMIT`)
- 검토 세트 자동 시드 상한 12
- probe 대상: 학생 쿼리 전체(~500) — 프리셋과 동일 범위
- 테스트챗 트랜스크립트는 study_events에만 (별도 테이블 없음)

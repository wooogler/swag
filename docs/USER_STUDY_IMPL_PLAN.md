# USER_STUDY v1 — 시스템 업데이트 계획

**작성:** 2026-08-09 · **기준:** `docs/USER_STUDY 설계 v1.md`(2026-08-08) ↔ `score-v7` working tree 실측 대조 · **as-built 참조:** `docs/SCORE_BASELINE_DESIGN.md`

> 이 문서는 유저스터디 v1 설계를 실행하기 위해 **시스템에 추가/변경해야 하는 것**의 계획이다. 스터디 설계 자체의 미확정 항목([미팅]/[파일럿])은 건드리지 않고, 그 결정이 코드에 미치는 지점만 표시한다.
> 검증: 요구사항 완전성·기술 타당성 2중 적대 검토를 거쳐 반영함(A/B 균형 블록, cloneStarterSet 어서션, fail-open 판별자, SnapshotConfigView 신규, 생성 타이밍 분할, staleness 가드, 다룬/안다룬 분류 등 — "검증 결과"로 표시된 대목들).
> **구현 핸드오프**: 실제 코딩 작업 지시서는 `docs/USER_STUDY_BUILD_SPEC.md` (마일스톤 M1~M7, 완료 기준, 함정 목록) — 구현 세션은 그 문서부터 읽는다.

---

## 0. 한눈에 보기

**이미 있는 것 (스터디 그대로 쓸 수 있음):**
- 참가자 셀프서비스 로그인 → instructor 계정 + **데이터셋별 클론 2개**(SWAG·NIRVANA)를 첫 로그인에 자동 생성, 번호 홀짝으로 **반대 조건** 배정 (`provision.ts`, `config.ts:69-78`) — 클론은 zero-LLM.
- 두 조건의 설정 도구 전체(보드·워크벤치·chooser·프리뷰·배포)와 AI 패리티 — as-built §6 검증 완료.
- 배포 기계 양쪽(스냅샷 deploy / baseline 버전 deploy) + 풍부한 상태 히스토리(rule 버전·config 버전·deploy 스냅샷) = RQ3 행동 지표의 원천.
- 리플레이의 부품: `resolveChatPromptFromSnapshot`(임의 질문 텍스트를 배포 스냅샷에 라우팅, **현재 호출자 0**), `getBaselineVersion`, `runChatTurn`(비스트리밍 단건 생성, 학생 챗과 같은 모델).
- 과제 설명 미주입 확인: 두 마스터 모두 `include_instruction_in_prompt=false` (2026-08-09 DB 실측). 정상 경로의 시스템 프롬프트는 rule/Rules 문서 텍스트 그대로.

**없는 것 (이번에 만들 것) — 6개 워크스트림:**

| WS | 내용 | 스터디 문서 근거 |
|---|---|---|
| 1 | 세트 큐레이션 **admin UI**(단일 화면: 기계 분류 브라우징 + 세트 배정) + **스터디 마스터**(검토 세트 60문항짜리 축소 마스터) + 문항 뱅크 | §4, §9[준비] |
| 2 | 고정 응답 **일괄 생성 하네스**(블록 테스트 8 + A/B 16×2, 홈/원정 리플레이) | §5 0:40/1:36, §9[준비] |
| 3 | **블록 테스트 UI**(예/아니오 짐작 → 응답 공개 → 5점) + 저장 | §5 0:40, §6 |
| 4 | **블라인드 A/B UI**(좌우 무작위, 4지선다) + 저장 | §5 1:36, §6 |
| 5 | **세션 오케스트레이션**: 셀 기록, 참가자 랜딩/게이팅, 진행자 콘솔, PHASE 2 격리 | §5, §7 |
| 6 | 설문 저장 + 계측 보강 + 사후 추출 스크립트 | §5 0:45, §6, §8 |

---

## 1. 갭 진단 (실측 요약)

| 스터디 요구 | 현재 상태 | 갭 |
|---|---|---|
| 검토 세트만 보여 주기 (유형당 15) | 보드가 클론의 **전체 로그**(507/348)를 로드 (`page.tsx:116`) | 큐레이션·세트 표현 자체가 없음. `review_set_items`는 다른 용도(워크벤치 예시)였고 현재 고아 |
| 블록 테스트 (새 질문 8, 짐작→공개→5점) | 없음. 로그 밖 질문을 다루는 표면 자체가 없음 (모든 생성 캐시가 클론 내 messageId 키) | UI·저장·문항 뱅크 전부 신규 |
| 블라인드 A/B (16문항, 두 설정 응답 좌우 무작위) | 없음. 2-설정 비교 UI 없음 | UI·저장·랜덤화 기록 신규 |
| 배포 후 같은 파이프라인으로 응답 일괄 생성·고정 | 부품만 존재(위 §0). 조립된 하네스·저장 테이블 없음. 생성에 temperature/seed 통제 없음 → **1회 생성 후 저장이 필수** | 하네스 + `study_generated_responses` 신규 |
| 홈/원정 (설정을 다른 데이터셋 질문에) | 라우팅이 클론 비의존(타입·판정 모두 라이브 콜, 텍스트만 필요 — 실측 확인)이라 **가능**, 배선 없음 | WS2에 포함 |
| 4셀 카운터밸런스 | pairing만 코드(홀짝), **순서는 미기록** | 셀 기록 + 런북 |
| 참가자 격리 | PHASE 2 잠금 **주석 상태**(`view.ts:14-20`), 로그인 후 일반 instructor 대시보드(두 보드 동시 노출, New Assignment·reset 노출) | 랜딩 교체 + 잠금 활성화 |
| 설문 | 없음 | WS6 |
| 행동 지표 | DB 상태 히스토리는 풍부, `study_events`는 얇음(11종, actor·타이밍 없음) — 단 스터디 문서가 이미 "DB 상태+녹화 기본"으로 설계함 | 페이즈 전환 이벤트만 보강 |

**리스크 실측 2건:**
- **fail-open 누출**: SCORE 라우팅 실패(타임아웃 15s/0-retry·pending·배포 없음) 시 `assignmentBasePrompt`(SWAG는 260자 코치 프롬프트)가 나간다. 라이브 챗에는 무해하나 **생성 하네스는 fail-open을 결과로 받아들이면 안 된다** — 참가자 설정이 무시된 응답이므로.
- **baseline "최신 배포" 참조**: `resolveBaselineChatPrompt`는 항상 최신 배포본을 읽는다. 하네스는 생성 시점에 **versionNo를 고정**해서 기록해야 재현 가능하다.

---

## 2. 워크스트림 상세

### WS1. 세트 큐레이션 파이프라인 + 스터디 마스터 + 문항 뱅크

**핵심 결정(권장): 검토 세트는 UI 필터링이 아니라 "축소 스터디 마스터"로 구현한다.**
현재 마스터(507/348문항)에서 검토 세트 60문항(유형당 15)만 담은 파생 마스터 `swag-study` / `nirvana-study`를 만들어 `STUDY_DATASETS`(config.ts:30-43)가 그것을 가리키게 한다.

- 장점: **UI 무변경**. 보드 카운트가 자동으로 15/15/15/15, probe 스윕·프리뷰 스코프·"Other questions"가 전부 60문항으로 일관, 테스트/A/B 문항이 구조적으로 참가자 화면에 존재하지 않음(누출 불가), 클론 비용도 감소.
- 대화는 **앵커 턴까지 절단**해서 복사한다 — §4 "참가자가 보는 것 = 챗봇이 받는 입력 + 그 응답"과 정합. 한 대화에 검토 문항이 2개면 마지막 것까지.
- 빌드 스크립트는 기존 `cloneStarterSet`(provision.ts:51-319)을 기반으로 하되, **필터를 단계 2~6에 대칭으로 관통**시켜야 한다(검증 결과): 현재 구조는 전 대화·전 메시지를 복사한 뒤 **1:1 remap 어서션**(provision.ts:118-146)으로 개수를 대조하므로, 필터/절단을 한쪽에만 넣으면 'Message remap collision'으로 throw한다. `_conv_map`을 검토 세트 앵커 포함 대화로 제한 + 절단 컷오프(`sequence_number <= anchor`)를 INSERT와 개수 대조 쿼리 **양쪽에** 적용 + 빈 세션 스킵. 캐시(템플릿 intent·판정, dissection, query_types, embeddings) 서브셋 복사는 기존 JOIN 구조가 그대로 처리한다.
- **템플릿 pin 유실 주의**: `score_intent_pins`는 `_msg_map` JOIN으로 복사되므로 검토 세트 밖 메시지에 걸린 starter pin은 조용히 탈락한다(provision.ts:291-303). extract-sets에서 pinned 메시지를 검토 세트에 강제 포함하거나, 빌드 후 intent별 pin 수 원본 대조 리포트를 낸다.

**큐레이션 상태는 DB가 진실 — admin UI는 단일 화면** (2026-08-09 **v2**: 인간 독립 라벨링·합의(κ) 기계 폐기. 기존 기계 분류를 브라우징 축으로 사용 — 4-type은 `score_query_types`(마스터 전수 분류 완료), subtype은 starter 템플릿 판정 `score_intent_ratings`(마스터 사전 판정 완료) → **cold start 없음**. 경계 = judge **probably_in**으로 재정의. ⚠ 스터디 설계 §4의 "연구팀 독립 라벨링 + 일치율 보고"와 다른 방법이므로 [미팅]에서 정리 — 논문 보고 문구가 바뀐다.)

```sql
study_set_members (
  dataset_key, set_kind 'review'|'test'|'ab',
  source_message_id, position,
  query_type text, subtype text, rating text,  -- 배정 시점 분류 스냅샷 (밸런스·사후 분석 기준)
  added_by, created_at,
  UNIQUE (dataset_key, source_message_id)      -- 세트 상호배타를 스키마로
)
study_curation_meta (dataset_key, demo_subtype, locked_at, locked_by)
```

**admin 큐레이션 UI `/study/admin/curation`** — 보드 3열 레이아웃 **한 화면**. **상세 설계는 `docs/CURATION_ADMIN_UI_PLAN.md` (v2)**:
- 좌: **세트 보기**(검토/블록/A/B/미배정 — 목표 대비 카운트, 클릭=그 세트만 정리해 보기) + 4 타입 섹션 안에 starter subtype 행(**● clearly_in / ◐ probably_in** 뱃지 — 판정 캐시 읽기만, 클릭 비용 0)
- 중: 질문 리스트, 행마다 **배정 토글**([검토][블록][A/B] — 상호배타); 세트 보기 모드에선 타입별 그룹 + 목표 대비 + [제거]
- 우: ConversationThread + 기계 분류 카드(매칭 subtype·등급) + 배정 버튼(키보드 1/2/3/0, ↓ 다음)
- 스트립: 세트 요약 칩 · **데모 subtype 지정**(격리 학생 질문 배정 차단 — 양 데이터셋 전 세트 제외) · [분류 갱신](판정 누락분만 기존 rate 러너) · [확정·잠금](검증: 개수 충족·격리 위반 0·A/B 균형 블록·경계비율 괴리 경고) → 잠금 후 [빌드], 해제 시 "재빌드 필요"
- 접근: `/study/admin` — 연구자 코드(`STUDY_ADMIN_CODES` allowlist) + `STUDY_ADMIN_PASSCODE`, /api/study/login 스켈레톤 복제, 비밀번호 없는 administrator 행(getInstructor는 role만 검사 — 선례 import-nirvana). 마스터 읽기는 `authorizeAssignment`로 기존 API 무변경
- **분류 결과 저장·사용**: ① 배정 스냅샷(`study_set_members`) = 세트 밸런스 리포트·사후 분석("다룬/안 다룬", subtype별 슬라이스) 기준 ② `study_question_bank`에 `query_type`·`subtype` 컬럼 ③ 클론은 기존 provision 경로로 같은 분류 캐시를 이미 복사받음(추가 작업 없음)

**검증·빌드 로직은 `src/lib/study/curation.ts` 서버 함수로 한 번만 작성** — UI의 확정 검증과 CLI가 같은 코드를 호출. 빌드 2종은 스크립트 유지(무겁고 드문 작업), UI에서 트리거 버튼만:
4. `build-study-masters.ts` — 확정(`confirmed`+locked)된 검토 세트로 축소 마스터 2개 생성(+ 데모용 미니 마스터 1개: 격리 subtype 대화만 — 튜토리얼 영상 녹화용 계정에 붙임).
5. `build-question-bank.ts` — 테스트·A/B 문항을 **원본 마스터에서** 텍스트로 동결:

```sql
study_question_bank (
  id, dataset_key, kind 'test'|'ab', position,
  source_message_id,          -- 원본 마스터 메시지 (추적용)
  context jsonb,              -- [{role, content}...] 직전 대화 턴들, 동결
  question text, query_type text
)
```

문항 제시·응답 생성 모두 이 동결 스냅샷만 사용(마스터 재빌드에 영향받지 않음).

**전환 작업**: `STUDY_DATASETS` 교체 + 기존 파일럿 참가자 10명 deprovision(스크립트 있음). NIRVANA 재import 금지(id 하드코딩 다수 — 실측 확인됨).

### WS2. 고정 응답 일괄 생성 하네스 (`src/lib/study/generate.ts`)

한 함수: **(클론, 뱅크 문항) → 응답 1건 생성·저장**. 두 조건 컨텍스트 정책 동일하게 **명시**한다(라이브 파이프라인 미러링, 검증 결과 반영): **생성 입력** = 뱅크 context 턴 전부 + 질문 (`runChatTurn`; /api/chat의 전체 히스토리 전달과 동일), **분류기 입력** = context의 마지막 assistant 턴을 `prevResponseText`, 그 직전 user 턴을 `prevQueryText`로 (route.ts:159-165의 단일 직전 교환과 동일).

- **선행 API 변경(필수)**: `resolveChatPromptFromSnapshot`(deploy-store.ts:466-476)은 현재 fail-open과 정상 결과를 반환형으로 **구별할 수 없다** — fail-open의 `{basePrompt, applied:null}`이 정상 empty-config의 `{'' , applied:null}`과 (NIRVANA처럼 basePrompt가 빈 경우) 동일하고, type root rule이 basePrompt로 시드되므로 텍스트 비교도 불건전. 반환에 `outcome: 'routed'|'empty_config'|'fail_open'` 판별자를 추가하거나 `resolveAgainstSnapshot`(null이 명확)을 export한다.
- **SCORE 클론**: 최신 `score_chat_deploys` 스냅샷 고정 → 문항마다 위 함수 호출 — `callOptions` 관대하게(45s/2-retry), **`outcome`이 routed/empty_config가 아니면 저장 거부 후 재시도**. `appliedIntentId/appliedOutcome/appliedType`을 함께 저장 → **원정 intent 적중률**([파일럿] 항목)이 공짜로 나온다.
- **Baseline 클론**: 배포된 `baseline_prompt_versions` 최신 행의 **versionNo를 고정 기록**, prompt 텍스트로 생성.
- 저장:

```sql
study_generated_responses (
  id, participant_id, clone_assignment_id, bank_item_id, purpose 'test'|'ab',
  config_ref jsonb,   -- {deployId|baselineVersionNo}
  applied jsonb,      -- {intentId, outcome, type} (score만)
  response text, model text, created_at,
  UNIQUE (clone_assignment_id, bank_item_id)
)
```

- 트리거는 **진행자 콘솔 버튼**(WS5). 타이밍은 세션 타임라인에 맞춰 **분할**(검증 결과 — 유일한 휴식 0:48은 블록2 배포 *이전*): ① 블록 테스트용 8건 = 해당 블록 배포 직후(병렬 수십 초, 테스트 시작 전 완료) ② **블록1 클론의 A/B 16건 = 0:48 휴식 중**(블록1 배포는 이미 확정·페이즈 잠금) ③ **블록2 클론의 A/B 16건 = 블록2 배포 후, 블록2 테스트·설문과 병행**. 배포가 없으면 생성 거부 + 콘솔에 표시. 기존 동시성 리미터(`SCORE_LLM_CONCURRENCY`) 사용, upsert 멱등.
- CLI 폴백 `scripts/study/generate-responses.ts` (tsx는 `--env-file` 필요 — 메모리 참조).

### WS3. 블록 테스트 UI (`/study/session/test`)

- 레이아웃: 좌 = **배포 스냅샷의 읽기 전용 설정 뷰**, 우 = 문항 카드. 설정 뷰는 **신규 컴포넌트 `SnapshotConfigView`**로 만든다(검증 결과 — DeployModal 좌측 pane은 모달 내부 인라인 JSX + GET deploy의 **라이브 보드 상태**를 그리므로 재사용 불가): `parseChatDeploySnapshot(getLatestChatDeploy(clone))` 또는 `study_generated_responses.config_ref`의 deployId에서 렌더 — 타입별 체인을 parentId/position 들여쓰기로, baseline은 배포 Rules 문서 텍스트. 스타일만 DeployModal에서 차용. "재는 것은 기억력이 아니라 표현의 해독력" 요구 충족.
- 문항 흐름(8개 순차): context 턴 + 질문 표시(ConversationThread 재사용) → **[내 의도대로 답할 것 같다 / 아닐 것 같다]** → 서버가 짐작 저장 후에야 응답 반환(엿보기 구조적 차단) → **5점 부합도** → 다음.
- 저장:

```sql
study_test_answers (
  participant_id, clone_assignment_id, bank_item_id,
  guess boolean, rating smallint, guessed_at, rated_at,
  UNIQUE (clone_assignment_id, bank_item_id)
)
```

### WS4. 블라인드 A/B UI (`/study/session/ab`)

- 16문항: 두 데이터셋 8+8 인터리브. 순서는 사전 고정 — 단 **균형 블록으로 구성**한다(검증 결과): 연속 4문항마다 두 데이터셋 2+2·유형 회전이 되도록 짜서, [파일럿]의 어떤 절단점(16→12→8)에서도 데이터셋 반반·유형 분산이 유지되게. 임의 셔플의 position 절단은 홈/원정 상쇄(§6)를 체계적으로 깨뜨릴 수 있다.
- 문항마다: context + 질문 + **두 클론의 응답 좌우 배치** — 좌우는 참가자×문항 단위 서버 시드 랜덤, 배치 기록. 선택지 4개: 왼쪽 / 오른쪽 / 둘 다 괜찮다 / 둘 다 아니다.
- 화면에 조건·데이터셋 정체 노출 금지(중립 라벨 "응답 A/B"도 쓰지 않고 그냥 좌우 병렬).
- 저장:

```sql
study_ab_answers (
  participant_id, bank_item_id,
  left_clone_assignment_id, right_clone_assignment_id,  -- 랜덤화 기록
  choice 'left'|'right'|'both'|'neither', answered_at,
  UNIQUE (participant_id, bank_item_id)
)
```

### WS5. 세션 오케스트레이션

- **셀 기록**: `conditionForDataset` 홀짝 pairing 유지 + **번호 mod 4 → 셀(순서 포함)** 파생 함수 추가, provision 시 `study_participants.cell` + `block_order`(어느 데이터셋 먼저) 기록. 진행자는 런북 표대로 번호만 발급하면 배정이 코드로 강제·기록된다(§7 "4셀 균형").
- **참가자 랜딩 `/study/session`**: 로그인 리다이렉트를 instructor 대시보드에서 이 페이지로 교체. 페이즈 상태 기계:
  `block1_work → block1_test → block1_survey → break → block2_work → block2_test → block2_survey → ab → done`
  현재 페이즈의 카드 하나만 활성(블록1 중에는 블록2 클론 접근 불가 — 대시보드 동시 노출 문제 해소). 페이즈는 `study_participants.phase` + 전환마다 `study_events`(`phase_advance`) — 블록 시간·time-on-task 측정 공백도 이걸로 메꿔진다. 단 `study_events`는 현재 `assignment_id NOT NULL`·participant 컬럼 없음(store.ts:118-123)이라 참가자 스코프 이벤트(break/ab/done은 클론 둘에 걸침)를 실을 수 없다 — **`participant_id` 컬럼 추가 + assignment_id nullable 완화**(기존 `ADD COLUMN IF NOT EXISTS` 패턴).
- **진행자 콘솔 `/study/admin`** (admin 전용): 참가자별 셀·페이즈·클론 배포 상태·생성 진행률, [페이즈 진행] [테스트 응답 생성] [A/B 응답 생성] 버튼, 이상 시 리셋. 페이즈 진행은 진행자가 누른다(Zoom 배석 설계와 일치, 참가자 오조작 방지).
- **격리 일괄 적용**: `resolveStudioView` PHASE 2 주석 해제(view.ts:14-20) · 헤더 중립 명명(S-4) · 참가자에게 `?view` 무시 · `/api/study/reset` 참가자 노출 제거(admin 콘솔로 이동) · instructor 대시보드의 New Assignment 등 참가자 차단.

### WS6. 설문 + 계측 + 사후 추출

- **설문(권장: in-app)**: 블록 설문(통제감 3~4 + 신뢰 2~3 + 부담 3)을 랜딩 페이즈에 끼워 넣고 `study_survey_answers(participant, block, item_key, value)`에 저장. 문항 원문은 [미팅] 확정 후 JSON config로 주입(코드 무변경으로 교체 가능). 외부 폼(Qualtrics)로 가면 이 테이블만 생략 — 나머지 계획 불변.
- **계측 보강(최소)**: `phase_advance` 이벤트 + 테스트/A/B 응답 저장(테이블이 곧 이벤트). 그 이상의 클라이언트 이벤트는 넣지 않는다 — 스터디 문서가 행동 지표를 "DB 상태 + 녹화 + think-aloud"로 이미 못박음(§6). 세션 중 admin이 참가자 클론을 열지 않는 것을 런북에 명시(study_events에 actor 없음).
- **사후 추출 `scripts/study/export-metrics.ts`** (P1): 참가자×블록 단위 CSV — 생성 경로/트리 배치(score_intents + config_versions), correction·fold(pins), filter 사용(searches + events), Rules 편집 패턴(rule_versions·prompt_versions 길이 추이), 배포 횟수/시각, 테스트 짐작·5점, A/B 선택, 홈/원정 분해, 짐작 정확도(5점≤3 접기) 계산 포함.
- **"다룬/안 다룬" 사후 분류**(§6 블록 테스트 부합도의 전제조건 — 검증에서 누락 지적): SCORE 쪽은 저장된 `appliedIntentId`로 자동(참가자가 만든 intent에 걸렸으면 '다룬'), **Baseline 쪽은 절차 정의 필요** — 각 문항을 최종 Rules 문서와 대조하는 연구자 코딩 프로토콜(2인 독립 + 불일치 조정, 선택적으로 LLM 보조). export-metrics에 SCORE 자동 분류 포함, Baseline 코딩 시트 출력.
- **(선택, P2)** LLM 채점기 확장([파일럿 후 결정]) — WS2 하네스가 이미 임의 질문×설정 생성을 제공하므로, 세트 밖 로그로 확장할 때 하네스 재사용만 하면 된다.

---

## 3. 필수 잔손질 (워크스트림 밖 개별 항목)

| # | 항목 | 근거 |
|---|---|---|
| 1 | 하네스의 fail-open 거부 + 재시도 (§1 리스크) | 참가자 설정 무시 응답이 측정에 섞임 |
| 2 | baseline 생성 시 versionNo 고정 기록 | "최신 배포" 참조는 재현 불가 |
| 3 | 마스터 `include_instruction_in_prompt` false **유지 잠금**(스터디 마스터 빌드 시 false 강제) | §3 "과제 설명은 프롬프트에 안 들어간다" |
| 4 | 테스트 응답은 짐작 저장 후에만 서버가 반환 | 엿보기 차단 |
| 5 | 테스트/A/B 페이즈 진입 가드: 생성물 **존재** + 모든 생성물의 `config_ref`가 클론의 **현재 최신 배포와 일치**해야 진입(생성 후 재배포 = stale 응답 차단), 불일치 시 콘솔에 원클릭 재생성 | §5 "방금 만든 챗봇을 확인" / "배포된 뒤 생성해 고정" |
| 6 | score-v7 WIP 커밋/안정화 후 착수 | 현재 워킹트리에 미커밋 변경 다수 |
| 7 | 파일럿 전 기존 참가자 10명 deprovision + 스터디 마스터로 재프로비전 | WS1 전환 |

---

## 4. 구현 순서 (마감 9/10 역산)

사람 작업(라벨링·영상·모집)이 크리티컬 패스이므로 **그걸 여는 코드부터**:

1. **WS1 큐레이션 도구(단일 화면)** (2~2.5일) → 완성 즉시 연구팀 검수·배정 시작 — v2로 인간 라벨링 공정이 사라져 CSV 선행 단계·라벨 수합 대기가 모두 불필요
2. **WS2 하네스 + 테이블 + 선행 API 변경** (1일) — 다른 모든 측정의 기반 (검수·배정과 병행)
3. **WS5 세션 오케스트레이션 + PHASE 2** (2~2.5일 — 콘솔을 정적 테이블+버튼으로 줄이면 1.5일)
4. **WS3 블록 테스트 UI + SnapshotConfigView** (1.5일)
5. **WS4 A/B UI** (1일)
6. **WS1-빌드 스크립트 2종** (1일, 세트 확정 후 — 축소 마스터·뱅크, cloneStarterSet 필터 대칭 관통 포함)
7. **WS6 설문 + 마무리 잔손질** (0.5~1일)

합계 **~9~9.5 dev-day** (v2 단일 화면으로 v1 대비 ~1일 절감 + **라벨링 인력 일정 병목 소멸** — 크리티컬 패스가 코드로 들어옴). 세트 확정은 도구 완성 후 연구팀 검수·배정 하루면 충분하므로 **파일럿 1~2명 8월 3주차** 목표 유지, [파일럿] 항목 확정 후 본 세션 ~3주(§7)가 9/10 전에 닿는다 — 파일럿 후 세트 조정이 UI에서 즉시라 재빌드 리드타임이 없다. 사후 추출 스크립트(WS6 후반)는 세션 진행과 병행 가능.

## 5. 구현 전 확정할 것 (사용자 결정)

| # | 질문 | 권장 |
|---|---|---|
| 1 | 검토 세트: 축소 스터디 마스터 vs 전체 클론 + UI 필터 | **축소 마스터** (UI 무변경, 누출 불가) |
| 2 | 설문: in-app vs 외부 폼 | **in-app** (데이터 일원화, PID 자동) |
| 3 | 셀 배정: 번호 mod4 자동 vs admin 수동 | **번호 mod4** (기존 홀짝 관행의 확장, 기록 자동) |
| 4 | 페이즈 진행: 진행자 콘솔 vs 참가자 self-advance | **진행자 콘솔** (Zoom 배석 설계와 일치) |
| 5 | A/B 문항 순서: 전 참가자 동일 고정 vs 참가자별 셔플 | **동일 고정 + 균형 블록**(연속 4문항 = 데이터셋 2+2·유형 회전 — 절단점 안전; 좌우 랜덤은 참가자별) |
| 6 | 큐레이션 방식: v1 3화면(인간 라벨링+합의+빌더) vs **v2 단일 화면**(기계 분류 브라우징+배정) | **v2** (2026-08-09 사용자 결정 — 합의 기계 폐기, 경계=probably_in. 큐레이션 방법 변경은 [미팅]에서 스터디 설계 §4와 정리) |

## 6. 코드 밖 준비물 (참조 — §9 [준비]와의 대응)

- 데모 영상 2편: WS1의 데모 미니 마스터 + 데모 계정에서 녹화 (격리 subtype은 큐레이션 화면에서 starter 목록 중 양 데이터셋 공통 희귀로 지정)
- 설문 문항 원문·척도: [미팅] → WS6 config 주입
- 진행자 런북: 번호 발급표(4셀), 세션 체크리스트(배포 확인 → 생성 버튼 → 페이즈 진행), "세션 중 참가자 클론 열지 않기"
- IRB 수정, 모집 스크리너: 시스템 무관

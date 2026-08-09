# 유저스터디 구현 핸드오프 스펙

**작성:** 2026-08-09 | **대상 구현자:** Claude Opus | **발주:** USER_STUDY v1 실행을 위한 시스템 업데이트 전체

**선행 문서 (읽는 순서):**
1. `docs/SCORE_BASELINE_DESIGN.md` — 기존 시스템 as-built (코드가 진실, 이 문서가 그 기록)
2. `docs/USER_STUDY_IMPL_PLAN.md` — 무엇을/왜 만드는지 (6 워크스트림, 갭 진단, 테이블 DDL)
3. `docs/CURATION_ADMIN_UI_PLAN.md` (v2) — 큐레이션 도구 상세 (단일 화면, 접근, API)
4. `docs/USER_STUDY 설계 v1.md` — 스터디 설계 (요구사항의 원천; ⚠ 파일명이 NFD 한글이라 Read로 직접 못 연다 — `ls docs | grep USER_STUDY`로 실제 바이트 확인 후 접근)

**판단 우선순위** (구현 중 문서 간 충돌 시): USER_STUDY 설계 v1 > USER_STUDY_IMPL_PLAN > CURATION_ADMIN_UI_PLAN(v2) > as-built. `STUDY_BASELINE_SPEC.md`는 SUPERSEDED — 개별 조항 인용 금지.

---

## 0. 작업 규칙

- **시작 전 확인**: `score-v7` 브랜치에 미커밋 WIP가 있으면 사용자에게 커밋 여부를 먼저 확인하고, 커밋 후 작업 브랜치(예: `study-tools`)를 분기한다.
- **DB 변경은 런타임 DDL**: 신규 테이블·컬럼은 `src/lib/study/store.ts`의 `ensureStudyTables()`에 `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`로 추가하고 `src/db/schema.ts`에 미러한다(최근 테이블은 drizzle 마이그레이션을 쓰지 않는 것이 관행). DB는 `POSTGRES_URL`.
- **tsx 스크립트는 `--env-file=.env` 필수** — 없으면 .env를 안 읽어 "user dummy 인증 실패"류로 죽는다.
- **마스터 assignment 2개는 절대 수정 금지** (swag-dataset `03201d5d-…`, nirvana-dataset `ea905a40-…`). 큐레이션은 마스터를 읽기만 하고 신규 테이블에만 쓴다. `assertNotMaster` 가드가 이미 있다(teardown.ts:69-76).
- **NIRVANA 재import 금지** — 재import는 새 assignment id를 만들어 `STUDY_DATASETS`와 여러 스크립트의 하드코딩 id를 고아로 만든다.
- **참가자 화면 어휘 규약 유지**: 참가자에게 보이는 어떤 신규 표면(블록 테스트·A/B·랜딩)에도 "SCORE"/"baseline"/"intent" 문자열을 렌더하지 않는다 (as-built §3.5·§11의 기존 규약. admin 전용 화면은 무관).
- **신규 env**: `STUDY_ADMIN_CODES`(예: `R1,R2,R3`), `STUDY_ADMIN_PASSCODE`. 기존 `STUDY_PASSCODE` 등은 불변.
- 코드 스타일·컴포넌트 관행은 주변 파일을 따른다. 목업(디자인 참고)은 대화 아티팩트로 존재하나, 시각 문법은 전부 기존 컴포넌트에서 가져오므로 코드만 보면 된다.

---

## 1. 마일스톤 개요 (= PR 단위, 이 순서대로)

| M | 내용 | 견적 | 의존 |
|---|---|---|---|
| M1 | 큐레이션 admin 도구 (단일 화면) | 2~2.5일 | — |
| M2 | 고정 응답 생성 하네스 + 선행 API 변경 | 1일 | — (M1과 병행 가능) |
| M3 | 세션 오케스트레이션 + PHASE 2 격리 | 2~2.5일 | — |
| M4 | 블록 테스트 UI + SnapshotConfigView | 1.5일 | M2, M3 |
| M5 | 블라인드 A/B UI | 1일 | M2, M3 |
| M6 | 빌드 스크립트 2종 + 데이터 전환 | 1일 | M1(세트 확정 산출물) |
| M7 | 설문 + 사후 추출 + 잔손질 | 0.5~1일 | M3 |

합계 ~9\~9.5일. M6의 실행(전환)은 연구팀의 세트 확정 후이지만 코드는 먼저 써 둘 수 있다.

---

## M1. 큐레이션 admin 도구

**스펙**: `CURATION_ADMIN_UI_PLAN.md` v2 전체가 스펙이다. 요약: 로그인(연구자 코드+passcode) → `/study/admin/curation?ds=swag|nirvana` 단일 화면(좌: 세트 보기+타입/subtype 트리, 중: 질문 리스트+배정 토글, 우: 대화+분류 카드+배정 버튼) → 확정·잠금.

**신규 DDL**: `study_set_members`(UNIQUE(dataset_key, source_message_id) — 상호배타), `study_curation_meta`. 전체 정의는 CURATION 문서 §3.

**신규 라우트** (`/api/study/admin/…`, 전부 `getInstructor→401 / !isAdministrator→403` — 관례는 /api/instructor/score/config PUT route.ts:19-31):
`POST login` · `GET curation/state?ds=` · `PUT curation/member` · `POST curation/demo-subtype` · `POST curation/classify` · `POST curation/lock|unlock|build`(build는 M6 lib 연결 전까지 501 stub).

**구현 지침 (실측 완료된 재사용 지점):**
- 로그인: `/api/study/login/route.ts`(34-109)의 스켈레톤 복제 — 레이트리밋, `timingSafeEqual`, `user_session` 쿠키(24h). `ensureAdminAccount(code)`는 `ensureParticipantAccount`/`createAccount`(provision.ts:325-369) 미러: `{role:'administrator', password:null, isVerified:true, email:'{code}@admin.score.local'}`. **비밀번호 없는 administrator 행은 동작이 검증된 패턴** — `getInstructor`(auth.ts:19-36)는 role만 검사, 선례 import-nirvana.ts:104-117. 코드 정규화는 `normalizeParticipantNumber`(store.ts:149-156) 재사용.
- 서버 페이지 행 조립: score `page.tsx`의 105-136(병렬 로드) + 192-196(type 맵, `TYPE_CLASSIFIER_VERSION` 게이트) + 269-279(turnNumber) + 283-316(행 빌드)을 복사하고 intent/pins/deploy 기계는 제거. `intentRatings:{}, pinnedIntents:{}, applied*:null`로 채우면 `ScoreQueryRow` 완성. `isNirvana`는 shareToken 판별(page.tsx:414).
- 직수입 가능(props-only): `StudioShell`+`useHeaderSlot`, `ConversationThread`(conversation.tsx:37 — **ScoreQueryRow 필요, raw {role,content} 불가**), `PaneSearch`/`QueryTextButton`(workbench-shared.tsx:105/131), `SortSelect`/`sortQueryRows`(query-list.tsx), materials.tsx의 `QuerySnippet` 등.
- 복사 추출(모듈-프라이빗, 전부 표현 코드): IntentBoard.tsx의 트리 엘보(149-181, 286-297), 점선 add-row(185-204), `Badge`(271-277)/`SmallChip`(601-610)/`TYPE_SECTION_DOT`(207-212), `BaselineFilterTree`(331-457 — 좌측 레일의 최적 템플릿), hover 행 컨트롤 문법(IntentWorkbench.tsx:1728-1736).
- **subtype 뱃지의 데이터 규칙**: subtype = 마스터의 `is_template` intent들. 카운트/필터는 `score_intent_ratings`에서 **메시지별 최신 판정, defHash 세대 불문**으로 읽는다 — probe 템플릿 시딩과 같은 규칙(probe.ts:79-136이 정확한 선례; 레이팅 하니스 버전 bump는 텍스트를 안 바꾸고 해시만 바꾼다). clearly_in과 probably_in을 구분 노출.
- [분류 갱신]: 마스터에 판정 누락(템플릿×메시지 조합)이 있으면 기존 rate 러너(rate/route.ts의 배치 기계)를 마스터 대상으로 실행. state API가 누락 수를 보고.
- 데모 subtype 지정 시: 해당 subtype clearly_in 질문을 가진 **학생(participantToken)의 전 질문**을 양 데이터셋에서 배정 차단(회색 + 토글 비활성).
- 잠금 검증(`src/lib/study/curation.ts`에 순수 함수로): 세트별 개수 충족(검토 15×4, 테스트 유형당 2, A/B 유형당 2), 격리 위반 0, A/B 균형 블록 구성 가능(M5 규칙), probably_in(경계) 비율의 세트별 값 vs 전 로그 자연비율 리포트(괴리는 경고, 차단 아님).

**완료 기준**: R1 로그인 → 데이터셋 토글 → subtype 클릭이 LLM 0회로 리스트 필터(●/◐ 구분) → 행/우측 패널에서 배정·해제 즉시 저장 → 세트 보기에서 타입별 목표 대비·제거 → 데모 지정 시 격리 차단 → 검증 통과 시에만 잠금. 참가자 계정(instructor role)으로는 403.

## M2. 생성 하네스 + 선행 API 변경

**선행 API 변경 (필수, 하네스보다 먼저):** `resolveChatPromptFromSnapshot`(deploy-store.ts:466-476)은 현재 fail-open과 정상을 반환형으로 구별할 수 없다 — fail-open의 `{basePrompt, applied:null}`이 전-rule-빈 정상 케이스의 `{'', applied:null}`과 (NIRVANA처럼 basePrompt='') 동일하고, type root rule이 basePrompt로 시드되므로 텍스트 비교도 불건전. **반환에 `outcome: 'routed'|'empty_config'|'fail_open'` 판별자를 추가**하거나 `resolveAgainstSnapshot`(null이 명확)을 export. 기존 호출자는 없다(검증됨 — 이 함수는 현재 orphan).

**신규 DDL**: `study_question_bank`(dataset_key, kind 'test'|'ab', position, source_message_id, context jsonb, question, **query_type, subtype**), `study_generated_responses`(participant_id, clone_assignment_id, bank_item_id, purpose, config_ref jsonb, applied jsonb, response, model, UNIQUE(clone_assignment_id, bank_item_id)).

**`src/lib/study/generate.ts`**: (클론, 뱅크 문항) → 응답 1건 생성·저장, upsert 멱등, 동시성은 기존 `SCORE_LLM_CONCURRENCY` 리미터.
- **컨텍스트 정책(두 조건 동일, 라이브 파이프라인 미러)**: 생성 입력 = 뱅크 context 턴 전부 + 질문을 `runChatTurn`(chat-run.ts:19-31)에 — /api/chat이 전체 히스토리를 모델에 주는 것(route.ts:232-237)과 동일. 분류기 입력 = context의 마지막 assistant 턴을 `prevResponseText`, 그 직전 user 턴을 `prevQueryText`로 — route.ts:159-165의 단일 직전 교환과 동일.
- SCORE 클론: 최신 `score_chat_deploys` 스냅샷을 생성 시작 시 1회 로드해 고정(config_ref에 deployId), 문항마다 위 함수 호출 — `callOptions {timeoutMs:45_000, maxRetries:2}`, **outcome이 routed/empty_config가 아니면 저장 거부 후 재시도**. `appliedIntentId/appliedOutcome/appliedType`을 `applied`에 저장(원정 intent 적중률 = [파일럿] 확인 항목이 여기서 나온다).
- Baseline 클론: `getBaselineVersion`(baseline-store.ts:357-364)으로 배포본을 찾아 **versionNo를 config_ref에 고정** — `resolveBaselineChatPrompt`는 항상 최신을 읽으므로 직접 쓰지 않는다.
- 트리거: M3 콘솔 버튼 + CLI 폴백 `scripts/study/generate-responses.ts`(--env-file 주의).

**완료 기준**: 수제 뱅크 2문항으로 양 조건 생성 → 재실행 시 캐시 히트(멱등) → SCORE 스냅샷 없는 클론에서 생성 거부 → fail_open 강제 상황(judge 타임아웃 모킹)에서 저장 안 됨.

## M3. 세션 오케스트레이션 + PHASE 2

**DDL 변경**: `study_participants`에 `cell int`, `block_order text`, `phase text` 추가. `study_events`에 `participant_id` 추가 + `assignment_id` NOT NULL 완화(페이즈 이벤트는 참가자 스코프 — 클론 둘에 걸침).

**셀 배정 — 기존 홀짝 pairing과 정합인 mod4 확장** (provision 시 기록; 기존 `conditionForDataset`(config.ts:69-78)는 불변):

| N%4 | pairing(기존 홀짝) | 1블록 데이터셋 | 셀 |
|---|---|---|---|
| 1 | swag=baseline, nirvana=score | swag | Baseline(SWAG) 먼저 |
| 2 | swag=score, nirvana=baseline | swag | SCORE(SWAG) 먼저 |
| 3 | swag=baseline, nirvana=score | nirvana | SCORE(NIRVANA) 먼저 |
| 0 | swag=score, nirvana=baseline | nirvana | Baseline(NIRVANA) 먼저 |

(1·3 홀수, 2·0 짝수 — 기존 함수와 모순 없음. 진행자는 런북 표대로 번호만 발급.)

**참가자 랜딩 `/study/session`**: 페이즈 상태 기계 `block1_work → block1_test → block1_survey → break → block2_work → block2_test → block2_survey → ab → done`. 현재 페이즈 카드만 활성; block1 중 블록2 클론 링크 비노출. 로그인 redirect를 `/instructor/dashboard`에서 이 페이지로 교체(login/route.ts:104-109). 페이즈 전환마다 `study_events`(`phase_advance`, participant_id) 적재 — 시간 지표의 원천.

**진행자 콘솔 `/study/admin`(큐레이션과 같은 gate)**: 참가자 목록 — 셀·페이즈·클론별 배포 상태·생성 진행률, 버튼 [페이즈 진행] [블록 테스트 생성] [A/B 생성(블록1분/블록2분 분리)] [리셋]. 정적 테이블+버튼이면 충분(폴링 불요).
- **생성 타이밍 분할**: 블록1 클론의 A/B 16건은 break 페이즈에서(블록1 배포 확정 후), 블록2 클론의 16건은 블록2 배포 후 테스트·설문과 병행. 블록 테스트 8건은 각 블록 배포 직후.
- **staleness 가드**: test/ab 페이즈 진입은 해당 생성물 존재 + **모든 config_ref가 클론의 현재 최신 배포와 일치**해야 허용; 불일치는 콘솔에 원클릭 재생성.

**PHASE 2 격리 일괄**: `resolveStudioView` 참가자 분기 주석 해제(view.ts:14-20 — admin의 ?view는 유지됨), 참가자 세션 헤더 "SCORE"→"Chatbot Studio"(S-4), `/api/study/reset` 참가자 호출 차단(콘솔로 이동), 참가자의 instructor 대시보드 접근을 `/study/session`으로 redirect.

**완료 기준**: 테스트 참가자 1명으로 로그인→block1_work(해당 클론만 접근)→배포→콘솔 생성→test 진입(가드 동작)→…→done까지 워크스루. 참가자로 `?view` 무력화 확인.

## M4. 블록 테스트 UI

- **`SnapshotConfigView` 신규 컴포넌트**: 배포 스냅샷 렌더 — `parseChatDeploySnapshot(getLatestChatDeploy(clone))` 또는 `config_ref.deployId`에서, 타입별 체인을 parentId/position 들여쓰기로; baseline은 배포 Rules 문서 텍스트. **DeployModal 좌측 pane 재사용 금지** — 그것은 모달-로컬 state + GET deploy의 **라이브 보드 상태**를 그린다(DeployModal.tsx:69-83; 검증에서 확인). 스타일만 차용.
- 페이지 `/study/session/test`: 좌 = SnapshotConfigView(상시 노출 — "재는 것은 해독력"), 우 = 문항 카드 8개 순차: context+질문 표시 → [예/아니오 짐작] → **서버가 짐작 저장 후에만 응답 반환**(엿보기 구조 차단) → 5점 부합도 → 다음.
- 뱅크 문항 렌더는 `ChatMessages`(src/components/chat/ChatMessages.tsx — raw {role,content} 렌더러). ConversationThread는 불가(ScoreQueryRow 요구).
- **신규 DDL**: `study_test_answers`(participant_id, clone_assignment_id, bank_item_id, guess boolean, rating smallint, guessed_at, rated_at, UNIQUE(clone_assignment_id, bank_item_id)).
- 화면에 조건 정체 문자열 없음(어휘 규약).

**완료 기준**: 짐작 전 응답이 네트워크 응답에도 없음(서버 게이트) · 8문항 완료 시 페이즈 자동 표시 · 새로고침해도 진행 상태 유지.

## M5. 블라인드 A/B UI

- 페이지 `/study/session/ab`: 16문항 순차 — context+질문 + **두 클론의 응답 좌우 병렬**, 선택 [왼쪽 / 오른쪽 / 둘 다 괜찮다 / 둘 다 아니다].
- **문항 순서 = 사전 고정 균형 블록**: 연속 4문항마다 두 데이터셋 2+2·유형 회전 — [파일럿]의 16→12→8 절단이 position 순으로 잘라도 데이터셋 반반·유형 분산이 유지되게. 순서는 M6 뱅크 빌드에서 position으로 굽는다(전 참가자 동일).
- **좌우 배치**: 참가자×문항 결정론 시드(`hash(participantId + bankItemId) % 2`) — 재렌더 안정, DB에 기록.
- **신규 DDL**: `study_ab_answers`(participant_id, bank_item_id, left_clone_assignment_id, right_clone_assignment_id, choice, answered_at, UNIQUE(participant_id, bank_item_id)).

**완료 기준**: 같은 참가자 재접속 시 좌우 불변 · 기록에 배치+선택+시각 · 두 응답 출처가 응답 payload 어디에도 식별 불가.

## M6. 빌드 스크립트 2종 + 데이터 전환

- **`scripts/study/build-study-masters.ts`**: 확정(locked)된 검토 세트로 축소 마스터 `swag-study`/`nirvana-study` + 데모 미니 마스터 생성. `cloneStarterSet`(provision.ts:51-319) 기반이되 **필터를 단계 2~6에 대칭 관통** — ⚠ 이 함수의 1:1 remap 어서션(provision.ts:118-146)은 srcMsgs를 `_conv_map` 전체에서 세므로, 한쪽만 필터하면 'Message remap collision'으로 throw한다(검증 확인). `_conv_map`을 검토 앵커 포함 대화로 제한 + 절단 컷오프(`sequence_number <= 마지막 앵커`)를 INSERT와 카운트 쿼리 양쪽에 적용 + 빈 세션 스킵. 빌드 후 리포트: 타입별 15/15/15/15, **템플릿 pin 유실 수**(pins는 _msg_map JOIN이라 세트 밖 pin은 조용히 탈락 — provision.ts:291-303), `include_instruction_in_prompt=false` 강제.
- **`scripts/study/build-question-bank.ts`**: 테스트·A/B 문항을 **원본 마스터에서** 동결(context jsonb + question + query_type/subtype), A/B position은 M5 균형 블록 규칙으로 산출.
- **전환 절차 (사용자 확인 후 실행)**: 기존 참가자 deprovision(`scripts/study/deprovision-participants.ts`) → `STUDY_DATASETS`(config.ts:30-43)를 스터디 마스터로 교체 → 테스트 참가자로 클론 검증.

**완료 기준**: 빌드된 스터디 마스터를 클론 → 보드 카운트 15/15/15/15 · probe 스코프 60 · 테스트/A/B 문항이 클론에 부재 · starter 필터가 즉시 결과(템플릿 시딩 생존) · 데모 subtype 학생 부재.

## M7. 설문 + 사후 추출 + 잔손질

- 설문: `/study/session` 페이즈에 in-app 폼(문항은 JSON config 주입 — 원문은 [미팅] 후 확정, placeholder로 구현). `study_survey_answers`(participant_id, block, item_key, value).
- `scripts/study/export-metrics.ts`(세션과 병행 가능): IMPL_PLAN WS6 목록 — 참가자×블록 CSV + 짐작 정확도(5점≤3='아니오' 접기) + 홈/원정 분해 + **"다룬/안 다룬" 분류**(SCORE=저장된 appliedIntentId로 자동, Baseline=최종 Rules 문서 대조용 코딩 시트 출력).
- 잔손질 체크: teardown이 신규 테이블들(set_members 제외 — 마스터 스코프)을 지우는지 확인 · 콘솔에서 세션 중 admin이 참가자 클론을 열지 않게 경고 문구.

---

## 2. 함정 목록 (전부 이번 설계 과정에서 실측·검증된 것 — 문서만 봐선 모른다)

1. **cloneStarterSet 어서션**(provision.ts:118-146) — 필터 복사는 대칭 관통 없이는 무조건 throw (M6).
2. **resolveChatPromptFromSnapshot은 fail-open 판별 불가** — outcome 판별자 API 변경이 선행 (M2). 현재 호출자 0이라 변경 안전.
3. **DeployModal 좌측 pane은 라이브 보드 상태** — 배포 스냅샷 뷰 아님, 재사용 금지 (M4).
4. **ConversationThread는 ScoreQueryRow 전용** — raw 턴은 ChatMessages (M1은 전자, M4/M5는 후자).
5. **resolveBaselineChatPrompt는 항상 최신 배포를 읽음** — 하네스는 versionNo 직접 고정 (M2).
6. **study_events는 assignment_id NOT NULL + participant 컬럼 없음** — 페이즈 이벤트 전에 DDL 변경 (M3).
7. **분류기와 생성기의 컨텍스트가 다르다** — 분류기 = 직전 1교환, 생성 = 전체 히스토리 (M2 정책이 이를 미러).
8. **subtype 판정 캐시는 defHash 세대 불문 메시지별 최신** — probe.ts:79-136이 정확한 선례 (M1).
9. **fail-open은 basePrompt를 서빙** — SWAG 마스터는 260자 코치 프롬프트(instructions 주입은 양쪽 false, 2026-08-09 실측). 하네스는 fail_open 저장 거부로 차단 (M2).
10. **NIRVANA 재import 금지** — id 하드코딩 다수.
11. **NFD 파일명** — "USER_STUDY 설계 v1.md"는 자모 분해형.
12. **tsx는 --env-file 필수**.
13. **A/B 절단(16→12→8)은 균형 블록 없이는 체계적 편향** — position 순서를 굽는 M6와 M5가 같은 규칙 공유.
14. **PHASE 2 잠금은 참가자만** — admin ?view 프리뷰는 유지되므로 개발 중 켜도 안전 (M3).

## 3. 사용자에게 확인 후 진행할 지점 (멈춰야 하는 곳)

1. **M0**: score-v7 미커밋 WIP 처리(커밋 메시지/범위).
2. **M6 실행**: 기존 참가자 10명 deprovision + `STUDY_DATASETS` 전환 시점 (파괴적 — 반드시 확인).
3. **M7 설문 문항 원문** ([미팅] 후 전달받아 config 주입).
4. 데모 subtype 확정은 코드 작업 아님 — 연구팀이 큐레이션 화면에서 지정.
5. 구현 중 스펙 문서 간 충돌을 발견하면 임의 해석하지 말고 §판단 우선순위로 정리한 뒤, 그래도 애매하면 질문.

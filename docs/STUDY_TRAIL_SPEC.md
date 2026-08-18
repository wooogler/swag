# Study trail — 참가자별 행동 로그 + 다운로드 구현 스펙

> 작성 2026-08-16. 대상: 구현 담당(Opus). 근거 문서: `USER_STUDY 설계 v2.md` §6 (RQ1 행동 기록 = "DB 상태 + 화면 녹화 + 관찰 메모"), §169 ("이벤트 커버리지가 얇음").
> 이 스펙은 **결정된 것**만 담는다. 열린 질문은 §7에 모아 두었고, 거기 없는 것은 열려 있지 않다.
>
> **구현 완료 2026-08-16.** §7의 세 질문은 전부 기본값으로 진행했다(reveal 시각 생략 · `rating_run` payload 유지 · 채택은 60초 근사). 구현하며 스펙과 달라진 것 셋: ① `rewrite-intents`는 `{title, definition}`이 아니라 **문자열 배열**을 반환하므로 그대로 저장한다. ② 첫 스냅샷(v1)은 클론이 들고 온 템플릿 36개를 포함하므로, diff-from-null을 창작으로 읽지 않고 **`config_seed` 한 줄**로 접는다(템플릿은 diff 전체에서 제외, seed 룰 버전도 제외). ③ 테이블이 이미 내는 행을 이벤트가 중복하는 다섯 종(`intent_create` 등)은 **이벤트 쪽을 버린다** — 안 그러면 개수를 세면 두 배가 된다.

## 0. 한 문단 요약

RQ1(Organization — 교수자가 로그로부터 의도를 어떻게 설정으로 조직해 가는가)에 답하려면 참가자가 **언제 무엇을 만들고·고치고·되돌렸는지**의 시간순 기록이 필요하다. 지금 시스템은 SCORE 쪽에 **저장마다 전체 스냅샷**(`score_config_versions`)을 이미 남기고 있어 본체는 있다. 없는 것은 ① 스냅샷을 안 남기는 변경 4종의 흔적, ② hard revert가 역사를 **지운다**는 것, ③ 그것들을 **참가자 한 명 단위로 시간축에 펴서 내려받는** 수단이다. 이 스펙은 그 셋을 채운다. 원칙은 하나 — **스냅샷 테이블이 진실이고, 이벤트는 스냅샷이 못 보는 것만 보탠다.** 이벤트를 두 번째 진실로 키우지 않는다.

## 1. 현재 상태 (2026-08-16 확인, 코드·DB 기준)

### 1.1 이미 남는 것

| 테이블 | 언제 | 무엇 |
|---|---|---|
| `score_config_versions` | intent 생성/수정/archive/restore, fold 적용, placement(move/reorder), ownership pins | **트리 전체 + pending pin 전체** 스냅샷 + `summary{action, intentIds, detail, minor, stats}` + `created_by` + `created_at`. `detail`에 `definition+rule · via feedback` 식 경로 태그 |
| `score_rule_versions` | 룰 저장마다 (`source ∈ direct/feedback/rewrite/manual/seed`, `minor`, `instruction`, `note`) | 룰 원문 |
| `score_intent_pins` | correction 추가/수정/삭제 | **현재 상태만** (`verdict, reason, source, status`) — 역사 없음 |
| `baseline_prompt_versions` | RULES 저장(`prompt_save`)·배포마다 | 프롬프트 전문 |
| `baseline_searches` | 필터 저장 | 정의 |
| `score_chat_deploys` | SCORE 배포마다 | 배포 스냅샷 |
| `study_events` | 라우트 30개 중 9개 | 실제 쌓인 타입: `intent_create, rating_run, revise_submit, prompt_deploy, prompt_save, search_run, search_save, set_add/remove, preview_generate, deploy` + 세션 관리(`phase_advance` 등) |
| `study_test_answers` / `study_survey_answers` | 블록 테스트·설문 | 타임스탬프 포함 |

### 1.2 구멍 (스펙이 채우는 것)

| # | 구멍 | 지금 남는 것 | 문제 |
|---|---|---|---|
| G1 | **pin(correction) 추가·은퇴·삭제** — `pins/route.ts` POST/PATCH(retire)/DELETE | 아무것도 없음. `add_pin`/`remove_pin` action이 `VersionSummary` 타입에는 있으나 **어떤 라우트도 기록하지 않음** — 라우트 주석이 명시한 설계다(fold가 소비할 때 버전이 남는다) | correction은 RQ1의 "correction과 이유"인데 시각·순서가 없다. 다음 스냅샷과의 diff로만 존재를 알 수 있고, 추가 후 삭제하면 흔적이 0 |
| G2 | **rule-versions apply / revert** | 룰 테이블은 바뀌지만 "되돌렸다"는 행위 기록 없음. **rule revert는 이후 룰 버전을 DELETE** | 되돌리기 전에 뭐가 있었는지 사라짐 |
| G3 | **intent hard revert** — `intents/[intentId]/revert` | 이후 `score_config_versions`를 **DELETE** | 동상. RQ1에선 되돌린 사실이 데이터인데 그 사실이 스스로를 지움 |
| G4 | **제안 API 4종** — `intent-suggestions`, `rewrite-intents`, `exclusion-reasons`, `refine` | 호출 기록 없음. 결과를 **채택하면** 다음 스냅샷의 `via` 태그로 간접 확인 가능하나, **거절**하면 흔적 0 | "생성 경로"(설계 §163)를 채택률 없이는 못 잰다 |
| G5 | **참가자별 다운로드** | 없음. `export-metrics.ts`는 전원 CSV 7개, `configuration.csv`는 최종 카운트 1행 | 궤적이 아니라 결과만 |

### 1.3 손대지 않는 것 (결정)

- **Baseline RULES 저장 사이의 편집 스트로크는 로깅하지 않는다.** 저장 단위 버전(`baseline_prompt_versions`)이 이미 있고, 그 사이는 화면 녹화가 맡는다. 더 촘촘히 넣으면 두 조건의 계측 밀도가 달라져 비교가 오염된다.
- ~~**읽기 행위(GET) 전반은 로깅하지 않는다.**~~ **2026-08-18 번복 (파일럿 1회차 반영).** 예외는 §2.4의 제안 API 4종뿐이었으나, JELSON 파일럿에서 이 결정이 가장 큰 구멍으로 드러났다 — "블록 1에서 reviewing을 손대지 않았다"는 말할 수 있어도 "reviewing을 읽기는 했는가"는 알 수 없었고, *안 봤다*와 *보고 만족했다*는 RQ1에서 다른 답이다. 이제 **공용 화면의 열람 행위는 로깅한다**(§2.6): type/intent 스코프 전환, 질문 열기, 워크벤치·fold 검토·배포 모달의 열기/닫기와 머문 시간. 두 조건이 같은 보드를 쓰므로 계측 밀도 파리티는 유지된다. **스크롤·호버·키스트로크는 계속 로깅하지 않는다** — 그쪽은 화면 녹화가 맡는다. 원칙은 "읽기를 안 남긴다"에서 **"시스템 안에서 일어나는 의미 있는 인터랙션은 남기고, 사용자의 신체적 행동은 녹화가 맡는다"**로 바뀌었다.
- **프롬프트 원문은 저장하지 않는다.** 제안 API 로그에는 결과 텍스트와 채택 여부만.
- **참가자 화면·UX는 바꾸지 않는다.** revert는 지금처럼 화면에서 사라지게 둔다. 살리는 건 연구 데이터뿐이다.

## 2. Step 1 — 이벤트 구멍 메우기 (파일럿 전 필수: 이벤트는 소급 불가)

모두 기존 `logStudyEvent(assignmentId, type, payload)` (`src/lib/study/events.ts`) 한 줄씩. 예외 없이 **mutation과 같은 트랜잭션 밖**에서, mutation 성공 후 호출한다 (`logStudyEvent`는 스스로 삼키므로 실패해도 본 동작을 깨지 않음). 각 payload에는 `intentId`를 반드시 넣는다 — Step 2가 이걸로 스냅샷 diff와 조인한다.

### 2.1 G1 — pins (`intents/[intentId]/pins/route.ts`)

이 라우트는 **의도적으로** 버전을 기록하지 않는다 (파일 상단 주석: "Labelling records no version either: the fold that consumes it does"). 그 결정은 그대로 두고 — correction은 프롬프트에 안 들어가므로 rating을 stale하게 만들지 않는다는 근거가 맞다 — 이벤트만 보탠다.

| 핸들러 | event_type | payload |
|---|---|---|
| POST (upsert, `onConflictDoUpdate`) | `pin_set` | `{ intentId, messageId, verdict, source, hasReason: boolean, replaced: boolean }` — `replaced` = 같은 (intent, message)에 pin이 이미 있었는가. 라우트는 지금 이걸 구분하지 않으므로 insert 전에 `select`로 확인한다 (행 1개, 인덱스 있음). `reason` 원문은 넣지 않는다 — pin 행에 남고 스냅샷에도 남는다 |
| PATCH (`{retireMessageIds}` — held correction 은퇴) | `pin_retire` | `{ intentId, messageIds: number[], count }` |
| DELETE `?messageId=` | `pin_remove` | `{ intentId, messageId, verdictWas: string }` — 라우트가 이미 `.returning({verdict})`로 받는다. 삭제는 스냅샷 어디에도 안 남으므로 verdict를 여기 보존 |
| DELETE `?all=1` | `pin_remove_all` | `{ intentId, count }` — `.returning`을 추가해 개수를 센다 |

### 2.2 G2 — rule versions

| 라우트 | event_type | payload |
|---|---|---|
| `rule-versions/route.ts` POST | `rule_save` | `{ intentId, versionNo, source, minor, chars, hasInstruction: boolean, anchorMessageId? }` |
| `rule-versions/[versionNo]/apply` POST | `rule_apply` | `{ intentId, versionNo }` |
| `rule-versions/[versionNo]/revert` POST | `rule_revert` | `{ intentId, toVersionNo, deletedVersions: [{versionNo, source, minor, rule, createdAt}] }` — **삭제 전에 읽어서 payload에 통째로 보존**. 룰 원문 포함 (룰은 참가자가 쓴 것이지 프롬프트가 아니다) |

### 2.3 G3 — intent hard revert (`intents/[intentId]/revert/route.ts`)

`revert` — `{ intentId, toVersionNo, deletedVersions: [{versionNo, createdAt, summary, snapshotIntent}] }`

- 라우트의 삭제는 지금 `.returning({ id })`만 받는다 — `versionNo, createdAt, summary, snapshot`까지 받도록 넓힌다 (같은 문장, 컬럼만 추가). `snapshotIntent`는 각 삭제 버전 스냅샷에서 **이 intent 한 건만** (`snapshot.intents.find(i => i.id === intentId)`) — 전체 스냅샷을 payload에 넣지 않는다 (크기; 다른 intent는 다른 버전에 그대로 있다). 삭제 조건이 `summary.intentIds == [intentId]`(이 intent 단독 버전만)이므로 그 한 건이 곧 그 버전의 전부다.
- 이 라우트는 이미 `action: 'revert'` config version을 기록하므로 스냅샷 쪽은 건드리지 않는다.

### 2.4 G4 — 제안 API 4종

공통 원칙: **응답 직전**에 로깅. LLM 실패(502)면 로깅하지 않는다. 결과 텍스트는 넣되 프롬프트·컨텍스트는 넣지 않는다.

| 라우트 | event_type | payload |
|---|---|---|
| `intent-suggestions` POST | `suggest_intents` | `{ count, suggestions: [{title, definition}] }` (라우트가 반환하는 `suggestions` 배열에서 title/definition만) |
| `intents/[intentId]/rewrite-intents` POST | `suggest_rewrite_intents` | `{ intentId, messageId, count, intents: [{title, definition}] }` |
| `intents/[intentId]/exclusion-reasons` POST | `suggest_reasons` | `{ intentId, messageId, verdict, count, reasons: string[] }` |
| `intents/[intentId]/refine` POST | `suggest_fold` | `{ intentId, correctionCount, proposalCount }` — 후보 definition 원문은 **넣지 않는다**: 채택되면 fold 라우트가 `update_intent` 스냅샷을 남기고, 거절되면 개수만으로 충분 |

**채택 여부는 별도로 로깅하지 않는다.** 채택은 후속 mutation(intent 생성/수정, pin 추가)이 스냅샷 또는 §2.1 이벤트로 남기며, Step 2가 **시간 인접성**(제안 이벤트 뒤 60초 이내의 같은 intent 대상 mutation)으로 `adopted` 컬럼을 파생한다. 클라이언트에 "어느 제안을 골랐는지" 신호를 추가하려면 5개 컴포넌트를 건드려야 하고, 그 정확도 이득이 파일럿 전 리스크를 정당화하지 못한다. 파일럿 후 필요하면 §7-Q3.

### 2.5 검증 (Step 1)

`scripts/study/check-trail-events.ts` (신규): 데모 clone 하나에서 pin POST→PATCH(retire)→DELETE, rule save→apply→revert, intent revert, 제안 4종을 순서대로 호출하고 `study_events`에 기대 타입이 **정확히 그 순서로** 쌓였는지, revert payload에 삭제된 버전이 들어 있는지 assert. 기존 `check-measure.ts` 스타일(✓/✗ 출력, 끝에 cleanup).

## 2.6 파일럿 1회차 이후 추가된 계측 (2026-08-18)

JELSON 파일럿(`reports/JELSON/analysis.md`)에서 분석에 필요한데 export에 없어 DB를 직접 파야 했던 것들. 전부 구현 완료.

| 무엇 | 어디 | 왜 |
|---|---|---|
| **열람 행위** — `scope_view`/`scope_leave`, `query_open`/`query_close`, `intent_open`/`close`, `rule_open`/`close`, `fold_open`/`close`, `deploy_open`/`close` (닫을 때 `dwellMs`) | `src/lib/study/ui-log.ts` (클라이언트 큐) → `POST …/score/ui-events` (스터디 클론만, 이벤트 타입 화이트리스트) | §1.3 번복 사유 참조. 배치 전송이라 각 이벤트는 "얼마 전에 일어났는가"를 실어 보내고 서버가 자기 시계에서 빼서 `created_at`을 만든다 — flush 지연이 순서를 바꾸지 않게 |
| **fold 검토 머문 시간** | 위 `fold_open`/`fold_close` | 파일럿에서 fold 제안 14건 중 12건이 도착 **2~6초 만에** 수락됐다(800~1,100자 정의). 검토 모달이 안전장치로 설계됐는데 실제로 읽혔는지가 기록되지 않았다 |
| **pin_set에 reason 원문 + 출처 + 뒤집은 판정** (`reason`, `reasonSource{kind,index}`, `ratingOverruled`, `priorVerdict`) | `pins/route.ts` (+ 워크벤치가 `reasonSource`를 보냄) | `score_intent_pins`는 현재 상태만 들고 있어 재핀하면 이전 이유가 사라진다. `ratingOverruled`는 **교정**(clearly_out→in)과 **경계 확정**(probably_in→in)을 가른다 |
| **revise_submit에 피드백 원문** | `propose/route.ts`, `baseline/revise/route.ts` | 파일럿 분석에서 가장 유용했던 데이터. 거절된 제안은 rule 버전을 남기지 않으므로 이벤트가 유일한 기록 |
| **suggest_fold에 제안 정의·시도 횟수·검증 결과** / 새 **`fold_apply`** (적용된 정의, 편집 여부) | `refine/route.ts`, `fold/route.ts` | 둘을 짝지으면 "제안대로 수락 / 고쳐서 수락 / 안 읽고 수락"이 갈린다. `attempts`는 fold 루프가 판정기를 통과시키려 몇 번 다시 썼는지 — **과잉구체화의 기제** |
| **rating_run에 소속 델타** (`membership[]`, `flips`) | `rate/route.ts` (`membershipSnapshot` 전후 비교) | 파일럿에서 재판정 12회에 부수 flip 43건·핀 회귀 4건. 손으로 판정 이력을 파야 나왔던 표가 이제 이벤트에 있다 |
| **search_run에 검색어** | `probe/route.ts` | baseline에서 자연어 검색은 열람이 아니라 **의도의 표명**이다 — SCORE의 intent 정의와 같은 행위. hash는 되읽을 수 없다 |
| **deploy에 커버리지** (rule 없는 intent 목록, type rule 수) | `deploy/route.ts`; 타임라인은 **스냅샷에서 계산**하므로 과거 세션에도 적용된다 | rule 없는 intent는 시스템 프롬프트 없이 답한다. 파일럿은 intent 7개 중 4개만 rule을 가진 채 배포됐다 |
| **라우팅 후보 전체** (`applied.candidates`) | `deploy-store.ts` | 지목이 빗나갔을 때 "간발의 차"인지 "애초에 후보가 아니었는지"를 가른다 |
| **블록 테스트 단계별 소요 시간** (`study_test_answers.timing`) + **`test_reveal`** 이벤트 | `BlockTest.tsx` → `session/test/route.ts` → `measure-store.ts` | 예측 3요소가 Next 한 번에 저장돼 서버는 단계를 볼 수 없다. **포인팅에 걸린 시간**(`point`, `pointFirst`, `pointChanges`)이 핵심 — 설정을 *읽는* 단계 |

export도 함께 넓혔다: `timeline.csv`에 **질문 원문**(`message_text`), `block-test.csv`에 **실제 라우팅·응답·단계별 ms·포인팅 정오**, 새 파일 **`review-set.csv`**(커버리지의 분모).

---

## 3. Step 2 — 참가자 타임라인 빌더

### 3.1 모듈

`src/lib/study/trail.ts` — 신규. 하나의 진입점:

```ts
export async function buildParticipantTrail(participantId: string): Promise<ParticipantTrail>
```

```ts
export interface ParticipantTrail {
  participant: { number: string; cell: number; blockOrder: string[]; createdAt: string };
  blocks: TrailBlock[];          // 항상 2개 (block 1, 2), 시작 안 한 블록도 빈 채로
  events: TrailEvent[];          // 전체, 시간순
  snapshots: TrailSnapshot[];    // SCORE 블록의 config version 전문
  rules: TrailRuleVersion[];     // 두 조건 모두: SCORE score_rule_versions + Baseline baseline_prompt_versions
  final: { block: 1|2; condition; config: unknown }[];  // 마지막 배포본
}
```

### 3.2 `TrailEvent` — 정규화된 한 행

```ts
export interface TrailEvent {
  seq: number;              // 1부터, 시간순
  at: string;               // ISO
  tBlock: number | null;    // 해당 블록의 block*_work 진입 시각 기준 초 (블록 밖이면 null)
  block: 1 | 2 | null;
  condition: 'score' | 'baseline' | null;
  phase: string;            // 그 시각의 phase (phase_advance 이벤트로 재구성)
  source: 'snapshot' | 'event' | 'rule' | 'prompt' | 'deploy' | 'test' | 'survey' | 'session';
  kind: string;             // 아래 어휘
  intentId: number | null;
  intentTitle: string | null;   // 그 시각 스냅샷 기준
  messageId: number | null;
  detail: string | null;    // 사람이 읽는 한 줄
  payload: Record<string, unknown> | null;   // 원문 (JSONL에만; CSV는 detail까지)
}
```

**`kind` 어휘 (닫힌 목록 — 여기 없는 값을 만들지 않는다):**

| source | kind | 유도 원천 |
|---|---|---|
| snapshot | `intent_create` · `intent_update_definition` · `intent_update_rule` · `intent_update_title` · `intent_archive` · `intent_restore` · `intent_move` · `intent_reorder` · `intent_fold` · `intent_revert` · `pins_changed` | `score_config_versions` N vs N-1 diff (§3.3) |
| event | `pin_set` · `pin_retire` · `pin_remove` · `pin_remove_all` · `rule_apply` · `rule_revert` · `suggest_intents` · `suggest_rewrite_intents` · `suggest_reasons` · `suggest_fold` · `rating_run` · `search_run` · `search_save` · `set_add` · `set_remove` · `preview_generate` · `revise_submit` | `study_events` (타입명 그대로) |
| rule | `rule_save` | `score_rule_versions` (이벤트가 아니라 **테이블**에서 — 이벤트는 §2.2 이후에만 있으므로, 테이블이 완전한 원천) |
| prompt | `prompt_save` · `prompt_deploy` | `baseline_prompt_versions` (`deployedAt` 유무) |
| deploy | `deploy` | `score_chat_deploys` |
| test | `test_predict` · `test_reveal`* · `test_rate` · `test_probe` | `study_test_answers` (`guessedAt`/`ratedAt`; *reveal은 시각이 없으므로 **생략** — §7-Q1) |
| survey | `survey_answer` | `study_survey_answers` |
| session | `phase_advance` · `phase_forced` · `phase_advance_refused` · `clone_reset` · `cell_assigned` · `login` | `study_events` + `study_participants.lastLoginAt` |

### 3.3 스냅샷 diff 규칙

`score_config_versions`를 `version_no` 순으로 읽어 인접 쌍을 비교한다. **한 버전에서 여러 kind가 나올 수 있다** — 각각 별도 `TrailEvent`, 같은 `at`, `seq` 연속.

| 관찰 | kind | detail |
|---|---|---|
| intent id가 N-1에 없고 N에 있음 | `intent_create` | `title` + `via …` (summary.detail에서) |
| `definition` 변경 | `intent_update_definition` | `Δchars=+12` + `via …` |
| `rule` 변경 | `intent_update_rule` | 동상 |
| `title` 변경 (definition 불변) | `intent_update_title` | |
| `archived` false→true / true→false | `intent_archive` / `intent_restore` | |
| `parentIntentId` 변경 | `intent_move` | `from → to` (title) |
| `position` 변경 (parent 불변) | `intent_reorder` | |
| summary.action == `update_intent` **and** summary.detail에 `fold` **or** 라우트가 fold | `intent_fold` | (definition diff보다 우선) |
| summary.action == `revert` | `intent_revert` | `to v{n}` |
| pins 배열 diff (추가/제거/verdict 변경) | `pins_changed` | `+2 −1` — **§2.1 이벤트가 있는 기간에는 중복이므로**, 같은 intent에 대해 ±5초 안에 `pin_*` 이벤트가 있으면 **생략** |

`summary.action`을 우선 신뢰하고, diff는 그것을 **세분화**하는 데 쓴다 (`update_intent` → definition/rule/title 중 무엇). action과 diff가 모순이면 (예: action=update인데 diff가 없음 = minor Apply) `intent_update_*` 대신 `intent_apply`를 낸다 — 이 kind만 예외로 위 표 밖에서 추가한다.

### 3.4 `adopted` 파생 (§2.4의 대가)

`suggest_*` 이벤트 각각에 대해, **같은 intentId**(intent-suggestions는 intent 없음 → 임의 intent) 대상의 다음 mutation이 **60초 이내**에 있으면 payload에 `adopted: true, adoptedBy: <seq>`, 없으면 `adopted: false`. 이건 근사값이다 — export 컬럼명을 `adopted_within_60s`로 두어 근사임을 이름에 남긴다.

### 3.5 `tBlock`·`phase` 재구성

`study_events`의 `phase_advance`/`phase_forced`(payload `{from, to}`)를 시간순으로 걸어 각 시각의 phase를 정한다. `block1_work` 진입 시각 = 블록 1의 t=0, `block2_work` 진입 = 블록 2의 t=0. 진입 이벤트가 없으면(콘솔로 강제 이동 등) 해당 블록의 첫 mutation 시각을 t=0으로 쓰고 `blocks[i].tZeroSource = 'first_action'`으로 표시.

## 4. Step 3 — 다운로드

### 4.1 라우트

`GET /api/study/admin/participants/trail?participantId=…&format=zip|json`

- 인증: `getInstructor` + `isAdministrator` (기존 `predictions/route.ts`와 동일).
- `format=json` → `ParticipantTrail` 그대로 (디버깅·프로그램용).
- `format=zip` (기본) → 아래 구조. zip 컨테이너는 Node 24의 `node:zlib`에 없으므로 **`fflate`**(무의존·~8KB, `zipSync`)를 dependency로 추가한다 — 이 스펙이 허용하는 유일한 새 의존성. `archiver`·`jszip`은 쓰지 않는다(무겁고 스트림 API가 라우트 핸들러에 안 맞음). 메모리에서 만들어 한 번에 응답 — 참가자 한 명의 trail은 수 MB를 넘지 않는다(스냅샷 ~30개 × 수십 KB).

```
P07/
  README.txt              ← 컬럼 설명 + kind 어휘 (이 스펙 §3.2 표를 그대로)
  timeline.csv            ← TrailEvent에서 payload 제외 (seq, at, t_block, block, condition, phase, source, kind, intent_id, intent_title, message_id, detail)
  timeline.jsonl          ← TrailEvent 전체 (payload 포함), 한 줄에 하나
  blocks.json             ← blocks[] (조건·데이터셋·t0·소요)
  snapshots/
    block1/v001.json … vNNN.json     ← SCORE 블록만. Baseline 블록 디렉토리는 만들지 않음
  rules/
    block1/score-intent-<id>-v<n>.txt   ← score_rule_versions 원문 (SCORE)
    block2/rules-v<n>.txt               ← baseline_prompt_versions 원문 (Baseline)
  final/
    block1-config.json    ← 마지막 score_chat_deploys 스냅샷 / 마지막 deployed prompt
    block2-config.json
  block-test.csv          ← 이 참가자 행만, export-metrics의 block_test.csv와 **동일 컬럼**
  survey.csv              ← 동상
```

CSV 직렬화는 `export-metrics.ts`의 `write()`가 쓰는 escape 함수를 **추출해서 공유**한다 (`src/lib/study/csv.ts` 신규, 두 곳이 import). 두 벌 두지 않는다.

### 4.2 콘솔 버튼

`SessionConsole.tsx` 참가자 행, `link` 버튼 옆에 **`trail`** (Download 아이콘). `<a href=".../trail?participantId=…" download>` — 별도 fetch 없음. `not_started` 행에도 보인다 (빈 trail이 내려오는 게 맞다 — 세션 전 상태 확인용).

### 4.3 전원 export

`scripts/study/export-metrics.ts`에 `trails/<number>/` 디렉토리 추가 — §4.1의 zip 내용물을 **풀어서** 파일로 쓴다 (zip 아님). 기존 7개 CSV는 그대로. `buildParticipantTrail`을 호출하므로 로직은 한 곳.

## 5. Step 4 — 검증

1. **단위**: `scripts/study/check-trail.ts` — 데모 SCORE clone에서 (a) intent 생성 → definition 수정 → 룰 저장 → pin 추가 → fold → placement 이동 → revert 순으로 실제 API 호출, (b) `buildParticipantTrail` 실행, (c) `events[]`의 kind 시퀀스가 정확히 `intent_create, intent_update_definition, rule_save, pin_set, intent_fold, intent_move, intent_revert`인지, `intent_revert.payload.deletedVersions.length ≥ 1`인지, 모든 이벤트에 `tBlock ≥ 0`인지 assert. Baseline clone에서 `prompt_save × 2 → prompt_deploy` 시퀀스 assert.
2. **통합**: 데모 계정으로 세션 한 블록을 실제로 돌리고(콘솔 Run demo), zip을 내려받아 `timeline.csv`를 화면 녹화와 **나란히** 읽는다 — 순서·간격이 맞는가. 스냅샷 diff가 놓치는 조작이 있으면 여기서 드러난다. 이 단계의 발견은 §3.3 표에 행을 **추가**하는 것으로 반영한다(어휘를 바꾸지 않고).
3. **회귀**: `check-session-walkthrough.ts`가 여전히 통과 (Step 1이 라우트 응답을 바꾸지 않았음을 확인).

## 6. 순서·규모

| Step | 내용 | 규모 | 언제 |
|---|---|---|---|
| 1 | 이벤트 10개 지점 + 검증 스크립트 | ~½일 | **파일럿 전** |
| 2 | `trail.ts` (diff·병합·파생) | ~1일 | 파일럿 후 가능 (데이터는 이미 쌓임) |
| 3 | 라우트 + zip + 콘솔 버튼 + export 확장 | ~½일 | 〃 |
| 4 | 검증 2종 | ~½일 | Step 2·3 직후 |

커밋은 Step 단위로 4개. Step 1은 라우트 파일 10개를 건드리므로 하나의 커밋으로 묶되, 커밋 메시지에 event_type 표(§2)를 넣는다.

## 7. 열린 질문 (Opus가 결정하지 말고 되물을 것)

- **Q1. `test_reveal` 시각.** 지금 "Show the actual response" 클릭은 서버에 안 간다(클라이언트 state). 타임라인에 공개 시각을 넣으려면 `study_test_answers.revealed_at` 컬럼 + `action:'reveal'` POST가 필요하다 (~30분). 예측→공개 사이의 지연이 분석에 필요한가? 필요 없으면 생략(현재 스펙 기본값).
- **Q2. `rating_run` 이벤트의 `intentIds`.** 지금 payload에 `intentIds` 배열이 통째로 들어간다(최대 40개). trail에서는 개수만 쓰면 되는데, 원 이벤트를 줄일지(과거 데이터와 형식이 달라짐) 그대로 둘지.
- **Q3. 제안 채택의 정확한 기록.** §2.4는 60초 인접성 근사다. 파일럿에서 근사가 틀리는 사례가 보이면 클라이언트 신호(`provenance.suggestionIndex`)를 추가한다 — 그때 결정.

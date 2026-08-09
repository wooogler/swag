# SCORE & Baseline — 통합 설계 문서 (as-built)

**작성:** 2026-08-05 · **기준:** `score-v7` 브랜치 working tree (코드가 진실, 문서는 그 기록) · **대상 독자:** 연구자 본인, 어드바이저, 후속 구현 세션

> **이 문서가 대체하는 것**: `STUDY_BASELINE_SPEC.md`(원 스펙 + S-6a~e 패치 누적), `SCORE_v7_intent_tree_design.md`(설계 초안 — 구현 완료·일부 개정됨), `SCORE_v7_implementation_plan.md`(실행 기록), `RULE_WORKBENCH_V2_PLAN.md`(실행 완료·일부 결정 번복됨). 각 문서는 결정의 **이유**를 담은 사료로 남기되, "지금 무엇이 어떻게 동작하는가"는 이 문서가 기준이다. §12에 문서별 지위 표.

---

## 0. 연구 프레임

**스터디**: within-subject, 2조건(SCORE vs Baseline) × 2데이터셋(swag, nirvana), 참가자별 카운터밸런스. Baseline은 SCORE의 **ablation**이다 — 제거되는 것은 "로그-근거 구조화 설정(log-grounded structured config)" 패키지 하나이고, 나머지는 전부 패리티를 유지한다.

원칙 (우선순위 순):

1. **Claim 격리** — 두 조건은 "구조화(intent/rule 객체 + 상시 커버리지 + 국소 수정 타깃)"에서만 달라야 한다. AI 능력(judge, 수정 에이전트, 프리뷰, 생성 제안)은 양쪽 동등.
2. **셸 패리티** — 같은 페이지·워크벤치·모달 셸을 재사용하고 세부만 교체한다. 두 조건은 "같은 제품의 기능 티어 차이"로 보여야 한다 (demand effect 통제). 없는 기능은 **부재(빈 자리)**로 읽혀야지 다른 도구로 읽히면 안 된다.
3. **비-strawman** — Baseline은 2026 상용 표준(모놀리식 instructions + 로그 열람 + coarse 버전) 이상이어야 한다.
4. **한 문장 방어** — *"Baseline은 저장 가능한 필터를 가진다; SCORE는 필터가 아니라 설정 객체를 가진다 — 카테고리가 rule을 소유하고, 커버리지가 로그 위에 상시 표시되며, 경계 교정(correction→fold)으로 판정을 다듬는다."*

**조건 간 차이의 전체 목록** (이것 외에는 동일해야 하며, 동일함이 검증되어 있다 — §6):

| 축 | SCORE | Baseline |
|---|---|---|
| 조직 객체 | **Intent** = rule을 소유하는 집합. 중첩·first-match·배타 소유 | **Filter** = inert한 저장 검색. 겹침 허용, 아무것도 소유하지 않음 |
| Rule | intent별 + 타입별 else rule (트리 전체가 라우팅) | **하나의 Rules 문서** (모든 질문에 동일 적용) |
| 커버리지 | 보드 상시: 트리 카운트, 스코프별 Uncategorized, shadowing/containment 진단 | 없음 (필터 카운트는 단순 검색 결과 수) |
| 경계 교정 | correction(in/out/send-here) → **fold**로 definition에 흡수 | 없음 |
| 검토 세트 시드 | Revise 진입 시 edge-case 3개 **자동 시드** | anchor 1개에서 시작 (수동 경로는 전부 공용 — §6) |
| 버전 | intent config 버전 + rule 버전(minor/major) + chat deploy 스냅샷 | rule 버전(공용 기계) + coarse prompt 버전(배포 단위만) |

---

## 1. 공용 기반 (두 조건이 그대로 공유하는 기계)

### 1.1 데이터: 로그와 그 파생물

- **로그** = 한 assignment의 학생↔챗봇 대화 전체 (`chat_conversations`/`chat_messages` + `student_sessions`). swag 507 user 메시지, nirvana 348.
- **Dissection** (Material/Request 분리) — **LLM 없음, 결정론적**. 에디터 이벤트 로그의 붙여넣기 기록 + 원문 대조(과제 프롬프트/초안/직전 봇 응답)로 각 메시지를 "자료 스팬 + 요청 스팬"으로 분해 (`dissect.ts`, `DISSECTION_VERSION=5`). judge·type 분류기의 프롬프트에 권위적 steer로 들어가고, UI의 자료 태그를 그린다.
- **Type 분류** — 모든 user 메시지를 Planning / Translating / Reviewing / Drafting 4개 중 정확히 하나로 (`score_query_types`, 메시지당 평생 1회, `TYPE_CLASSIFIER_VERSION=2`만이 무효화). 'Other' 없음 — 잡담도 가장 가까운 타입으로 강제. 평가: 인간 라벨 대비 **79.5% / κ0.708** (구 Classifier A와 동급), 재현성 20/20 무결점, drafting recall v1→v2에서 49%→82% (`SCORE_v7_type_eval.md`). **양 조건 모두 마스터에서 복사된 동일한 분류를 본다** — 좌측 4개 타입 섹션의 숫자가 조건 간 같은 이유.
- **Embeddings** — 메시지당 1벡터 (`score_query_embeddings`, `text-embedding-3-small`, 캐시 태그 `#matph-v2`). "Most different" 정렬, pin 유사도 정렬, edge-case 스윕의 재료. LLM-프리 경로.
- **Conversation digest** — 프리뷰 인프라. 스레드 전체 재생 대신 ≤250단어 rule-독립 브리프(참조 텍스트는 학생의 작업 초안으로 재귀속, 챗봇 목소리는 제거). 도입 근거: 원문 재생은 구-rule 산문을 모델이 흉내내게 만들었다("transcript가 system prompt를 이긴다"). 앵커당 1행 캐시 (`score_conversation_digests`).

### 1.2 Judge (5-level rating)

하나의 판정기가 세 소비자를 먹인다:

| 소비자 | 무엇 | 캐시 |
|---|---|---|
| SCORE intent 판정 | intent definition별 5-level (`clearly_in…clearly_out`; `unsure`는 emit 중단) | `score_intent_ratings`, unique **(message, intent, defHash)** |
| Baseline probe | 같은 기계, 합성 intent 1개로 definition 텍스트만 판정. **clearly_in만 노출**(등급 은닉이 ablation 경계) | `score_probe_ratings`, unique (assignment, defHash, message) |
| 라이브 라우팅 | 배포 스냅샷의 모든 judged set을 학생 메시지 1건에 대해 한 call로 | 캐시 없음 (아래 §2.6) |

- `defHash = stableHash(['r4', definition])` — **definition 텍스트만**. 트리 위치·순서·pin은 절대 해시에 안 들어간다 → 재배치·재정렬·교정 기록은 LLM 비용 0. `INTENT_RATING_VERSION=4`.
- intent와 probe가 **같은 defHash 키공간**을 쓴다: 같은 텍스트면 같은 판정 — "custom filter와 real intent는 같은 verdict를 낸다"가 패리티의 근거.
- typed intent는 **자기 타입의 쿼리에 대해서만** 판정된다 (cross-type 누수는 설계상 진단 불가 — 타입 분류기 신뢰에 베팅, §6.1 재평가가 담보).

### 1.3 모델 배치

| 역할 | env | 기본값 |
|---|---|---|
| rating / type / digest / propose / reasons | `SCORE_RATING_MODEL` | `gpt-5.4-mini` (rating·type은 effort `low`, propose는 `medium`) |
| fold(refine) + intent-suggestions | `SCORE_REFINE_MODEL` | `gpt-5.4` (fold는 effort `high`) |
| auto-title | `SCORE_TITLE_MODEL` | `gpt-5.4-nano` |
| 학생 챗 + **모든** 응답 프리뷰 (학생 경험 패리티) | `OPENAI_MODEL` | `gpt-4o` (reasoning 파라미터 없음) |
| embeddings | `SCORE_EMBEDDING_MODEL` | `text-embedding-3-small` |

동시성: 공용 슬롯 리미터 `SCORE_LLM_CONCURRENCY`(기본 64, cap 128).

### 1.4 조건 불문 공용인 AI 표면 (문자 그대로 같은 코드)

- **생성 chooser 본문** `candidate-chooser.tsx` — 조건 분기 금지 계약. 세 시드 그룹: ① From this question (같은 `intent-suggestions` 라우트, 3-고도 후보: Specific/Broader/Reframed) ② Starter {intents|filters} · {Type} (Jelson subtype을 앵커로 랭킹, LLM 없음) ③ Start from scratch. 준비된 템플릿과 **텍스트가 일치**하면 ⚡ "questions appear immediately".
- **수정 에이전트** — `…/intents/{id}/propose` 하나가 세 스코프를 서빙 (`ProposeScope: intent | type-root | prompt`, `intent.kind`에서 유도). 3강도 사다리(minimal/moderate/aggressive = 현재 프롬프트를 얼마나 건드리나), 빈 rule이면 **스코프 사다리**로 붕괴. rewrite 모드는 의도 확인 단계("Propose with N changes") 경유.
- **응답 프리뷰** — `…/score/preview` (챗 모델, digest 컨텍스트, 저장 rule은 `score_rule_previews` 캐시·draft는 비캐시). Baseline의 Revise도 이 공용 경로를 쓴다 (전용 `baseline/preview`는 고아 — §11).
- **merged cross-query Preview** `RuleApplyPreview` — rule이 답하는 다른 질문들의 before(배포본)/after(작업본) 비교 + 검색 + "Most different" 정렬 + **체크박스 pull-in**. 세 variant 전부 동일 (S-6e).

---

## 2. SCORE 조건 (treatment)

### 2.1 한 줄 모델

> **트리는 저작 모델, 런타임은 타입별 first-match 체인(후위 DFS 컴파일: 자식 먼저·부모는 else·형제는 조절 가능한 생성 순), 판정은 노드별 독립 + 해시 캐시, 트리/순서는 read-time에만 적용.** 모든 쿼리는 구조적으로 정확히 하나의 rule에 떨어진다 — overlap은 해소 대상이 아니라 발생 불가능한 상태다.

v6가 이것으로 대체된 이유: 독립 분류기 × 전체 로그는 overlap을 구조적으로 만들었고, 그 해소 기계(boundary 큐, exception links, Decide Ownership — 약 1,100~1,200줄)가 복잡도의 주범이었으며, 배포 후 boundary 판정 쿼리는 조용히 base prompt를 받았다. v7에서 그 전부가 소멸했다.

### 2.2 행의 세 종류 (`score_intents.kind`)

| kind | 무엇 | 판정? | 라우팅? |
|---|---|---|---|
| `intent` | 인스트럭터가 만드는 집합. definition(When) + rule(Then) 소유 | O (자기 타입 쿼리만) | 체인 멤버 |
| `type_root` | 타입의 최종 else. definition 없음(분류기가 곧 조건), rule은 assignment base prompt에서 시드 | **X** | 체인의 끝 (fallback) |
| `prompt_holder` | **Baseline 전용** 모놀리식 rules 컨테이너 (§3.5) | X | X |

Type root 4개는 SCORE **뷰** 진입 시 lazy 생성(`ensureTypeRoots`) — baseline **뷰**는 절대 생성하지 않는다. (주의: PHASE 1에서는 baseline 클론도 `?view=score`로 열면 root가 생긴다 — 게이트는 클론의 condition이 아니라 해석된 뷰다. "baseline 클론 데이터에 type_root가 없다"는 가정은 PHASE 2 이후에만 안전.)

### 2.3 라우팅과 그 진단

- `compileChains`: 타입별 후위 DFS — `T{A{B}, D{E}} → [B, A, E, D, T-else]`. 형제 순서 키 `(position ?? id, id)`. 열화는 전부 total(고장난 트리가 intent를 조용히 죽이지 않는다).
- `resolveRoute` + **포함 보장**: subset은 **모든 상위 집합이 clearly_in인 쿼리만** 가져갈 수 있다(판정은 독립, 라우팅에서 교집합) → `자식 ⊆ 부모` 항상 성립, 자식을 추가해도 부모 카운트 불변.
- 그 대가는 숨기지 않고 진단으로 띄운다: **↗ N** = 부모 밖 매치(containment가 차단 — 부모를 넓히거나 꺼내라), **⚠ N** = **shadowing**(앞선 형제가 이 intent의 매치를 선점 — v6 Overlaps 큐의 후계자; first-match에서 overlap은 사라지는 게 아니라 *침묵*하므로 이 진단이 없으면 건강한 좁은 intent와 구별 불가). 둘 다 라우터와 같은 walk에서 파생되어 라우팅과 어긋날 수 없다.
- **Pin은 더 이상 판정 오버라이드가 아니다** (설계 §3.6에서 개정됨): pin = **일시적 correction** (pending → "Update definition"으로 definition에 fold → consumed, 표시 마커로만 잔존). 프롬프트에도 해시에도 안 들어간다. 보드 라우팅은 raw rating만 쓴다 — 보드는 배포된 챗봇(definition만으로 라우팅)을 거울처럼 비춰야 하기 때문. "이 쿼리를 여기로"(send here)는 타깃에 in-correction + 앞선 가로채는 노드들에 out-correction을 한 트랜잭션으로 기록하는 복합 액션.

### 2.4 Rule 축 (one-layer)

- **Rule = 그 intent의 완결된 system prompt 하나** (2026-07-28 one-layer 결정). 레이어 합성 없음, **base prompt 개념 소멸** — 시드·fallback 역할은 type root의 rule이 전부 흡수. 매치된 rule이 시스템 프롬프트의 전부다; 빈 rule = 시스템 메시지 없음.
- **copy-on-create 시드**: 새 intent의 rule은 감싸는 집합의(비어 있으면 조상의, 최종적으로 type root의) rule 복사본에서 시작. live 상속은 없다(숨은 레이어의 부활이므로). 보드의 `RuleOrigin` 칩("own rule" vs "same as {scope}")이 분화 여부를 말한다.
- **버전 3축이 의도적으로 분리**되어 있다:
  1. **Intent config 버전** — 모든 config 변경마다 전체 스냅샷. v7의 move/reorder도 MAJOR(LLM 비용 0이지만 어느 rule을 받는지가 바뀌므로). checkout(읽기 전용) / revert(정의+부모+위치 복원).
  2. **Rule 버전** (intent별) — `seed`(생성 시 v1 기록; 기록 자체는 live rule을 덮지 않는 유일한 소스지만, copy-on-create 시드가 **곧** live rule이므로 한 번도 수정하지 않은 intent를 배포하면 학생은 v1 시드 rule을 받는다) / **minor** = **Try**(시뮬레이션, live 불변) / **major** = **Apply**(live rule 반영). 번호 v2, v2.1, … 각 버전이 앵커 응답을 저장해 checkout에 재생성 불필요.
  3. **Chat deploy 스냅샷** — 활성·typed·judged 세트 + 4 root를 통째로 동결(append-only, ≤40 judged set — 런타임이 한 call로 판정하므로 초과는 배포 거부). 학생은 항상 최신 스냅샷을 받는다.

### 2.5 Try / Apply 어휘 (라이브 경계의 한 동사)

두 워크벤치가 같은 언어를 쓴다: **Try = 시뮬레이션**(definition을 판정해 보거나, rule 편집으로 응답을 재생성 — minor 기록, 학생 영향 없음), **Apply = 커밋**(definition을 major 버전으로 / rule을 live로). "Save"는 사용자 표면에서 사라졌다. Deploy만이 학생에게 도달하는 별도 단계다.

### 2.6 학생 런타임

`/api/chat`: baseline 클론은 분류 없이 배포된 Rules 문서로 즉시 분기. SCORE는 최신 deploy 스냅샷에 대해 **type 분류 ∥ 전 세트 판정을 병렬 호출**(15s/0-retry), `resolveRoute`로 first-match — 매치 rule이 시스템 프롬프트 전부, 체인 소진 시 type root rule. 모든 실패는 base prompt로 fail-open. 라이브 type 판정은 **의도적으로 캐시하지 않는다**(디섹션 steer 없는 약한 판정으로 인스트럭터 캐시를 오염시키지 않기 위해). 무엇이 응답을 라우팅했는지는 응답 메타데이터(`chatDeployVersion`, `appliedIntentId`, `appliedOutcome`)에 기록되어 보드 뷰어의 "chat vN" 칩과 배포 회고 보드를 먹인다.

### 2.7 UI (한 페이지, 전부 그리드 takeover)

**보드** (3열: 트리 | 질문 리스트 | 대화 뷰어):
- 좌: 4 타입 섹션(root 헤더 + 트리; 순서가 곧 평가 순서), 스코프별 *Uncategorized* 잔여, 진단 칩, hover ↑↓(answer earlier/later)·삭제(체인 재계산으로 "어디로 떨어지는지" 정확 미리보기), 점선 `+ New intent in {Type}` / `inside "{Set}"` — **버튼의 위치가 곧 배치 약속** (배치 피커 없음).
- 중: 선택 인스펙터(When/Then + Edit Intent / Edit Rule — Edit Rule의 anchor는 **체인이 실제 resolve한** 질문), 검색·정렬(PID↑ 기본 — 참가자 간 동일한 시작 화면).
- 우: 대화 뷰어 + rule-version 드롭다운("Original (as delivered)" / vN) + **Revise rule**(소유 intent 또는 type root로).

**생성**: 항상 chooser 경유 (§1.4). Create → IntentWorkbench가 시드로 열리며 **즉시 auto-Try**(빈 폼으로 열리지 않는다); 템플릿 시드는 rating까지 서버 클론되어 질문이 즉시 떠 있다.

**IntentWorkbench (When 편집)**: 좌 spec(Title/definition/corrections/History) | 중 **In this intent**(clearly_in; "Most out-like first" 기본 정렬 — 실수 후보 먼저; 버전 대비 membership diff ±N) | 우 **Needs decision**(probably in/out 탭). 행 컨트롤 in / **send here**(shadowed일 때만) / out; 판정과 어긋나는 교정은 **이유 피커**(LLM 후보 3 + 자유입력). "Update definition · N corrections" → **FoldReviewModal**(교정↔밑줄 스팬 검토 게이트) → fold가 교정을 definition에 흡수하고 전 판정을 stale로. 재-Try 후 마커 검증("✓ / ⚠ disagrees with your marks").

**RuleWorkbench (Then 편집)** — 세 타깃을 `variant: 'intent' | 'type-root' | 'prompt'`로 서빙하며, 분기는 variant 이름이 아니라 **세 축**을 묻는다: `authoredWhen`(작성된 When이 있나 — intent만), scoped(답하는 질문 집합이 열거 가능한가 — intent + type-root), `monolith`(복수형 Rules 문서 — baseline). 보드는 각 마운트에 **체인이 resolve한** 질문 집합을 건넨다(raw 멤버십이 아니라 — anti-shadowing).
- 좌: 읽기 전용 When(intent = definition; type root = `fixedWhen` "none of the sets inside {Type} capture" + 분류기 원문 접기; prompt = 없음) + Then 에디터 + **Try edit** / **Apply rule(s)**.
- 중: 질문 탭(앵커 ★ + 끌어온 예시) + **Other questions**(모든 variant의 유일한 문 → merged Preview) + 응답 pane(+ Rewrite instead, View in context, Quote in feedback).
- 우: **타임라인이 곧 버전 히스토리** — Starting rule/Applied 이벤트, 지시 원문, rule 블록은 전신 diff + 클릭=checkout. 피드백 입력 + 6-요소 Hint. propose → **ProposalPreviewModal**(Minimal edit / Focused rework / Full rewrite, 선택한 것만 minor 기록).
- **auto edge-case 시드는 intent variant 전용** (`farthest=3`) — 스터디의 검토-세트 유일 차이.

---

## 3. Baseline 조건 (control)

참가자가 보는 세계: **하나의 Rules 문서 + 타입별로 정리된 저장 필터들**. 같은 페이지가 `condition` prop으로 렌더된다 — 별도 앱이 아니다.

### 3.1 좌측: Rules 패널 + Filters 트리

- **Rules 패널** (고정, 읽기 전용): 현재 문서 + `v{N} live`/`not deployed` 칩. *"No rules yet — open a question and Revise to write them."* 편집은 Revise에서만, 배포는 헤더 Deploy에서만.
- **Filters 트리**: SCORE와 같은 4 타입 섹션(같은 분류, 같은 숫자), 그 아래 이 참가자의 저장 필터가 한 단계 중첩(같은 `renderBranch` 엘보 코드). 라벨 = name ‖ description, Badge = 캐시된 clearly-in ∩ 자기 타입. 점선 `+ New filter in {Type}`은 그 스코프가 선택됐을 때. 레거시 무타입 행은 "Ungrouped". **클릭은 리스트 필터링만**(ids가 GET에 실려와 0 호출) — 워크벤치는 생성 또는 Edit Filter로만.
- 트리가 미러하지 **않는** 것(= ablation 경계): 순서 의미·↑↓·2단계 중첩·스코프 잔여·rule·진단 — 필터는 겹칠 수 있고 아무것도 소유하지 않으므로.

### 3.2 Filter의 생명주기

1. **생성** — `+ New filter in {Type}` → 공용 chooser (헤더만 다르다: *"Finds every {Type} question matching this description."* — SCORE의 소유/선점 문장 자리에서 검색 의미론을 말한다. 이 한 문장이 ablation의 전부).
2. **FilterWorkbench** — IntentWorkbench의 3트랙 그리드에서 Needs-decision 트랙을 **빈 채로** 유지. Name + "When a question…" 에디터, **Run**(probe 루프) / **Save filter**. **applied 게이트**: Run하지 않은 텍스트는 저장 불가("Save stores what it collects" — 안 그러면 보드가 캐시에서 0을 읽는다). 재저장은 행 id로 in-place. 중간 pane은 "In this filter · N" + Newest/Oldest + 공용 PaneSearch + 대화 오버레이 — 표시가 자기 타입으로 스코프(probe 스윕 자체는 전 로그 — 캐시를 템플릿과 정렬 유지).
3. **즉시성** — starter 시드 필터가 열리자마자 결과가 차 있는 이유: probe의 **템플릿 시딩**. 텍스트의 defHash가 준비된 템플릿과 일치하면 그 템플릿의 메시지별 최신 판정을(해시 세대 불문 — 하니스 버전 bump는 텍스트를 안 바꾼다) probe 캐시로 복사. LLM 0회.

### 3.3 Rules 문서: prompt-holder 기제

모놀리식 프롬프트는 숨은 `score_intents` 행(`kind='prompt_holder'`, definition 없음)의 **rule**로 저장된다 — 그래서 SCORE의 rule-version 기계(v1 시드, Try minor, checkout, revert, Apply)가 **그대로** 재사용된다. Revise = RuleWorkbench `variant='prompt'`: When 없음, "Rules · vN", **Apply rules**(복수형), anchor 1개에서 시작(auto-seed 없음 — 유일 차이), Other questions → "Preview across the log". propose는 공용 라우트(`scope='prompt'`: "이 프롬프트는 모든 요청에 답하는 유일한 프롬프트다" — 스코핑 언어 금지 프레이밍).

### 3.4 배포와 런타임

**Deploy** 버튼(BaselineDeployButton, 버전 드롭다운 없음 — coarse가 설계) → holder의 현재 rule을 `baseline_prompt_versions`로 스냅샷 + `deployedAt`. 학생 챗은 분류를 완전히 우회하고 최신 배포 프롬프트를 서빙(fail-open은 base prompt).

### 3.5 Ablation 집행 목록 (코드가 강제하는 "없음")

① intent 트리/소유/체인 없음 ② 편집 가능한 타입 rule 없음(타입 인스펙터는 `!isBaseline` 게이트) ③ intent별 rule 없음 — 문서 하나 ④ pins/correction/Needs-decision/진단 칩 없음(셋째 트랙은 빈 자리) ⑤ 보드 Run 컨트롤 없음 ⑥ 검토 세트 auto-seed 없음 ⑦ 행의 intent 멤버십 칩·"Create an intent" 문구 없음 ⑧ 배포 버전 회고 보드 없음 ⑨ 등급 은닉(clearly_in 멤버십만).

참가자 표면에 "intent"라는 단어는 렌더되지 않는다 (에러 문구까지 중립화 — "Failed to draft candidates").

---

## 4. 생성 chooser — 패리티의 핵심 장치

한 컴포넌트(`candidate-chooser.tsx`), 두 래퍼. **다른 것은 헤더와 copy 문자열뿐** (렌더 diff 18줄 중 6줄, 전부 어휘):

| | NewIntentModal (SCORE) | NewFilterModal (Baseline) |
|---|---|---|
| 헤더 | 트리 경로(타입 dot → 부모 → 점선 칩) + 결과 문장 "Only questions '{parent}' already answers can land here" / "…no existing intent claims first" | 평평한 경로 + *"Finds every {Type} question matching this description."* |
| 명사 | intent / Title / Create intent / Starter intents | filter / Name / Create filter / Starter filters |
| Create 후 | IntentWorkbench (auto-Try 또는 템플릿 adopt=rating 클론) | FilterWorkbench (auto-Run; `fromTemplateId` 의도적 폐기 — probe 캐시가 같은 일을 한다) |

왜 이렇게까지: 생성 시점에 주어지는 지식(AI 후보·starter 제안)과 상호작용 비용이 조건 간 완전히 동일해야 "채택한 객체가 무엇을 할 수 있는가"만 남는다. 헤더의 두 문장은 각 조건의 메커니즘을 같은 자리에서 한 문장으로 말한다 — 소유 vs 수집.

---

## 5. 스터디 운영

### 5.1 참가자 흐름

`/study` → 번호 + 공유 passcode(`STUDY_PASSCODE`; IP당 12회/분 스로틀, timing-safe 비교) → find-or-create: instructor 계정 + 데이터셋별 클론 2개 → `/instructor/dashboard`(자기 보드 2개) → 보드. 로그아웃은 `/study`로 복귀. 셀프 리셋(`/api/study/reset`) = 재클론(새 assignment id).

### 5.2 조건 배정 (코드) + 순서 (런북)

`conditionForDataset`: 번호의 숫자부 홀짝 — **짝수 → swag=score·nirvana=baseline, 홀수 → 반대**. 클론 생성 시 `study_clones.condition`에 고정. 세션 순서는 진행자가 번호 발급으로 통제(4-cell).

### 5.3 PHASE 1 → 2

현재 PHASE 1: `?view=score|baseline`이 누구에게나 우선(UI 프리뷰 전용 — **학생 런타임은 phase 무관하게 저장된 condition에 잠겨 있다**). PHASE 2 전환 = `resolveStudioView`의 주석 한 줄 해제 + 개요 페이지 단일 `[Chatbot Studio]` 버튼 + 헤더 중립 명명(S-4). **스터디 시작 전 필수.**

### 5.4 클론이 복사하는 것

세션/대화/메시지 전부, `is_template` intent만(rule 비움) + 그 판정, dissection, **query type**(양 조건 동일 분류의 근원), embeddings, 구 분류층 데이터, 템플릿 pin·프리뷰. **복사 안 하는 것**: type root와 prompt-holder(클론별 lazy 생성), 버전·배포·probe 캐시·digest·이벤트(빈 상태에서 시작). 마스터 삭제 방지 가드 있음.

---

## 6. AI 패리티 대차대조표

| | SCORE | Baseline |
|---|---|---|
| **공용 (동일 코드)** | chooser + intent-suggestions + starter 랭킹 · propose(스코프 프레이밍만 다름) · rewrite-intents · 응답 프리뷰(같은 모델·같은 digest) · merged Preview(검색·Most different·pull-in) · type 분류(복사본) · embeddings · 대화 뷰어 · Try/Apply 어휘 | ← 동일 |
| **SCORE만** | rating run(Run/Apply) · pin 유사도 정렬 · fold + 이유 후보 · edge-case auto-seed · 라이브 intent 라우팅 · auto-title | — |
| **Baseline만** | — | probe(같은 judge, 합성 intent; clearly_in만 노출) |

검토-세트(Revise) 흐름의 조건 차이는 **auto-seed 하나**다. 이 경계는 두 번 잘못 그어졌다가 교정됐다: 코드 주석이 "blind picker가 ablation"이라 주장했으나 스펙 대조 결과 아니었다(S-6e). → **교훈: "ablation의 일부"라는 코드 주석은 인용이 아니라 스펙에 대조할 주장이다.**

---

## 7. 데이터 모델 (요약 카탈로그)

**코어**: instructors · assignments · student_sessions · editor_events · chat_conversations/messages.
**구 viewer 층** (태깅으로 강등, 데이터 유지): score_classifications · score_subtype_scores · score_config.
**Intent 층**: score_intents(kind/type/parent/position; type_root 부분 유니크) · score_intent_ratings(전 해시 세대 보존 → 즉시 checkout) · score_intent_pins(pending/consumed) · score_config_versions · score_rule_previews · score_conversation_digests · score_query_embeddings · score_dissections · score_query_types · score_chat_deploys · score_rule_versions(+responses).
**스터디/Baseline**: study_participants · study_clones(condition) · score_probe_ratings · baseline_searches(name·type — UI는 Filter, 서버는 search 유지) · baseline_prompt_versions · baseline_previews(고아) · review_set_items(**미사용** — 검토 세트는 워크벤치 탭으로 대체됨) · study_events.

전부 런타임 DDL(`ADD COLUMN IF NOT EXISTS` 패턴). FK 없는 테이블 다수 — 체인은 코드에서 컴파일.

---

## 8. 이벤트 카탈로그 (과정 지표의 원천, `study_events`)

**살아있는 이벤트** (서버 측에서만 적재):

| event | payload 요지 | 조건 |
|---|---|---|
| `search_run` | defHash, resultCount, remaining | baseline (probe 배치당 1회 — run당 1회가 아님에 유의) |
| `search_save` | searchId, defHash | baseline |
| `prompt_deploy` | versionNo | baseline |
| `revise_submit` | **condition(파생)**, scope, mode, intentId, anchor | **양쪽** (한때 'score' 하드코딩으로 baseline 수정이 전부 오귀속됐다 — S-6d에서 교정) |
| `deploy` / `intent_create` / `rating_run` | … | score |

**죽은 이벤트**(라우트만 존재): prompt_save, preview_generate, set_add/remove, 구 revise_submit. **스펙에만 있는 이벤트**: picker_open, revise_open, pin_add 등 8종 — 미구현. 분석 스크립트 작성 시 이 표를 기준으로 할 것; 구 스펙 §7 표는 신뢰 불가.

주의할 지표 의미론: 필터 클릭은 아무 이벤트도 안 남긴다(캐시 서빙); `search_run`은 워크벤치 Run의 배치 수를 센다; `intent_create`는 chooser Create마다 1회.

---

## 9. 결정 로그 (이유의 요약 — 상세 사료는 원 문서)

| 결정 | 요지 |
|---|---|
| **v6→v7** (08-01) | overlap 해소 기계를 지우기 위해 overlap을 구조적으로 불가능하게. 4-type 브라우징이 진입 경험. |
| **one-layer rule** (07-28) | rule = 완결된 시스템 프롬프트 하나. base prompt 소멸. copy-on-create, live 상속 금지. |
| **포함 보장 개정** (08-02) | 판정은 독립 유지, 라우팅에서만 교집합 — 중첩 UI의 약속(자식⊆부모)을 데이터가 지키게. 대가는 "부모 밖 N건" 진단으로 노출. |
| **Pin→correction** | 오버라이드는 배포 런타임과 보드의 불일치를 만든다. 교정은 fold를 거쳐 definition으로 — 가르침이 텍스트에 남는다. |
| **digest** (08-04) | 프리뷰의 원문 재생이 구-rule 산문을 이기게 만들던 문제 제거; propose의 중장비 프롬프트도 함께 삭제(11/1/0 준수 실측). |
| **Try/Apply** (08-04) | 라이브 경계의 동사를 두 워크벤치에서 통일. Save 소멸. |
| **S-6a→b** | starter 31종을 SCORE에서 제안으로 강등하자 baseline만 사전 계산된 세분류 지도를 갖게 됨 → claim 격리 위반. 무료 등급은 4 타입으로 통일, subtype은 공용 chooser 제안으로. |
| **S-6c** | Search→Filter 명명(클릭의 실제 동작), 좌측을 타입 트리로, `type` = 트리 자리 + 표시 스코프, FilterWorkbench 셸 통일, probe 템플릿 시딩. |
| **S-6d** | `promptMode` 불리언이 type root에 대조군 UI를 주고 있었다 → 3-way variant. 공유 컴포넌트의 조건 분기는 조건명이 아니라 **축**으로. propose 이벤트 오귀속 교정. |
| **S-6e** | 검토-세트 수동 경로 완전 통일(QueryPicker 삭제, merged Preview + 검색). 남은 차이 = auto-seed 하나. |

---

## 10. 알려진 부채 / 미완 (as of 2026-08-05)

**스터디 시작 전 필수**
- PHASE 2 격리 스위치 + 중립 명명(S-4) 미적용.
- 이벤트 커버리지가 스펙 의도보다 얇다(§8) — 분석 계획을 실제 표에 맞추거나 이벤트를 보강할 것.
- `scripts/study/replay-eval.ts`(회귀 co-primary) 미작성.

**고아 표면** (라우트/테이블은 있고 호출자 없음 — 삭제 또는 채택 결정 필요): `baseline/revise` · `baseline/preview`(+`baseline_previews` 쓰기 경로) · `baseline/versions` POST · `review-set` CRUD + `review_set_items` · `similar-log` · `resolveChatPromptFromSnapshot`. Test-chat은 **양 조건 모두 미구현**(비대칭은 없음).

**자잘한 결함**: teardown이 `score_conversation_digests`를 안 지운다(고아 행 잔존) · `IntentBoard`의 `charLimit` prop 사장 · stale 주석 몇 곳(IntentBoard 파일 docstring의 v6 서사, RuleApplyPreview의 "baseline은 체크박스 없음", RuleWorkbench의 blind-picker 서술, `schema.ts`의 구 해시 시그니처 주석 등 — 리포트에 위치 기록).

---

## 11. 어휘 사전 (참가자에게 보이는 문자열)

| 개념 | SCORE | Baseline |
|---|---|---|
| 객체 | intent / set | filter |
| 생성 | + New intent in {Type} · Create intent | + New filter in {Type} · Create filter |
| When 라벨 | 워크벤치 "When a student…" · chooser "When a question…" | 양쪽 다 "When a question…" (chooser는 공용이라 SCORE도 생성 시엔 이 라벨을 본다) |
| 시뮬레이션 | Try / Try edit | (Run) / Try edit |
| 커밋 | Apply / Apply rule | Save filter / Apply rules |
| 다른 질문 문 | Other questions | Other questions |
| 프리뷰 제목 | Preview across intent — {t} / across {Type} — questions no set claims | Preview across the log |
| 배포 | Deploy → chat vN+1 | Deploy ("Students receive vN") |
| 문서 | (rule per intent) | Rules |

---

## 12. 문서 지위 표

| 문서 | 지위 | 비고 |
|---|---|---|
| **이 문서** | **현행 기준** | as-built 서술; 코드와 어긋나면 코드가 이긴다 |
| STUDY_BASELINE_SPEC.md | 사료 (결정 이유 S-1~S-6e) | §3/B-1~B-6·§5.2~5.5·§7 다수가 코드와 불일치 — 개별 조항을 인용하지 말 것 |
| SCORE_v7_intent_tree_design.md | 사료 (v7 근거) | "구현 전" 헤더는 낡음; §3.6 pin 서술은 개정됨 |
| SCORE_v7_implementation_plan.md / RULE_WORKBENCH_V2_PLAN.md | 실행 기록 | 후자 §5는 S-6e로 번복 |
| SCORE_v7_type_eval.md · score-stability-report · classifierA eval | **증거 (현행)** | 인용용 수치의 원천 |
| GPTWriting_fewshot_classifier.md | **현행 참조** | Jelson taxonomy 원자료 — chooser 제안·구 분류층의 소스 |
| SCORE_v6_remaining_work.md · SCORE_viewer_spec.md | 대체됨 | viewer 층은 태깅으로 강등되어 데이터만 잔존 |

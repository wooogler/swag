# SCORE v6 — 남은 작업 (P4·P5 + 이월 항목)

> 기준 커밋: "SCORE v6: intent/rule layer (P0–P3)" (2026-07-05).
> 설계 원본: 사용자 제공 "System Design v6" 문서 (2026-07-03, 저장소 외부).
> 이 문서는 그 설계의 §번호를 그대로 인용한다.

---

## 0. 현재 구현 상태 (P0–P3 완료)

**오프라인 ORE 루프(Organize→Revise→Evaluate)는 전부 동작한다.** 미구현은
버전 히스토리 **UI**(P4 — 데이터는 이미 쌓임)와 **런타임 주입**(P5)뿐이다.

### 파일 지도

| 계층 | 파일 | 역할 |
|---|---|---|
| 모델(클라이언트 안전) | `src/lib/score/intents.ts` | 5단계 판정 타입, `intentDefHash`, **`resolveAssignment`(배타 배정)**, `applyPinOverrides`(핀=확정 판정), `boundaryKey` |
| 프롬프트 | `src/lib/score/intent-prompts.ts` | 판정 시스템 프롬프트 + strict json_schema 빌더 (preview=runtime용 클라이언트 안전) |
| 주입 | `src/lib/score/injection.ts` | **`buildInjectedSystemPrompt(base, rule)` — P5가 그대로 쓸 단일 지점**, `rulePreviewHash`, `getChatModel` |
| 분류기 | `src/lib/score/intent-classifier.ts` | 1콜 = 분절(Material/Request) + intent별 근거→판정 |
| 저장 | `src/lib/score/intent-store.ts` | 런타임 DDL(테이블 8개), CRUD, **`recordConfigVersion`(트랜잭션 내 전체 스냅샷)** |
| 프리뷰 | `src/lib/score/preview-service.ts` | 저장 rule=캐시(`score_rule_previews`) / draft=무캐시 생성 |
| 임베딩 | `src/lib/score/embeddings.ts` | text-embedding-3-small, 512청킹 배치, `score_query_embeddings` 캐시 |
| 공용 | `src/lib/score/{authz,limiter}.ts` | admin-or-owner 인증, LLM 동시성 풀 |
| API | `…/score/{intents,intents/[id],intents/[id]/{pins,ratings,propose,edgecases},links,rate,compare,ownership,preview}` | 전부 admin-or-owner + 변경 시 버전 스냅샷 |
| UI | `IntentBoard.tsx`(S1) / `NewIntentModal.tsx`(S3) / `DecideOwnershipModal.tsx`(S4) / `ReviseModal.tsx`(S2) | ScoreViewer는 모드 토글(Intents 기본 / "Jelson tags" = 강등된 구 뷰어, 둘 다 css-hidden으로 마운트 유지) |

### 핵심 불변식 (수정 시 반드시 유지)

1. **preview = runtime**: base prompt는 어디서나 `assignmentBasePrompt()`(assignment-ai.ts)로,
   주입은 `buildInjectedSystemPrompt()`로. `/api/chat`·compare·preview·스냅샷이 이미 공유 중.
2. **스테일니스 = 해시 비교**: 판정 행의 `def_hash` vs `intentDefHash(definition, selectPromptPins(pins))`.
   정의·핀이 바뀌면 자동 스테일 — 명시적 무효화 쓰기는 force 전용(`def_hash=''`).
3. **배정은 저장하지 않는다**: 항상 `applyPinOverrides` → `resolveAssignment`로 파생
   (클라이언트 IntentBoard, ratings/edgecases 라우트 셋 다 동일 로직 사용 중).
4. **모든 config 변경 = 같은 트랜잭션에서 `recordConfigVersion`** (mutation 후 호출).
5. 프롬프트 문구를 의미적으로 바꾸면 버전 상수 범프:
   `INTENT_RATING_VERSION`(판정) / `DISSECTION_VERSION`(분절) / `PREVIEW_VERSION`(주입 문구).

### 개발 환경 메모

- 테이블은 `ensureIntentTables()` 런타임 DDL로 자동 생성 (drizzle 저널은 0009에서 멈춰 있어 사용 안 함).
- 로컬: Postgres `postgresql://swag:swag@127.0.0.1:5432/swag`, dev 서버 `npm run dev` (포트 3030).
- API 수동 테스트: `user_session=<instructors.id>` 쿠키만 있으면 됨 (admin id는 `SELECT id FROM instructors WHERE role='administrator'`).
- **주의**: dev 서버 실행 중 `next build` 금지 — `.next` 캐시 충돌로 페이지 500. 빌드 후 `rm -rf .next && npm run dev`.
- 분류/판정 모델: `SCORE_MODELS`(gpt-5.4-mini/nano). 챗봇·프리뷰 모델: `OPENAI_MODEL` env (현재 gpt-5.4-mini).

---

## P4 — 버전 히스토리 UI + granular revert (§1.11)

데이터는 P1부터 완비: `score_config_versions`에 변경마다 전체 스냅샷
(`IntentConfigSnapshot` = intents/pins/links/프롬프트 버전/base prompt 참조) +
summary(`{action, intentIds, messageId?, detail}` — provenance 포함) + created_by.

### 할 일

1. **히스토리 API** — `GET …/score/versions?intentId=&limit=` → 버전 목록
   (versionNo, summary, createdBy, createdAt). intentId 필터 = summary.intentIds 포함 여부.
   상세 `GET …/score/versions/[no]` → snapshot (diff는 클라이언트에서 이전 버전과 비교 계산 — git처럼 읽을 때 계산, §7.5).
2. **Revert API** — `POST …/score/versions/[no]/revert`:
   한 트랜잭션에서 snapshot의 intents/pins/links로 현재 상태를 **덮어쓰고**
   (`archived` 복원 포함 — intent 행은 soft-delete라 id가 안정적) `recordConfigVersion(action:'revert', detail:'→ v{no}')`.
   - 구현 방식: snapshot 기준으로 upsert + snapshot에 없는 행 삭제(pins/links) / intents는 필드 덮어쓰기 + 없는 id는 archived=true.
   - revert 후 판정 스테일니스는 해시 비교로 자동 처리(불변식 2) — 별도 무효화 불필요.
   - **granular revert**(특정 변경 1건만 되돌리기)는 v6에 있지만 1차는 "해당 버전 전체로 복원"만으로 충분. granular은 summary의 intentIds로 스냅샷을 부분 적용하면 됨(후속).
3. **UI** — IntentBoard 컨트롤 바의 `v{N}` 배지를 클릭 → 히스토리 모달:
   타임라인(액션 아이콘·intent 제목·detail·시각·작성자), per-intent 필터, 각 항목에 [이 버전으로 되돌리기].
   diff 뷰는 ReviseModal의 `wordDiff` 재사용(정의/rule 텍스트 비교).
4. **"적용됨 · Undo" 스낵바**(§2.2, P3에서 이월) — Apply 직후 스낵바에서
   revert API로 원터치 되돌리기. 히스토리 모달이 생기면 revert API 재사용으로 간단.

### 주의점

- `latestVersionNo`는 tx 내 SELECT max — 동시 편집 시 unique 충돌로 롤백(의도된 동작, 재시도는 클라이언트 몫).
- snapshot의 `basePrompt`는 참조용 — revert가 assignment 설정을 건드리면 **안 됨**(Base Prompt는 SCORE 루프 밖, §1.9).

---

## P5 — 런타임 주입 (`/api/chat`) (§1.9, §7.3)

루프를 실제로 닫는 단계. 훅 지점: `src/app/api/chat/route.ts` —
`assignmentBasePrompt(assignment)` 계산(~L135) 직후, `openai.responses.create`(~L190) 전.

### 흐름

```
학생 메시지 수신
→ loadIntentState(assignmentId)          // 활성 intent 없으면 기존 경로 그대로 (주입 스킵)
→ rateMessageIntents({queryText, prev…, intents: promptReady, includeDissection: true, model: nano/low})
   // 1콜. prevQueryText/prevResponseText는 요청 body의 messages에서 마지막 두 턴으로 구성
→ applyPinOverrides + resolveAssignment(ratings, activeIds, links)
   • assigned  → systemPrompt = buildInjectedSystemPrompt(base, intent.rule)
   • fallback  → base 그대로 (정상 경로, §설계원칙 14)
   • boundary  → base 그대로 (§1.8 보수 응답; 다음 배치 판정에서 Needs Decision으로 자연 흡수)
   • pending   → 발생 불가(방금 판정했으므로) — 단, 판정 콜 실패 시 base로 폴백하고 로그
→ 스트리밍 생성 (기존 코드 그대로)
→ (비동기, 응답 차단 금지) 판정 결과를 score_intent_ratings에 upsert — 배치 재판정 비용 절감
→ 주입 로그 기록
```

### 할 일

1. **주입 로그 테이블** `score_injection_log` (§7.3 provenance):
   `{id, assignment_id, message_id(사후 매칭이 어려우면 conversation_id+timestamp), intent_id|null,
   resolution('assigned'|'fallback'|'boundary'|'error'), ratings jsonb(스냅샷), config_version_no, model, created_at}`.
   ensureIntentTables 패턴으로 생성. 뷰어 노출은 후속(감사 로그·§4.6 provenance 기반).
2. **게이트**: 활성 intent가 1개 이상일 때만 판정 콜. rule이 전부 null이어도 판정은 수행
   (배정 로그·Unassigned 관찰 가치) — 단 주입은 rule 있는 intent만 유효.
   원하면 assignment 단위 on/off 플래그(assignments 컬럼 또는 score 쪽 설정)를 추가.
3. **레이턴시**: 판정 1콜 직렬 추가(nano+effort low ≈ 1–2초). `maxDuration` 명시(현재 /api/chat에 없음 — 60 권장).
   프롬프트 캐시: intent 세트가 시스템 프롬프트에 있어 같은 과제의 연속 콜은 캐시 히트.
4. **멀티-Question(§0.1)**: P1이 message=question 단순화를 채택했으므로 P5도 message 단위 배정.
   분절 requests가 2+면 v6은 Rule을 request별 스코프 주입 — 후속(아래 이월 목록).
5. **`/api/chat` 보안 강화(권장, 리뷰 지적)**: 현재 무인증·클라이언트 히스토리 신뢰.
   최소한 `student_session_${assignmentId}` 쿠키 검증 + conversationId 소속 확인을 P5에 함께.
6. **검증**: preview=runtime 실측 — 같은 질문을 ①ReviseModal 프리뷰 ②실제 학생 채팅으로 보내
   같은 rule 주입 프롬프트가 쓰였는지 주입 로그로 대조.

---

## Stage 0 평가 (§7.6 — P5와 병행 가능)

NIRVANA 인간 골드 라벨(`nirvana/GPTWriting_recoded.csv`, 337건 매칭+코딩)로:

- 배타 배정 vs 인간 라벨 3분류(단일 배정/fallback/경계) 정렬도. **조인은 message_id로**
  (기존 평가처럼 텍스트 매칭 금지 — `docs/SCORE_classifierA_vs_human_eval.md`의 방법론 주의 참조).
- 경계 이벤트 빈도가 소유 결정·핀 축적에 따라 감소하는지(경계 품질 곡선).
- 핀 라벨 효율: 핀 N개당 경계 질문 정확도 변화.
- 스크립트는 `src/db/`의 import-nirvana 패턴처럼 일회성 노드 스크립트로.

---

## 이월 항목 (리뷰·설계에서 확인, 의도적 연기)

| 항목 | 근거 | 메모 |
|---|---|---|
| 멀티-Request 판정 (request별 배정·스코프 주입) | §0.1, §1.4a | 분절 데이터는 이미 저장됨(`score_dissections.requests`); 판정 키를 (message,request_idx,intent)로 확장 |
| 핀 top-4를 쿼리별 임베딩 최근접으로 | §1.6, §7.2 | 현재는 intent당 고정(최신 in2+out2) — defHash가 intent 단위라 캐시 유리. 전환 시 defHash가 메시지별로 갈라지는 문제 설계 필요 |
| 링크→문구 승격 / 핀 패턴→정의 문구 승격 (에이전트 제안) | §1.6–1.7 | "예외 3회 반복 시 문구로 흡수 제안" 류의 트리거 + propose 라우트 확장 |
| C-intent 생성 후 A/B except C 링크 자동 제안 | §1.7 | 현재는 수동 |
| tags 모드에서 "이 태그로 New Intent" 승격 버튼 | §1.5 cold start | seed prop은 이미 있음(NewIntentModal) — 버튼만 wire |
| 3개 이상 intent 겹침의 Decide(현재 2개 페어만) | §2.4 | 페어별 순차 결정 UX |
| 판정 rationale ≤10단어 강제(현재 프롬프트 지시만) | §1.4b | 서버에서 truncate 또는 무시 |
| compare 라우트: limiter 풀 2개 병렬(intent당 1개) | P2 리팩터 잔재 | ≤12콜이라 실해 없음; preview-service에 공유 limiter 주입 인자 추가하면 정리됨 |
| edgecases: anchor 미지정 시 farthest 신호만 조용히 스킵 | P3 리뷰(미검증) | 의도된 degradation — 400으로 바꿀지는 취향 |
| probably_in을 "포함"으로 계산하는 잠정 결정 | §7.6 미결정 | Stage 0 데이터로 재검토 (`INCLUDED_RATINGS` in intents.ts 한 줄) |
| 세션 리플레이/과제 삭제 cascade에 SCORE 테이블 미포함 | P1 크리틱 | assignment 삭제 시 score_* 행 FK 위반 가능 — cascade에 추가 필요 |

---

## 재개 절차 (다음 세션에서)

1. 이 문서와 `~/.claude/.../memory/score-v6-design.md`(세션 메모리) 확인.
2. `npm run db:local:up`(필요시) → `npm run dev` → NIRVANA 과제
   (`/instructor/assignments/ea905a40-…/score`)에서 Intents 모드 확인.
3. P4부터: versions API → revert API → 히스토리 모달 → Undo 스낵바 순.
4. 각 단계 후: `npx tsc --noEmit` + `npm run lint` + `npm run build`,
   dev 서버 재시작 후 실측 스모크(위 개발 메모의 쿠키 방식), 테스트 intent는 심은 뒤 반드시 삭제.

# 유저스터디 v2 반영 계획 (델타)

> 작성 2026-08-12. `USER_STUDY 설계 v2.md`(08-10)와 `USER_STUDY 문항지 v1.md`(08-11)를
> **v1 기준으로 완성된 현재 시스템**(study-tools 브랜치, M1–M8 완료·검증)에 반영하기 위한
> 변경 계획. v1 전체 계획(`USER_STUDY_IMPL_PLAN.md`, `USER_STUDY_BUILD_SPEC.md`)은 이
> 문서가 다루는 델타를 제외하면 여전히 as-built 기록으로 유효하다.
>
> **2026-08-12 확정.** 결정 D1~D4가 내려져 구현 지시서는
> `USER_STUDY_V2_BUILD_SPEC.md`로 넘어갔다 — 이 문서는 델타 분석 기록으로 남는다.
> (D1 큐레이션 현행 유지 · D2 Baseline 포인팅 = 드래그 하이라이트 · D3 A/B 데이터까지
> 삭제 · D4 데모 기존 구현 유지)
>
> 원칙: **v2가 삭제한 것은 코드에서도 참가자 경로에서 제거**한다(죽은 분기 유지 비용 >
> 되살릴 가능성). 단, 이미 쌓인 측정 데이터 테이블은 지우지 않는다.

---

## 0. 델타 요약 — v2 변경점 → 시스템 영향

| # | v2 변경 (설계 §, 문항지 §) | 현재 상태 | 영향 |
|---|---|---|---|
| 1 | **최종 블라인드 A/B 삭제** (§2, §4, §9) | `ab` 페이즈 + `/study/session/ab` + ab 세트(타깃 2/유형) + 뱅크 ab 블록 + 응답 생성 + export `score_was_home` 전부 구현됨 | **W1 — 제거** |
| 2 | **블록 테스트 4단계** — 예측(서술·짐작·**포인팅**)→공개→판정→프로브 (§5, 문항지 §3) | 짐작(예/아니오)+공개+5점 판정만 있음. 포인팅 없음. config 열람은 이미 됨(SnapshotConfigView) | **W2 — 확장** |
| 3 | **미니 설문 5문항 확정** — C1 C2 B1 B2 T1, 7점 (문항지 §4) | v1 플레이스홀더 8문항(5/7점 선택) | **W3 — 교체** |
| 4 | **튜토리얼 = 라이브 시연** (영상 폐기) — 격리 subtype 재료로 실제 시스템 시연 (§5) | 데모 subtype 격리는 구현. 데모용 미니 마스터·진행자 데모 클론은 **미구현**(v1 때부터 pending) | **W4 — 신규** |
| 5 | 검토 세트 12~15 [파일럿], 테스트 세트 = 유형당 "가장 흔한 두 subtype에서 하나씩" (§4) | 타깃은 모달로 조정 가능(1–40). subtype 구성 규칙은 검증에 없음 | **W5 — 소프트 경고** |
| 6 | **큐레이션 원칙: 연구팀 2~3인 독립 subtype 라벨 → 일치=확실/불일치=경계** (§4) | LLM 판정 기반 certain/boundary (사용자 결정으로 v1에서 인간 라벨링 제거했음) | **결정 D1** |
| 7 | 측정 재편 — 예측 정확도(짐작↔판정 접기), 포인팅↔실제 라우팅 대조(SCORE 객관 채점), 배포 확신 보정 (§6) | export-metrics는 v1 지표(ab 포함). 응답에 `applied`(라우팅 결과)는 이미 저장됨 ✓ | **W6 — 재편** |
| 8 | 세션 90분 · 작업 25분 상한 · 20분 경고 (§5) | 시스템 강제 없음(진행자 운영). 콘솔 phaseMinutes 표시는 이미 있음 | 변경 없음 |
| 9 | 16명 · 4셀 균형 (§7) | `cellForParticipant` mod 4 구현됨 | 변경 없음 ✓ |
| 10 | 스크리너 · 진행자 스크립트 · 관찰 메모 양식 · 인터뷰 가이드 · IRB (문항지 §1·2·5·6) | 시스템 밖 (Prolific·Zoom·문서) | 범위 밖 |
| 11 | UI 문구를 문항지 원문으로 (문항지 §0·3·4) | BlockTest·설문 카피가 v1 문구 | W2·W3에 포함 |

페이즈 흐름 변화:

```
v1:  not_started → block1(work→test→survey) → break → block2(…) → ab → done
v2:  not_started → block1(work→test→survey) → break → block2(…) → done
                                                                  (인터뷰는 Zoom 구두 — 시스템 밖)
```

---

## W1 — A/B 제거

참가자 경로·큐레이션·뱅크·생성·export에서 A/B를 걷어낸다.

- `src/lib/study/phases.ts` — `STUDY_PHASES`에서 `'ab'` 제거, `PHASE_LABELS`·`phaseAccess`
  분기 정리. `block2_survey → done` 직결.
- `src/app/study/session/ab/` 삭제, 랜딩 페이지의 ab 단계 표시 제거.
- `src/lib/study/measure-store.ts` — `getAbItems`/`abForBlock`/A/B 귀속 스트립 경로 제거.
  `studyAbAnswers` **테이블·스키마는 남긴다**(기존 테스트 데이터 보존, DDL 무해).
- `src/lib/study/config.ts` — `DEFAULT_SET_TARGETS`에서 `ab` 제거 → `CurationSetKind`가
  `review | test`로 좁아짐. `SET_TARGET_LIMITS` 동기화.
- 큐레이션: 보드 카드 3→2, 타깃 모달에서 A/B 행 제거, `validateCuration`의
  `ab_balance` 규칙 제거, member/clear 라우트의 enum은 CURATION_SET_KINDS를 따라
  자동으로 좁아짐. **기존 `study_set_members`의 ab 행 삭제**(양 데이터셋 — 픽스처임, D3).
- `scripts/study/build-question-bank.ts` — ab 블록 생성 제거(테스트 8문항만).
- `src/lib/study/generate.ts` — ab 문항 응답 생성 경로 제거.
- `scripts/study/export-metrics.ts` — `score_was_home` 등 ab 지표 제거(W6에서 재편).
- 콘솔: `abProgressFor` 및 A/B 진행 표시 제거.

**검증.** `check-session-walkthrough`를 v2 페이즈 흐름으로 갱신해 전 구간 통과.
tsc + build. 기존 참가자(v1 페이즈에 있는 계정)는 무시(사용자 확인 완료된 전제).

## W2 — 블록 테스트 4단계

문항지 §3을 그대로 UI에 싣는다. 서술(①구두)·프로브(④구두)는 시스템 밖이므로,
시스템이 담는 것은 **짐작 + 포인팅 + 공개 게이트 + 판정**이다.

- **DDL/스키마** — `study_test_answers`에 추가 (ensureStudyTables + schema.ts):
  - `pointed_intent_id integer NULL` — SCORE: 지목한 intent
  - `pointed_kind text NULL` — `'intent' | 'none' | 'not_sure'`(SCORE) /
    `'part' | 'nothing' | 'not_sure'`(Baseline)
  - `pointed_note text NULL` — Baseline '부분 지목' 시 한 줄 텍스트 [파일럿 D2]
  - `pointed_at timestamp NULL`
- **게이트 확장** (`measure-store`) — 응답 공개 조건: 짐작 **그리고** 포인팅 기록.
  첫 답 고정(재응답 무시)은 기존 규칙 유지, 포인팅에도 동일 적용.
- **BlockTest UI** —
  - 짐작: **"Will your chatbot answer this the way you intend?"** Yes / No (문구 교체)
  - 포인팅(짐작 다음, 공개 전):
    - SCORE: *"Which intent do you expect this question to fall under — if any?"*
      — 스냅샷 config의 intent 목록에서 클릭 + `None of them` + `Not sure`
    - Baseline: *"Which part of your Rules document do you expect to shape the
      response — if any?"* — `I can point to a part`(+한 줄 입력) / `Nothing
      specific` / `Not sure`
  - 판정: **"How well does this response match what you intended?"**
    1 = *Not at all what I intended* … 5 = *Exactly what I intended* (앵커 교체)
  - 3점 이하 후속("What's off about it?")·프로브는 구두 — UI에 넣지 않음
  - config 패널(intent 트리/RULES)은 전 단계에서 열려 있음 — 현행 유지, 예측 단계에서도
    보이는지 확인
- **라우팅 대조 준비** — 응답 행의 `applied`(이미 저장)와 `pointed_intent_id`를
  export에서 대조(W6). UI에서는 공개 후에도 정오를 표시하지 않는다(프로브는 진행자 몫).

**검증.** 신규 컬럼 왕복(게이트: 포인팅 없이는 응답 미포함), 첫 답 고정, SCORE/Baseline
포인팅 UI 각각 실 클론에서 확인. 문항지 §3 문구 그대로인지 대조.

## W3 — 미니 설문 교체

- `src/lib/study/survey-items.ts` — 기본 문항을 문항지 §4의 5개로 교체:
  `control_felt`(C1) · `control_achieve`(C2) · `burden_mental`(B1) ·
  `burden_frustration`(B2) · `trust_future`(T1). 앵커 *Strongly disagree / Strongly
  agree*, 지시문 *"Thinking about the version you just used…"*. 기본 척도 7점
  (5/7 선택지는 [파일럿] 유지).
- construct 타입에 `burden` 추가(현 `load`를 대체 또는 알리아스).
- DB의 저장된 설문 구성·테스트 응답 리셋(`resetSurveyItems` — scale_locked 회피를 위해
  테스트 응답 정리 후). 참가자 설문 UI 지시문 교체.

## W4 — 라이브 튜토리얼 지원 (데모 재료)

시연은 "격리된 demo subtype의 실제 대화"로 한다(§5). 필요한 것:

- `build-study-masters.ts` 확장 — 데이터셋별 **데모 미니 마스터**: demo subtype
  학생들의 대화만 담은 마스터(참가자 세트에서 이미 제외된 학생들). v1 때 계획만 되고
  미구현이던 항목의 라이브-시연 버전.
- 진행자 데모 클론 — 콘솔에 "Provision demo pair" 버튼: 데모 마스터에서 SCORE/Baseline
  클론 한 쌍을 진행자 계정으로 생성·리셋. 시연 후 리셋해서 다음 세션에 재사용.
- 고정 대본 2벌은 문서(범위 밖) — 단 대본이 요구하는 조작(“intent 만들기→수정→rule→예제
  →프리뷰→배포”)이 데모 클론에서 전부 동작하는지 워크스루로 확인.

## W5 — 큐레이션 조정 (경량)

- 검토 세트 12~15 [파일럿]: 현행 타깃 모달로 충분 — 기본 15 유지, 변경 없음.
- 테스트 세트 구성 규칙: 유형당 "가장 흔한 두 subtype에서 하나씩" — `validateCuration`에
  **경고(warning)** 레벨로 추가: 테스트 멤버가 그 유형의 최빈 2 subtype 밖이면 표시.
  차단하지 않는다(큐레이션 재량).
- 두 데이터셋 테스트 세트의 "성격 구성 동일(A형/B형)"은 수동 판단 — 보드의 세트 보기로
  대조 가능, 자동화하지 않음.

## W6 — export/분석 산출물 재편 (§6 표 기준)

`export-metrics.ts`를 v2 지표로:

- **예측 정확도** — 짐작(예/아니오) ↔ 판정 접기(≤3 = '아니오') 일치율, 블록·조건별.
- **포인팅 채점(SCORE)** — `pointed_intent_id` ↔ 응답 `applied`의 intent 대조
  (`none` 지목 ↔ 실제 type_default 낙하 포함 4분면). Baseline은 pointed_kind 분포만.
- **배포 확신 보정** — 짐작 '예' 개수 vs 판정 4–5 개수.
- **5점 부합도** — 문항×참가자 원시 + 기술통계(효과크기는 분석 단계).
- 미니 설문 원시 응답. misalignment 코딩 재료로 **3점 이하 문항 목록**(문항·조건·판정)
  내보내기. ab 관련 출력 전부 제거.

## W7 — 문서·운영 정리

- `docs/USER_STUDY 설계 v1.md` → `docs/_archive/`로 이동(v2 머리말과 일치시킴).
- 새 문서 2벌 + 본 계획 커밋. `USER_STUDY_BUILD_SPEC.md`/`IMPL_PLAN.md` 머리에
  "v2 델타는 USER_STUDY_V2_DELTA_PLAN.md" 표기 한 줄.
- 메모리(스터디 상태) 갱신은 구현 완료 시점에.
- 기존 클론 20개(v2 타입/구 템플릿)는 축소 마스터 전환 때 일괄 deprovision(기존 계획
  유지 — 전환은 파괴적이므로 별도 확인).

---

## 결정 필요 (구현 전)

- **D1. 큐레이션 인간 라벨링 (§4 원칙 vs 현행 LLM 등급).** v2는 "연구팀 2~3인 독립
  라벨 → 일치=확실/불일치=경계, 절차·일치율 논문 보고"를 명시하는데, 현행 도구는 LLM
  판정으로 certain/boundary를 산출한다(사용자 결정으로 v1에서 인간 라벨링 제거).
  **절충안 제안:** LLM 등급은 후보 탐색 도구로 유지하고, 확정된 검토+테스트 **후보만**
  (12~15×4×2 + 8×2 ≈ 최대 136문항) 2~3인이 독립 라벨 → 일치율·확실/경계 산출은
  내보내기 CSV + 집계 스크립트로 오프라인 처리. "자연 경계 비율"의 기준(LLM 전체 로그
  vs 인간 라벨 후보)도 이때 확정.
- **D2. Baseline 포인팅 입력 형태 [파일럿].** 최소 구현(선택지 3 + 한 줄 텍스트)로
  가고 파일럿에서 클릭/구두를 확정하는 안. SCORE는 intent 클릭으로 확정.
- **D3. 기존 ab 데이터 정리.** `study_set_members`의 ab 행(픽스처)은 W1에서 삭제,
  `study_ab_answers` 테이블·기존 응답은 보존(코드 경로만 제거). 이대로 좋은지.
- **D4. 데모 마스터 범위.** 데이터셋별 demo subtype 학생 전체 대화로 미니 마스터 구성
  (진행자 전용, 참가자 재료와 완전 분리). 이대로 좋은지.

## 구현 순서·규모

```
W1 (A/B 제거)            0.5일   ← 먼저: 이후 작업의 타입·화면이 단순해짐
W3 (설문 교체)           0.25일  ← 독립적, 짧음
W2 (블록 테스트 4단계)    1.0일   ← 본체 (DDL + 게이트 + UI 2조건)
W6 (export 재편)         0.5일
W4 (데모 재료)           0.5일
W5 (큐레이션 경고)        0.25일
W7 (문서 정리)           0.25일
─────────────────────────────
합계                     ~3.25일
```

각 워크스트림 끝에 tsc + build + 해당 check 스크립트, W1·W2 뒤에는
`check-session-walkthrough` 전 구간 통과를 게이트로 삼는다.

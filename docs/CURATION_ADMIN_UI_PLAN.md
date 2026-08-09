# 세트 큐레이션 Admin UI — 설계 (v2, 단일 화면)

**작성:** 2026-08-09 (v2 — 같은 날 v1의 3화면안 폐기) · **상위 계획:** `docs/USER_STUDY_IMPL_PLAN.md` WS1 · **스터디 설계 근거:** `docs/USER_STUDY 설계 v1.md` §4

> **v1 → v2 변경**: 인간 독립 라벨링 + 합의(κ)·조정 기계 **폐기**. 대신 이미 존재하는 기계 분류를 브라우징의 근간으로 쓴다 — 4-type multiclass(`score_query_types`, 마스터 전수 분류 완료) 안에 starter subtype 판정(`is_template` intent들의 `score_intent_ratings`, 마스터 사전 판정 완료)을 중첩하고, **clearly_in / probably_in까지** 노출한다. 큐레이션은 보드 레이아웃 **한 화면**에서: subtype으로 걸러 보면서 질문마다 검토/블록 테스트/A/B 배정을 체크하고, 세트별로 모아 보고, 저장→확정→빌드.

---

## 0. 원칙 (v2)

1. **Cold start 없음** — 분류는 이미 있다. 화면은 판정 캐시를 읽기만 하고, 누락분만 [분류 갱신] 버튼이 기존 rate 러너로 채운다.
2. **경계 = probably_in** — 스터디 설계 §4의 확실/경계 구분을 judge 등급에서 직접 파생(clearly_in=확실, probably_in=경계). 자연 경계비율도 전 로그의 등급 분포에서 계산. ⚠ *방법 변경 유의: 설계 문서 §4는 "연구팀 2~3명 독립 라벨 + 일치율 보고"를 명시 — LLM 분류 + 연구자 검수로 바꾸는 것은 [미팅]에서 정리 필요(논문 보고 문구가 바뀜).*
3. **DB가 진실** — 배정은 `study_set_members` 행 upsert(즉시 저장), 확정은 잠금, 빌드는 잠금 상태만 읽는다.
4. **분류 결과는 저장되어 스터디 시스템이 사용** — §4 참조.

---

## 1. 접근 (v1과 동일)

`/study/admin` 로그인: 연구자 코드(`STUDY_ADMIN_CODES` allowlist) + `STUDY_ADMIN_PASSCODE`. `/api/study/login` 스켈레톤 복제, `ensureAdminAccount`(비밀번호 없는 administrator 행 — getInstructor는 role만 검사, auth.ts:19-36; import-nirvana.ts:104-117 선례), 같은 `user_session` 쿠키. 마스터 읽기는 `authorizeAssignment`(authz.ts:19-30)로 기존 API 무변경. 코드별 계정은 배정·확정 이력의 주체 기록용.

## 2. 단일 화면 `/study/admin/curation?ds=swag|nirvana`

**보드(dashboard) 3열 레이아웃 그대로** (`lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)]`, IntentBoard.tsx:2189) + 헤더 아래 세트 요약 스트립:

```
┌ 헤더: Set Curation · [SWAG 507 | NIRVANA 348] · R1 ──────────────────────┐
├ 스트립: 검토 43/60 · 블록 5/8 · A/B 6/8 · 데모 subtype [AL-2 ▼] · [분류 갱신] · [확정·잠금] ┤
├─320px────────────────┬─질문 리스트──────────────────┬─대화 + 배정────────────┤
│ ▣ 세트 보기            │ [검색][정렬 PID↑][경계만 ☐]     │ ConversationThread     │
│   검토 세트   43/60    │ ──────────────────────────── │ ────────────────────  │
│   블록 테스트  5/8     │ P07·T3  ● clearly  [검토]      │ 분류: Planning ·        │
│   A/B        6/8      │  주제 범위가 너무 넓은…          │  PL-2 주제 탐색 ◐ prob. │
│   데모 격리   학생4     │ P11·T2  ◐ probably (미배정)    │ ────────────────────  │
│ ───────────────────── │  제 논제가 너무 평범한가요…      │ 배정:                   │
│ ● Planning 130        │ P15·T8  ● clearly  [A/B]      │ [검토 세트] [블록 테스트]  │
│  ├ PL-1 개요요청 ●23 ◐7 │ …                            │ [A/B] [해제]            │
│  ├ PL-2 주제탐색 ●18 ◐9 │                              │                        │
│  └ …                  │                              │                        │
│ ● Translating 118 …   │                              │                        │
└──────────────────────┴──────────────────────────────┴────────────────────────┘
```

**좌측 (BaselineFilterTree 개작 — IntentBoard.tsx:331-457 + 트리 엘보 149-181):**
- 상단 **세트 보기** 블록: 검토/블록/A/B/데모 행 — 클릭하면 중앙 리스트가 **그 세트 멤버만** 표시(= "각 세트에 들어간 것을 따로 정리해서 보기"). 카운트는 목표 대비(43/60), 부족하면 amber.
- 아래 4 타입 섹션(기계 분류 카운트, TYPE_SECTION_DOT) → 그 안에 **starter subtype 행** 중첩: 라벨 + `● N`(clearly_in) `◐ M`(probably_in) 뱃지. 클릭 = 그 subtype 질문으로 필터(clearly 먼저, probably 구분 표시). 판정 캐시(`score_intent_ratings`, 템플릿 defHash)를 읽기만 — 클릭 비용 0 (baseline filter 트리와 같은 원리).

**중앙 (보드 질문 리스트 마크업 + PaneSearch·SortSelect 직수입):**
- 행: PID·Turn 메타 + 스니펫 + 등급 칩(● clearly / ◐ probably) + **배정 상태 칩**([검토]/[블록]/[A/B], 미배정은 무칩).
- 행 hover 오버레이(IntentWorkbench.tsx:1728-1736 문법)에 배정 토글 3개 — 리스트에서 바로 배정 가능. 상호배타(한 질문은 한 세트에만) — 겹침이 구조적으로 불가능.
- 세트 보기 모드에서는 타입별 그룹 헤더(Planning 12/15 …)와 [제거] 컨트롤.

**우측:**
- ConversationThread 직수입(선택 질문 스레드 — 직전 턴 맥락 확인이 배정 판단의 근거).
- 분류 카드: type + 매칭된 subtype들과 등급(둘 이상 매칭 시 모두 표시 — 필터는 first-match가 아니라 독립 판정이므로 겹칠 수 있음을 그대로 보여준다).
- 큰 배정 버튼 4개: [검토 세트][블록 테스트][A/B][해제] — 키보드 1/2/3/0 + ↓ 다음 질문.

**스트립:**
- 세트 요약 칩(목표 대비, 타입별 세부는 세트 보기에서), **데모 subtype 드롭다운**(지정 시 격리 학생 수 표시 + 그 학생들 질문은 배정 차단·회색 처리), [분류 갱신](마스터에 판정 누락분만 기존 rate 러너 실행), [확정·잠금].
- 확정 시 검증(가볍게): 세트별 개수 충족, 데모 격리 위반 0, A/B 균형 블록 구성 가능 여부, probably_in(경계) 비율이 자연비율과 큰 괴리 시 경고 — 통과해야 잠금. 잠금 후 violet 배너 + [빌드 실행](= `build-study-masters` / `build-question-bank` lib 호출), 해제 시 "재빌드 필요".

## 3. 데이터 모델 (v2 — 라벨 테이블 삭제)

```sql
-- study_curation_labels 폐기 (기계 분류가 대체: score_query_types + 템플릿 score_intent_ratings)
study_set_members (
  dataset_key, set_kind 'review'|'test'|'ab',
  source_message_id, position,
  query_type text, subtype text, rating text,   -- 배정 시점 분류 스냅샷 (분석·밸런스 리포트용)
  added_by, created_at,
  UNIQUE (dataset_key, source_message_id)        -- 상호배타를 스키마로
)
study_curation_meta (dataset_key, demo_subtype, locked_at, locked_by)
```

데모는 set_kind가 아니라 **격리 규칙**(demo_subtype 매칭 학생의 전 질문 배정 금지)으로 처리 — §4 "양쪽 데이터셋 전 세트 제외"와 일치.

## 4. 분류 결과의 저장과 스터디 시스템 사용

- **이미 흐르는 경로**: 마스터의 `score_query_types` + 템플릿 판정은 클론 생성 시 복사됨(provision.ts:229-265) → 참가자 도구의 타입 섹션·starter 제안·probe 템플릿 시딩이 그대로 이 분류를 사용. **축소 스터디 마스터를 빌드하면 이 캐시 서브셋이 따라간다** — 추가 작업 없음.
- **새로 저장하는 것**: ① `study_set_members`의 분류 스냅샷(위) — 세트 밸런스 리포트·사후 분석("다룬/안 다룬" 분류, subtype별 승률 슬라이스)의 기준. ② `study_question_bank`(IMPL_PLAN WS1)에 `query_type` + `subtype` 컬럼 — 블록 테스트·A/B 문항의 분석 슬라이스. ③ 확정 시 세트 구성 리포트(타입×subtype×등급 분포, 자연비율 대비)를 JSON/CSV로 export — 논문 §4 보고 자료.

## 5. API (v2 축소)

```
POST  /api/study/admin/login
GET   …/curation/state?ds=        분류 트리 카운트 · 세트 멤버 · 메타 일괄
PUT   …/curation/member           배정/해제 (행 upsert/delete — 즉시 저장)
POST  …/curation/demo-subtype
POST  …/curation/classify         판정 누락분 rate 러너 실행 (기존 rate 기계 재사용)
POST  …/curation/lock | unlock | build
```

(합의·adjudicate·자동제안 라우트 삭제. 자동 채우기는 필요해지면 `curation.ts`에 후일 추가 — 수동 배정이 기본 흐름.)

## 6. 구현 순서·견적 (v2)

| 단계 | 내용 | 견적 |
|---|---|---|
| 1 | 로그인·계정·가드 + 페이지 골격(행 조립 서버 페이지) + state API | 0.5일 |
| 2 | 단일 큐레이션 화면(트리+subtype 뱃지, 리스트+배정, 뷰어+분류 카드, 세트 보기, 스트립·잠금) | 1~1.5일 |
| 3 | [분류 갱신] 러너 연결 + 확정 검증 + 빌드 트리거 + 구성 리포트 export | 0.5일 |
| 계 | | **2~2.5일** (v1 3.75일 → 약 1.5일 절감) |

주의(유지): ConversationThread는 ScoreQueryRow 필요(raw {role,content} 불가) — 서버 행 조립은 score page.tsx 패턴. 템플릿 판정 커버리지는 마스터 전수 존재가 전제(S-6a가 근거) — 첫 진입 시 state API가 누락 수를 보고하고 [분류 갱신]으로 채운다.

## 7. 스터디 설계 문서와의 정리 항목 ([미팅])

- 큐레이션 방법: 인간 독립 라벨링·일치율 보고(§4) → **LLM 분류 + 연구자 검수·배정**으로 변경. 경계 정의도 "라벨러 갈림" → "judge probably_in"으로. 논문의 큐레이션 서술·보고 수치(일치율 → 판정 등급 분포)가 바뀌므로 지도교수와 확정할 것.
- subtype의 원천이 starter set(Jelson taxonomy)으로 고정됨 — 데모 subtype 선정(§4 세트 구성 1)도 starter 목록에서 고른다.

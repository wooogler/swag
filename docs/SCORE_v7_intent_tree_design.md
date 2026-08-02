# SCORE v7 설계 — Intent Tree (중첩 집합 + first-match 체인)

작성: 2026-08-01 · 상태: **설계 초안 (구현 전)** · v6의 분류/배정 층(§classification, resolveAssignment, exception links, boundary)을 대체함. Rule/버전/배포 메커니즘은 유지하되 형태 변경.

## 0. 한 줄 요약

> **트리는 저작 모델이고, 런타임은 "자식 먼저 · 부모는 else · 형제는 생성 순"으로 컴파일되는 first-match 체인이며, 판정은 노드별 독립이다.**

모든 쿼리는 구조적으로 **정확히 하나의 rule**에 떨어진다. Overlap은 해소 대상이 아니라 발생 불가능한 상태가 된다.

## 1. 배경 — 왜 바꾸는가

v6는 intent마다 독립 분류기를 전체 로그에 적용한다. 그 결과:

- **Overlap이 구조적으로 발생**한다 (2+ intents가 같은 쿼리에 clearly_in). 이를 해소하기 위한 기계 — boundary/Needs Decision 큐, exception link("A except B"), Decide Ownership(응답 비교), overlap 칩/배너 — 가 UI와 로직 복잡도의 주범이었다 (직접적 overlap 전용 코드 약 1,100–1,200줄).
- **실사용은 이미 후퇴했다.** Decide Ownership 플로우는 parked(도달 불가) 상태이고, 실전 해소 수단은 definition 조이기뿐. 아키텍처가 실무 관행보다 무겁다.
- **런타임 결함**: 배포 후 학생 쿼리가 boundary로 판정되면 조용히 base prompt가 나간다 — overlap 지역의 학생은 rule을 아예 받지 못한다.
- Instructor 데모에서 얻은 경험: 전체 로그를 눈앞에 두고 intent를 구상하는 것은 막막하다. **4개 type으로 나눠 브라우징하면 멘탈 모델 구축이 쉬워진다.**

## 2. 목표

1. 모든 쿼리가 정확히 하나의 rule에 떨어진다 (overlap 원천 차단, 해소 UI 불필요).
2. 기술에 익숙하지 않은 instructor도 이해하는 멘탈 모델: **if / else if** + **집합 안의 집합**.
3. 진입 경험: type별로 실제 쿼리를 둘러보다가 → intent 아이디어를 얻고 → 그 자리에서 생성.

## 3. 아키텍처

### 3.1 Type 층 — 고정 4-분류 (multi-class)

- 모든 쿼리는 **Planning / Translating / Reviewing / Drafting** 중 정확히 하나로 분류된다 (single-label).
- Drafting은 구 Jelson 'All'의 후계 라벨이되 의미가 이동: "초안 생성 요청 + 다중 활동 흡수".
- **Tie-break 규칙: 다중 활동 쿼리는 Drafting이 이긴다.** 필요하면 instructor가 Drafting 안에서 intent를 carve-out하여 대처한다. *(검증 필요 — §6.2, §6.3)*
- 'Other' type은 없다. off-topic/잡담도 4개 중 하나로 강제되고, 해당 type의 else rule이 적용된다.
- **캐싱 성질**: 메시지 내용은 불변이므로 type 판정은 **메시지당 평생 1회**. 분류기 프롬프트/버전 변경 시에만 전체 재계산. (intent 판정처럼 definition 수정마다 재계산할 일이 없음.)
- 성능 전제: 구 Classifier A의 Type 일치 79.2%(κ=0.72)는 자료 치환([ASSIGNMENT PROMPT], [OWN DRAFT]) **이전** 측정. 치환 적용 상태로 재평가가 선행되어야 한다 *(§6.1)*. Type 게이트 오류는 하위에서 복구 불가능하므로 이 실험이 설계의 전제 조건이다.

### 3.2 Intent = 집합 (tree)

- **Type = 루트 집합.** 편집 가능한 자기 rule(= else rule)을 가진다.
- Intent는 반드시 **어떤 집합의 내부**에 생성된다: type 직속, 또는 기존 intent(Set A)의 내부/외부. "Set A 안에 만들 것인가, 밖에 만들 것인가"가 생성 시의 핵심 선택.
- **Subtype 스타터 intent는 폐기한다.** 26 subtype은 사용자 멘탈 모델과 맞지 않고 overlap 발생원이었다. subtype은 intent 생성 시 **템플릿 추천**으로만 남아, 다듬어서 자기 intent로 만드는 재료가 된다.
- 깊이 제한은 두지 않는다. (초반 사용 전제상 깊어질 시간이 없음. UI 기본값이 얕은 구조를 유도 — 생성 다이얼로그의 기본 위치는 type 직속. 장기 운영 시 트리 정리 기능은 추후 과제.)

### 3.3 평가 규칙 — 명문화 (구현 불변 조건)

```
chain(S):   # S의 평가 체인 = 후위 DFS (자식이 자신보다 앞)
    return concat(chain(c) for c in S.children[생성 순, 조절 가능]) + [S]

route(q):
    T = type_of(q)                 # 4-type multi-class (§3.1)
    for S in chain(T):             # first match wins
        if judge(S, q) == match:   # 노드별 독립 판정 (§3.4)
            return S.rule
    return T.rule                  # 최종 else = type 자신의 rule
```

- 트리는 **flat first-match 체인으로 컴파일**된다: 각 집합의 subset들이 그 집합 자신보다 앞에, 형제는 순서대로. 예: `T{ A{B, C}, D }` → 체인 `[B, C, A, D, T-else]`.
- **부모 판정은 게이트가 아니다.** 자식은 부모 판정 결과와 무관하게 자기 definition으로 직접 판정된다(§3.4). 부모가 안 맞는데 자식이 맞으면 자식이 이긴다 — 대개 부모 판정 오류이므로 이쪽이 정답에 가깝다.
- 형제의 서브트리는 통째로 앞선다: `T{ A{B}, D{E} }` → `[B, A, E, D, T-else]` (전역 깊이 정렬이 아님 — 상위 형제 순서가 서브트리 단위로 지배).
- **모든 쿼리는 반드시 어떤 rule 하나를 받는다** (최종 else = type rule).
- ⚠️ **"생성 순서"를 문자 그대로 단일 flat 체인에 적용하면 안 된다.** Type/부모가 먼저 생성되므로 subset이 부모에 가려 영원히 도달 불가가 된다. 반드시 위 후위-DFS 컴파일로 구현할 것.

### 3.4 판정 — 저작 구조형 (게이트 아님)

- 각 노드(intent)는 **독립적으로 판정**된다: 자기 definition만으로, **해당 type의 전체 쿼리**를 대상으로.
- 트리 구조와 형제 순서는 **read-time resolver에서만** 적용된다. 따라서:
  - 재구성(집합 안/밖 이동)·재정렬·부모 변경은 **LLM 비용 0** (판정 재실행 불필요).
  - 판정 캐시(per-node defHash)는 형제/부모와 무관하게 유지된다.
- **게이트형(부모 판정 통과 후에만 자식 평가)을 배제한 이유**: 판정 flip이 실측 4–5%인 상태에서 게이트를 직렬화하면 false negative가 곱으로 누적된다. 부모 판정이 한 번 삐끗하면 자식이 확신을 갖고 매치할 쿼리도 도달 불가.
- 자식 definition은 부모 문맥에 기대지 않고 **단독으로 판정 가능하게** 작성한다 ("인용 관련 교정 요청"처럼). 부모는 안 맞는데 자식이 맞는 쿼리는 대개 부모 판정 오류이므로, 독립 판정이 오히려 정답에 가깝다.
- **감수하는 대가**: 판정 매트릭스가 type으로 분할되므로 **cross-type 누수는 진단 불가능**하다 (어떤 intent가 다른 type의 쿼리를 잡을 수 있는지 영영 안 보임). type 분류 신뢰에 베팅하는 것이며, §6.1 재평가가 그 담보다.

### 3.5 Rule — one-layer 유지, base prompt 소멸

- **Rule = 해당 intent의 완결된 system prompt 하나** (2026-07-28 one-layer 결정 유지, 레이어 합성 없음).
- **시드는 copy-on-create**: 새 intent의 rule은 감싸는 집합의 rule 복사본에서 시작한다. Instructor는 "기본 동작에서 무엇이 다른가"만 편집한다. Live 상속(부모 수정의 자식 전파)은 하지 않는다 — 숨은 레이어의 부활이며 one-layer 결정과 충돌.
- 부모 rule 수정 시: "이 rule에서 시작한 intent N개를 검토할까요?" 넛지 제공.
- **base prompt 개념은 완전히 소멸**한다. 4-way 전수 분할 + type별 else rule로 모든 쿼리가 어떤 rule이든 받으므로, base prompt의 남은 두 역할(시드·fallback)을 type rule이 전부 흡수한다. 은닉 fail-open은 **분류기 오류/타임아웃 시의 비상용** 하나만 남긴다.

### 3.6 핀 (라벨)

- 핀은 **그 노드의 판정만 고정**한다. 라우팅 순서는 불변.
- 따라서 뒤 순위 intent에 in-핀을 박아도 앞 형제가 매치하면 앞이 이긴다. 특정 쿼리를 특정 intent로 보내는 확실한 수단은 **"이 쿼리를 여기로" 복합 액션** — 시스템이 앞 매처들에 out-핀을 대신 기록한다.

### 3.7 형제 순서와 shadowing

- 기본 순서 = 생성 순. **UI에 노출**하고, 필요 시 우선순위 조절 기회를 제공한다 (완전 은닉 금지).
- **Shadowing 진단 필수**: "앞 형제 X가 이 intent의 매치 쿼리 N개를 가로채고 있음"을 표시. first-match에서 overlap은 사라지는 게 아니라 *침묵*하므로, 이 진단이 구 Overlaps 큐의 후계자다. (중복 definition intent를 만들면 구 시스템은 둘 다 0으로 보였지만, 신 시스템은 앞 것이 조용히 독식 — 진단 없이는 건강한 좁은 intent와 구별 불가.)
- 교정 수단은 두 가지: 우선순위 조절, 그리고 **집합 재배치**(안으로 넣기 — 겹침이 사실 포함관계였던 경우가 많고, 집합 은유에 더 충실).

## 4. v6 대비 변화 요약

| | 항목 |
|---|---|
| **소멸** | boundary/Needs Decision 큐, exception links(테이블·라우트·advisory-lock 가드), Decide Ownership/compare, overlap 칩/배너 일체(~1,100–1,200줄), subtype 스타터 intent 세트, base prompt 개념 |
| **신설** | type 층(분류기 + 메시지당 1회 캐시), 트리/순서 축(스키마 · 스냅샷 · 버전 액션 · dirty 감지 전부 순서-민감화), shadowing 진단, type별 else rule, "이 쿼리를 여기로" 복합 액션 |
| **보존** | 노드별 독립 판정 + defHash 캐싱 경제, one-layer rule 주입, 배포 스냅샷/버전 메커니즘(형태만 변경), 핀 = 판정 오버라이드, 판정-라우팅 분리(배정은 항상 파생·저장 안 함) |

## 5. Instructor 워크플로 (의도)

1. Type별로 실제 쿼리를 브라우징한다 (type 판정은 전 로그에 대해 사전 계산됨).
2. 쿼리들을 보다가 intent 아이디어를 얻는다 (subtype 템플릿 추천이 보조).
3. 그 자리에서 intent 생성 — 위치 선택(어느 집합 안/밖), rule은 감싸는 집합에서 복사되어 시작.
4. 판정 결과를 확인하고 핀/definition 수정으로 경계를 다듬는다.
5. Shadowing 진단이 뜨면 재배치 또는 우선순위 조절.

기존 Rule Workbench의 intent 추가 플로우를 재사용한다. Edit intent 워크벤치는 트리 구조에 맞춘 재설계 여지가 있음 — **후보 풀을 전체 로그가 아닌 부모 집합으로 스코프**, 형제 shadowing 표시, **부모 rule 대비 diff 뷰** 등. *(구상 중, §6.4)*

## 6. 미결 / 검증 항목

1. **Type 분류 재평가** — 치환 적용 상태로 NIRVANA human type 라벨 대비 재측정 (기존 평가 인프라로 스크립트 1개). 이 설계의 전제 조건.
2. **다중 활동 tie-break 발동률 측정** — 디섹션이 이미 request 단위 분해를 하므로, request 2+ 이고 서로 다른 type에 걸치는 메시지 비율을 NIRVANA에서 계산. 몇 % 수준이면 규칙 하나로 충분, 두 자릿수면 UI 표시 고려.
3. **Drafting-wins 실사용 검증** — 실제 유저 사용 방식 관찰 후 확정.
4. **Edit intent 워크벤치 재설계** — §5 참조, 구상 중.
5. **Study 스펙 영향 정리** — 커버리지 지표 의미 변화(Overlaps 버킷 소멸, Unassigned → type별 else 잔여), 프리셋/스타터 세트 폐기에 따른 baseline 조항 재점검, Stage-0 평가 프레임(boundary 범주 전제) 재구성.
6. *(선택)* **Judge ensembling** — 체인에서는 앞 노드의 판정 flip이 뒤 전체 라우팅을 바꾸므로, 다수결 3–5× ensembling의 가치가 v6보다 커짐.

## 7. 참고

- 공유용 영어 설명 자료: `docs/SCORE_intent_tree_explainer.html` (그림 + 텍스트, collaborator용)
- 선행 문서: `docs/SCORE_v6_remaining_work.md`(대체됨 — 분류/배정 층), `docs/SCORE_classifierA_vs_human_eval.md`(type 분류 구 평가), `docs/STUDY_BASELINE_SPEC.md`(영향받음)

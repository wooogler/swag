# v7 타입 분류기 평가 (설계 §6.1 게이트)

실행 2026-08-02 · NIRVANA · `gpt-5.4-mini`, effort low · 스크립트 `scripts/score/type-eval.ts`,
`type-stability.ts`, `multi-activity-rate.ts` · 원자료 JSON은 스크래치패드(재실행으로 재생성 가능)

> ## v2 결과 (프롬프트 수정 후, 2026-08-02)
>
> | Arm | v1 | **v2** | Δ |
> |---|---|---|---|
> | with dissection | 71.6% / κ0.605 | **78.5% / κ0.697** | +6.9%p |
> | **without** (라이브 경로) | 71.0% / κ0.595 | **79.5% / κ0.708** | **+8.5%p** |
>
> **drafting recall 49% → 82%**(without arm, 100/122). 아래 §3에서 진단한 프롬프트 모순을 제거한
> 것만으로 게이트를 통과했다: 라이브 경로 79.5%/κ0.708은 구 Classifier A(79.2%/κ0.72)와 **동등**
> 하며, 26-subtype few-shot + null 탈출구가 있던 그 계측기와 달리 **4지선다 강제 선택**으로 낸
> 숫자다.
>
> 대가도 있다 — reviewing이 93% → 80%로 내려갔다(13건이 drafting으로). 경계를 옮겼으니 예상된
> 방향이고, 순효과는 크게 플러스다. 또 하나: **디섹션 steer가 있는 쪽이 오히려 0.1~1%p 낮다.**
> 두 번의 측정 모두에서 steer의 기여는 없거나 음수였고, 이는 "라이브 경로가 배치 경로보다 불리
> 하다"는 설계의 걱정이 **근거 없음**을 뜻한다.
>
> v2 혼동행렬(without):
> ```
> gold \ pred     planning  translating  reviewing  drafting
> planning              72            0          2         9
> translating            4           15          2        10
> reviewing              3            3         76        13
> drafting              11            6          5       100
> ```
> 남은 약점은 **translating 48%**(31건 중 15건)이다. 주로 drafting(10)으로 새며, 문단 규모 판단이
> 어려운 경계다. §6의 후속 선택지가 여기에 적용된다.
>
> 아래는 수정 전(v1) 측정과 그 진단 — 무엇이 왜 틀렸는지의 기록으로 남긴다.
>
> ---
>
> **결론 먼저(v1)**: 인간 코딩과의 원 일치도는 **71.6%(κ=0.605)** 로, 구 Classifier A의 79.2%(κ=0.72)
> **아래**다. 그리고 **치환/디섹션 steer의 기여는 0.6%p에 불과**해 "치환이 정확도를 많이 올렸을
> 것"이라는 전제는 **반증**됐다. 다만 오류의 절반가량은 모델의 혼동이 아니라 **v7 프롬프트 자체의
> 내부 모순**에서 나오며, 그 부분은 고칠 수 있다.

## 1. 정확도

| Arm | n | 정확도 | Cohen's κ | 비고 |
|---|---|---|---|---|
| **with** dissection | 331 | **71.6%** | 0.605 | instructor 배치 경로가 받는 값 |
| **without** dissection | 331 | **71.0%** | 0.595 | **라이브 학생 메시지가 받는 값** |
| (참고) 구 Classifier A | — | 79.2% | 0.72 | 치환 이전, 26-subtype few-shot, null 탈출구 있음 — 다른 계측기 |

- 361 gold 중 347 조인(14건 미매치), 그중 인간 코딩된 331건으로 채점. 미코딩 18건은 별도 보고(강제
  4지선다에는 "none"이 없으므로 오류로 세지 않음).
- **디섹션 steer의 효과는 0.6%p.** 설계가 기대한 "치환이 옛 숫자를 고쳐줄 것"은 성립하지 않는다.
  라이브 경로에 디섹션을 붙이는 후속 과제의 근거도 함께 약해졌다.

## 2. 오류가 어디에 있나 (with-arm 혼동행렬)

```
gold \ pred     planning  translating  reviewing  drafting     정답률
planning              75            0          4         4      90%
translating            4           14          5         8      45%
reviewing              3            1         88         3      93%
drafting              22            6         34        60      49%   ← 붕괴 지점
```

planning·reviewing은 90%대로 견고하다. **문제는 drafting(122건 중 60건, 49%)** 이고, 구 평가가
기록한 'All' 누출(Planning 18 / Reviewing 21)이 고쳐지기는커녕 더 커졌다(**Planning 22 / Reviewing 34**).
translating(45%)도 약하다.

## 3. drafting 오류 63건의 정체 — 프롬프트의 내부 모순

인간 subtype별로 쪼개면 한 덩어리가 압도적이다.

| gold subtype | 오분류 | 예측 |
|---|---|---|
| **AL03** | 23 | **전부 reviewing** |
| AL01 | 14 | planning 13, reviewing 1 |
| AL04 | 12 | reviewing 4 · planning 4 · translating 4 |
| **AL06** | 10 | **reviewing 9**, planning 1 |
| AL05 | 4 | planning 3, reviewing 1 |

AL03/AL06/AL05은 **"챗봇이 방금 만든 글을 다시 써 달라"** 계열이다. 실제 rationale:

- `[AL03→reviewing]` "Requests rewriting existing essay with added perspectives" — *"rewrite the essay adding more to the utilitarian and dystopian perspectives"*
- `[AL03→reviewing]` "Requests rewriting existing text to a simpler style" — *"make it sound like a 10th grader"*

`type-prompts.ts`를 보면 두 정의가 같은 쿼리를 가리킨다:

- **drafting**: "…또는 **챗봇 자신이 만든 텍스트를 재생성·재작성·크기 조정**"
- **reviewing**: "**이미 존재하는 텍스트**를 평가·수정 — … 사양에 맞춰 재작성 …"

그리고 내가 쓴 tie-break 규칙 **"이미 존재하는 텍스트가 있으면 reviewing"** 이 drafting 조항을
정면으로 덮어쓴다. 즉 모델은 프롬프트를 **정확히 따른 것**이고, 프롬프트가 자기모순이다.

이 계열(AL03 23 + AL06 9 + AL05 1 ≈ **33건**)을 "v7 정의상 reviewing이 맞다"고 보면 일치도는
**71.6% → 약 81.6%** 가 된다. 즉 **원 71.6%는 절반이 모델 혼동, 절반이 코딩 스킴 경계 차이**다.

AL01(14건 → 대부분 planning)은 다른 문제다: 학생이 과제 프롬프트를 통째로 붙여넣고 "이 관점을
어떻게 옹호할까"류를 묻는 경우로, 분류기가 "글 생성 요청이 아니라 주제 질문"으로 읽는다. 디섹션이
있어도 잡히지 않았다.

## 4. 안정성 — 문제 없음

20쿼리 × 5반복: **20/20 만장일치, flip 0.** intent judge(만장일치 76%, 결정 flip 5.4% —
[score-stability-report](score-stability-report.html))보다 훨씬 안정적이다. 타입 판정이 메시지당
평생 1회 캐시된다는 점을 고려하면 이 축은 안전하다. **정확도 문제이지 노이즈 문제가 아니다.**

## 5. 다중 활동 — 설계가 "UI 표시 고려" 하라던 구간

- 348건 중 57건(16.4%)이 요청 2개 이상, 그중 **34건이 서로 다른 타입에 걸친다 = 로그의 9.8%**
- **Drafting-wins 규칙을 분류기가 절반(16/34, 47%)만 따른다.** 나머지는 지배적 활동을 고른다
  (`reviewing+planning → reviewing`, `reviewing+translating → reviewing`).
- 흥미롭게도 규칙을 어긴 쪽이 더 타당해 보이는 경우가 많다 — 계획 질문이 딸린 교정 요청은
  reviewing이 맞다.

설계 §6.2의 기준("몇 % 수준이면 규칙 하나로 충분, 두 자릿수면 UI 표시 고려")에서 **두 자릿수 쪽**이다.

## 6. 이 결과가 설계에 갖는 의미

설계 §3.1은 **"Type 게이트 오류는 하위에서 복구 불가능하므로 이 실험이 설계의 전제 조건"** 이라고
못 박았다. 그 전제에 비추면:

- planning/reviewing(전체의 약 2/3)은 90%대로 **안전**하다.
- drafting은 현재 상태로 **위험**하다. drafting 쿼리의 절반이 다른 타입으로 가면, 강사가 Drafting
  안에 만든 intent가 그 절반에 영원히 닿지 않는다 — 조용히, 진단 없이.

**우선 시도할 것(저비용)**: `type-prompts.ts`의 모순 제거 — reviewing은 **학생 자신의 텍스트**로
한정하고, **챗봇이 생성한 텍스트에 대한 재작성·재생성은 drafting**으로 명시. tie-break 문장도
그에 맞게 고친다. 이건 프롬프트 3줄 수정 + `TYPE_CLASSIFIER_VERSION` 1→2 bump이고, 마스터 2개
재타이핑(855콜, 클론은 복사라 무료)이면 끝난다. 위 분석대로면 81% 부근이 기대치다.

**그래도 남는 질문**: AL01 계열(과제 프롬프트를 붙여넣은 에세이 작성 요청)과 translating(45%)은
프롬프트 수정만으로 해결되지 않을 수 있다. 그 경우의 선택지는 (a) 4-type 경계를 v7 라우팅 목적에
맞게 재정의(연구 코딩 스킴을 그대로 쓰지 않는다), (b) drafting/translating을 합치는 3-type,
(c) 타입 오분류를 강사가 교정할 수 있는 수단(쿼리를 다른 타입으로 옮기기)을 UI에 추가 — 이건
"게이트 오류 복구 불가"라는 전제 자체를 완화한다.

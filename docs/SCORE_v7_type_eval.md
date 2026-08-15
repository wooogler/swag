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


---

## 7. 검증된 반증 — "네 타입을 점수화해서 argmax" (2026-08-02)

**가설**: 지금은 모델이 하나를 골라 답한다. v1 실패가 "기존 텍스트가 있네 → reviewing" 하고
**멈춰버린** 모양이었으므로, 네 타입을 각각 0–10으로 점수화하고 argmax를 취하면 헷갈리는 쌍을
명시적으로 비교하게 되어 더 나을 것이다.

**실측 (동일한 331건, v2와 같은 정의·같은 경계 규칙을 점수화 프롬프트에 그대로 이식)**:

| 방식 | with dissection | **without** (라이브 경로) |
|---|---|---|
| **pick-one (현행)** | **78.5% / κ0.697** | **79.5% / κ0.708** |
| score-all-four + argmax | 70.4% / κ0.590 | 71.0% / κ0.600 |

**8%p 이상 나빠진다.** 그리고 무너지는 지점이 v1과 똑같다 — drafting recall이 82% → 52%로
되돌아가고(122건 중 63건), planning 27건·reviewing 26건으로 샌다.

**해석**: 독립 점수화는 *"이 타입이 부분적으로라도 맞나?"* 를 묻게 만든다. 기존 텍스트를 건드리는
요청은 reviewing에, 질문 형태의 요청은 planning에 각각 부분 점수가 붙고, argmax는 그 부분 일치
중 하나를 고른다. **강제 단일 선택이야말로 모델이 지배적 해석에 커밋하게 만드는 장치**였다.
경계 규칙을 프롬프트에 똑같이 넣어도 이 효과는 회복되지 않았다.

→ 실험 코드는 되돌렸다. 새로운 근거 없이 재시도하지 말 것 (`type-prompts.ts` 헤더에도 기록).


## 8. 다중 활동 tie-break — 규칙을 명시하려던 세 번의 시도, 전부 실패 (2026-08-02)

§5에서 "Drafting-wins 규칙을 분류기가 절반(16/34)만 따른다"고 적었다. 규칙과 행동이 어긋나 있으니
규칙을 실제 행동에 맞춰 명시하는 게 맞아 보였다. **틀렸다.**

### 먼저: 어긋남의 정체

34건을 쪼개면 분류기의 행동은 무작위가 아니라 **완벽하게 조건부**였다.

| 요청 조합 | 건수 | drafting이라 답함 |
|---|---|---|
| prose(=drafting) 요청이 **포함됨** | 19 | **16** |
| prose 요청이 **없음** | 15 | **0** |

그리고 인간 코더도 같은 방향이었다 — prose 없는 15건 중 **11건(RE 9, TR 2)** 을 drafting이 아니라고
코딩했다(AL 4건만 drafting). 규칙대로 15건 전부 drafting을 강제했다면 인간과 4/15만 맞았을 것을,
분류기는 규칙을 어김으로써 **10/15** 를 맞췄다.

### 시도와 결과

조건부 규칙을 프롬프트에 써 넣었다(두 가지 어순으로).

| 문구 | with | **without** | 규칙↔행동 일치 |
|---|---|---|---|
| **v2: 무조건 "answer drafting"** (현행) | **78.5% / κ0.697** | **79.5% / κ0.708** | 31/34 = 91% |
| v3: 조건부, "reply가 대부분 무엇인가" 우선 | 78.2% / 0.694 | 78.5% / 0.696 | 21/33 = 64% |
| v3b: 조건부, "prose가 지배한다" 우선 | 77.9% / 0.689 | 77.9% / 0.687 | — |

**명시할수록 나빠졌다.** v3에서는 prose가 있는데도 drafting을 고르지 않는 경우가 늘었고
(16/19 → 9/21), 어순을 뒤집은 v3b도 회복되지 않았다. 조건 절을 추가하는 것 자체가 지배 조항의
구속력을 희석시킨다.

§7의 점수화 실험과 합치면 같은 결론을 가리킨다: **이 분류기는 무디고 단호한 지시에서 가장 잘
작동하고, 뉘앙스를 더할수록 커밋이 풀린다.**

### 결론 — 프롬프트가 아니라 문서를 고친다

v2 문구로 되돌렸다(`TYPE_CLASSIFIER_VERSION`도 2로 복귀 → 캐시된 855행 그대로 유효, 재스윕 불필요).

이것은 §3의 v1 모순과 **성격이 다르다**. v1은 두 정의가 서로 충돌해 모델이 나쁜 규칙을 **따랐고**
8%p를 잃었다. 여기서는 규칙이 과장이고, 모델의 이탈이 **체계적으로 옳다**(prose 없는 15/15을
정확히 비-drafting으로). 즉 위험한 지뢰가 아니라 **문서와 실제의 불일치**다.

따라서 고칠 곳은 설계 문서다. 실제 동작은:

> **다중 활동 tie-break(실측)**: 요청 중 하나라도 에세이 산문 생성이면 → drafting.
> 그렇지 않으면 텍스트를 실제로 다루는 요청(reviewing/translating)이 이기고, 글에 *대해* 묻기만
> 하는 요청(planning)은 진다.

프롬프트에는 앞줄만 쓰여 있고 뒷줄은 모델이 알아서 한다. 뒷줄을 쓰려는 시도는 측정상 손해였다.


## 9. 컨텍스트 절제(ablation) — 남은 격차는 정보 비대칭이 아니다 (2026-08-02)

**문제 제기(사용자)**: 인간 코더는 주로 **타겟 쿼리를 보면서** 라벨링했는데, 우리 분류기는 직전
학생 메시지 + 직전 봇 응답까지 받는다. 정보가 다르니 불일치의 일부는 분류기의 오류가 아니라
비대칭일 수 있다.

실제로 어긋남은 **양방향**이었다. CSV는 `Inquiry, Response, Code` 이므로 코더는 **그 쿼리가 받은
응답**을 보았고, 이는 우리 분류기가 설계상 절대 보지 않는 것이다(`prompts.ts`: 뒤따르는 봇 응답은
전송하지 않음). 반대로 우리가 주는 **직전 턴**은 코더가 보지 않았다. 그래서 네 가지 입력 조건을
같은 331건에 돌렸다.

| arm | 분류기가 받는 입력 | 정확도 | κ | drafting recall |
|---|---|---|---|---|
| with | 직전 턴 + 디섹션 | 78.5% | 0.697 | 94/122 |
| **without** (현행 라이브) | **직전 턴만** | **79.5%** | **0.708** | 100/122 |
| queryonly | **타겟 쿼리 단독** | 77.9% | 0.690 | 89/122 |
| response *(진단용)* | 쿼리 + **그 쿼리가 받은 응답** = 코더의 시야 | **79.5%** | **0.708** | 101/122 |

### 결론 세 가지

1. **쿼리 단독은 오히려 나쁘다(-1.6%p).** 가설과 반대다. 손실은 거의 전부 drafting에서 나온다
   (100 → 89, reviewing 오분류가 9 → 17). 당연한 이유가 있다 — §3에서 고친 경계는 **"누구의
   텍스트인가"** 인데, *"make it sound like a 10th grader"* 만 보고는 그 글을 누가 썼는지 알 수
   없다. 직전 턴이 있어야 봇이 쓴 글임을 안다. **직전 턴은 이 경계를 판정하는 데 필요한 정보다.**
2. **코더와 똑같은 것을 보여줘도 점수가 그대로다(79.5% / κ0.708, 현행과 동일).** 즉 남은 ~20%는
   **정보 비대칭이 아니다.** 정보를 줄이든(쿼리 단독), 코더와 같게 맞추든(쿼리+응답), 런타임처럼
   주든 일치도는 77.9–79.5%의 좁은 띠 안에 머문다. 격차의 정체는 **판정/스킴 차이**다.
3. **현행 런타임 구성이 시험한 넷 중 최선이다.** 직전 턴을 주고 디섹션은 주지 않는 조합 —
   이제 가정이 아니라 측정된 사실이다.

부수적으로: `response` arm은 planning을 희생한다(75 → 68, 12건이 drafting으로). 응답이 에세이
산문이면 요청을 글 생성으로 읽게 되기 때문이다. 코더가 가진 정보에도 그 나름의 편향이 있다는
뜻이라, "코더와 같은 것을 보여주는" 것이 곧 정답률 상승은 아니다.

→ 코드 변경 없음. 런타임은 이미 최선의 구성을 쓰고 있다. `type-eval.ts`에 `queryonly`/`response`
arm을 남겨 두었으니 재현 가능하다(`npx tsx scripts/score/type-eval.ts out.json "" all`).


## 10. v3 실측, 그리고 논문을 다시 훑어 찾은 것 (2026-08-15)

§1–§9는 전부 **v2 프롬프트**의 숫자다. v3(`2658ab9`, substance-first + scale-as-cap)은 커밋
메시지에만 수치가 남아 있었고 이 문서는 갱신되지 않았다. 여기서 그 격차를 메운다.

계기는 사용자 질문이었다 — 타입 오분류가 많으니 **큐레이션에 한해 상위 모델을 쓰면** 어떤가.
그 답은 §10.4에 있고, 먼저 지금 프롬프트가 실제로 어디서 틀리는지부터.

### 10.1 v3 실측 (라이브 경로, `without` arm, n=331)

| | v2 (§1) | **v3 (현행)** |
|---|---|---|
| 정확도 / κ | 79.5% / 0.708 | **78.2% / 0.696** |
| planning | 72/83 | 74/83 |
| **translating** | 15/31 (48%) | **18/31 (58%)** |
| reviewing | 76/93 | 74/95 |
| drafting | 100/122 | 93/122 |

```
gold \ pred     planning  translating  reviewing  drafting
planning              74            3          2         4
translating            5           18          3         5
reviewing              4            6         74        11
drafting              11            7         11        93
```

v3 커밋이 예고한 그대로다: **전체는 77–79% 띠 안(노이즈), translating만 실질 개선.** 새 회귀 없음.

### 10.2 기각된 두 가지 — 논문 산문에 있고 데이터에는 없다

**(a) "내용을 바꾸나 표현을 바꾸나" 축.** 논문 §4.1.2는 `[문단] make this paragraph stronger`를
TR01(translating)로, §4.1.3은 `Make this sound more professional`을 RE06(reviewing)로 든다.
구별 불가능해 보이는 두 예시라 프롬프트가 "general improvement"를 reviewing에 넣은 것이 실책으로
보였다. **아니다.** 우선 그 TR01 예시는 recoded CSV에 그 코드로 **존재하지 않는다**(논문 표와
채점 gold가 다르다). 그리고 gold에서 `make it better` 계열이 실제로 갈리는 기준은 딱 하나였다:

```
[RE06] make it better for an essays introduction "With the increase of..."     ← 학생 글 붙여넣음
[RE06] can you make it better for the first idea "When many technologies..."   ← 학생 글 붙여넣음
[RE05] Make this sound more professional: I think that automation is...        ← 학생 글 붙여넣음
[AL03] can you make it soujnhd more professional and add more details          ← 붙여넣기 없음(=봇 출력)
[AL03] make it better according to utilitarian view "When we look at..."       ← 봇이 쓴 글
```

**붙여넣은 학생 글이 있으면 RE, 없으면 AL** — §3에서 세운 WHOSE TEXT 규칙과 정확히 일치한다.
프롬프트가 맞다.

**(b) 질문형 → drafting 규칙이 과하다는 의심.** 논문 PL01에 과제 프롬프트를 복사한 질문이
Planning으로 코딩된 예(P36)가 있어 이 규칙이 planning을 9건 잡아먹는 원인으로 보였다. 그러나
gold에는 `How would I as a gen z college student defend the first utilitarian view...` = **AL01
(drafting)** 이 있다. 프롬프트에 실린 예시가 곧 gold다. **규칙이 맞다.**

### 10.3 확인된 결함 하나 — 게이트 절이 자기 나열 항목을 부정한다

translating이 아니라 **한 단어짜리 질문**이 문제다. 하위코드별로 재분류해 보면:

| 코드 | 내용 | 정답 |
|---|---|---|
| **TR04** | 어휘·표현 질문 | **0/5** |
| **RE02** | 맞춤법·문법 질문 | 8–9/11 *(어느 건이 새는지가 실행마다 바뀜)* |
| TR02 | 미완성 문장 완성 | 9/11 |
| TR03 | 아이디어 주고 문장 | 5/6 |
| TR01 | 아이디어 주고 문단 | 2/8 |

TR04는 **전부 planning으로** 간다. rationale이 매번 같은 말을 한다:

- `Give me a word for negatively affecting` → *"Asks for a synonym, not essay content."*
- `sysnonyms for "for example"` → *"Asks for word alternatives, not writing text."*

RE02도 같은 병이고, 더 나쁜 증상이 있다 — 같은 모양인데 **판정이 실행마다 뒤집힌다**
(1회차 `how do you spell exaggeration` 오답, 2회차 `how to spell sufisticated` 오답,
`how do you spell maintaince`는 두 번 다 정답). 정의가 결정을 못 해주니 모델이 동전을 던진다.

원인은 하나다. **두 정의 모두 첫머리 게이트가 자기 나열 항목을 배제한다:**

- translating: *"...turn it into **usable text at paragraph scale or smaller**"* ↔ 나열엔
  "suggesting wording and word choice". 단어 하나는 "usable text"가 아니다.
- reviewing: *"evaluate or revise **THE STUDENT'S OWN WRITING — text they wrote themselves**"* ↔
  나열엔 "a spelling or grammar question". `spell egregious`엔 글이 없다.

**§3의 v1 모순과 구조가 같다.** 그리고 고치는 방식도 §7·§8이 실패한 "조건 절 추가"가 아니라
**모순 제거**라 희석 위험이 없다. 규모는 7–8건/331 ≈ **2%p**.

### 10.4 그럼에도 지금은 고치지 않는다 (사용자 결정, 2026-08-15)

배포 비용이 커밋 `5983c8d`(스터디 생성이 얼린 타입으로 라우팅) 이후 올랐다:

> `TYPE_CLASSIFIER_VERSION` 3→4 → 마스터 2개 재타이핑(~855콜) → 뱅크 재빌드 →
> **클론 재프로비저닝**. 건너뛰면 `scripts/study/check-type-routing-parity.ts`가
> clone≠master로 잡아낸다(그게 그 스크립트의 목적이다).

유저스터디 직전에 2%p를 위해 치를 값이 아니다. **다른 이유로 버전을 올릴 때 §10.3의 모순 제거를
같이 넣는다.** 두 정의의 게이트 절에 "붙여넣은 글이 없는 순수 어휘·맞춤법 질문도 포함"을 여는
정도이고, 새 규칙을 더하는 것이 아니다.

**모델 상향(사용자 최초 질문)도 하지 않는다.** §4가 이미 기록했듯 이 축은 노이즈 문제가 아니라
정확도 문제이고, §10.3이 보여주듯 남은 오류의 성격은 모델 용량이 아니라 **정의의 자기모순**이다.
더 센 모델이 모순을 대신 풀어주지는 않는다. 또 큐레이션에만 상향하면 표시용 타입과 라우팅용
타입이 갈라지는데, 그 문제는 `5983c8d`가 모델을 바꾸지 않고 이미 닫았다.

### 10.5 계측 오염 — 앞으로 예시를 넣을 때의 주의

현행 프롬프트에 박힌 인라인 예시 9개 중 **6개가 채점 코퍼스에서 온 실제 쿼리**다. 대부분 v1
오류 분석에서 뽑힌 것이다:

| 프롬프트의 예시 | gold |
|---|---|
| `make it sound like a 10th grader` | AL03 (완전 일치) |
| `make it longer` | AL06 (완전 일치) |
| `write an intro sentence that says this paper claims X` | TR01 |
| `how would I defend the utilitarian view?` | AL01 |
| `analyze my paragraph against the utilitarian view` | AL04 |
| `rewrite it adding the dystopian view` | AL03 |

따라서 **78.2%는 약간 낙관적**이다. 몇 건 수준이라 결론은 바뀌지 않지만, 언젠가 few-shot 예시
블록을 시도한다면(§1–§9 어디서도 시험한 적 없는 유일한 레버다 — 구 Classifier A는 26-subtype
few-shot으로 79.2%/κ0.72였다) **예시로 쓴 행은 채점에서 제외해야 한다.**

→ 코드 변경 없음. §10.1 재현: `npx tsx --env-file=.env scripts/score/type-eval.ts out.json 0 without`.
§10.3의 하위코드별 분해는 일회용 스크립트로 냈고 남기지 않았다 — `type-eval.ts`가 집계만 쓰고
행별 예측을 JSON에 담지 않으므로, 다시 필요하면 gold 코드로 필터해 `classifyMessageType`을
직접 부르는 40여 콜짜리를 새로 쓰면 된다.

# SCORE 유저스터디 — 통합 설계 문서

**작성:** 2026-08-18 · **상태:** 파일럿 1회 완료, 본 세션 전 · **대상 독자:** 연구자 본인, 어드바이저, **시스템 구현 세션**

> **이 문서의 지위.** 유저스터디에 관한 **단일 독립 문서**다. 설계 근거 · 세션 프로토콜 · **참가자에게 제시되는 모든 텍스트 원문** · 측정 · 분석 · **시스템 요건**을 한 곳에 담는다. 다른 문서를 열지 않고 이것만으로 스터디를 구현하고 진행할 수 있어야 한다.
>
> **시스템 문서와의 관계.** `SCORE_BASELINE_DESIGN.md`(as-built, 08-05)는 **"지금 무엇이 어떻게 동작하는가"**의 기준이고, 이 문서는 **"스터디를 위해 무엇이 더 필요한가 · 무엇을 어떻게 진행하는가"**의 기준이다. 시스템 동작 서술이 어긋나면 **as-built 문서와 코드가 이긴다.**
>
> **연구 폴더의 사료.** 결정의 경위·대안 검토·문헌 대조는 연구 폴더(`Cowork/SCORE/study/`)에 남아 있다 — `USER_STUDY 설계 v2.md`(v2.1) · `USER_STUDY 문항지 v1.md` · `최종 설문 설계 v1.md`(v1.4) · `USER_STUDY 진행자 런북 v1.md` · `USER_STUDY 설계 (진행 중).md`(결정 로그 §1~19) · `설문 위치·문항 검토 메모.md` · `RQ2_construct_memo.md`. **이 문서와 충돌하면 이 문서가 최신이다.**
>
> **표기.** **[파일럿]** = 파일럿에서 확정 · **[운영]** = 연구팀 운영 결정 필요 · **[구현]** = 시스템에 만들어야 함(§10에 모아 둠).

---

## 1. 한눈에

| 항목 | 내용 |
|---|---|
| 형태 | **전원 Zoom 동기 세션**, 진행자 배석, 1회 **약 92분**, **참가자 내 설계**(모든 참가자가 두 조건을 모두 사용) |
| 참가자 | 대학·중등 글쓰기 지도 경험이 있는 교수자 **16명** 분석(18명 모집) |
| 조건 | **Slate**(intent–rule) vs **Clay**(단일 Rules 문서) — 차이는 **수정이 적용되는 범위** 하나뿐 |
| 재료 | 실제 학생–챗봇 로그 2셋: **SWAG**(507 질문) · **NIRVANA**(348 질문) |
| 접근 | **질적 중심.** 지각 측정 + 구조화된 UI 프로브(텍스트 박스) + 행동 기록. **블라인드 A/B 없음** |
| 주 측정 | 블록 테스트(예측→공개→판정→프로브, 2-pass) · 최종 설정 아티팩트 분석 · 인터뷰 |
| 보상 | **$60** / 약 90분 |
| IRB | **24-325 amendment** |
| 사전 과제 | 없음 — 폼 2종만(스크리너 ~2분, 동의서+배경 ~5분) |

**세션 골격 (분:초)**

```
0:00  시작·동의 재확인·녹화 시작·인트로                      3분
0:03  블록 1 튜토리얼 — 데모 영상 ⓐ공통 + ⓑ/ⓒ 버전          4분
0:07  블록 1 설정 작업 (과제 화면 → 25분 상한)              25분
0:32  블록 1 작업 부하 설문 (NASA-TLX 5문항)                 1분
0:33  블록 1 블록 테스트 (Pass 1 예측 8 → Pass 2 공개·판정 8) 8분
0:41  휴식                                                  2분
0:43  블록 2 튜토리얼 — 다른 버전 세그먼트만                  3분
0:46  블록 2 설정 작업                                      25분
1:11  블록 2 작업 부하 설문                                  1분
1:12  블록 2 블록 테스트                                     8분
1:20  최종 설문 (두 버전 side-by-side)                       4분
1:24  인터뷰                                                8분
1:32  디브리핑·보상·녹화 종료                                2분
```

---

## 2. 연구 질문과 측정 철학

### 2.1 배경

기존 챗봇 설정 방식은 **하나의 긴 텍스트 프롬프트를 고치는 것**이다. 이 방식에는 도구를 아무리 잘 만들어도 사라지지 않는 두 어려움이 있다 — 사용자는 챗봇이 왜 그렇게 행동했는지를 프롬프트에서 읽어낼 수 없고, 상위 모델의 도움을 받더라도 자기 의도를 프롬프트에 정확히 반영하기 어렵다. 우리는 이것을 monolithic 프롬프트라는 **표현 형식 자체의 문제**로 본다.

SCORE는 divide & conquer로 접근한다. 사용자는 자연어 정의로 intent를 만들고 예제로 범위를 조정하며, 그 intent에 걸리는 질문들에 적용될 rule을 붙인다 — **"언제(intent)"와 "그때 어떻게(rule)"를 나눠서** 다루게 한다.

**핵심 전제: 교수자마다 어떤 학생 질문에 챗봇이 어떻게 행동하길 바라는지가 다르다.** 따라서 좋은 응답의 기준은 연구자가 정할 수 없고 각 교수자 자신에게서 나온다. **이 스터디의 모든 측정은 "객관적으로 좋은가"가 아니라 "그 교수자의 의도에 맞는가"를 잰다.**

### 2.2 연구 질문

교수자가 실제 학생–챗봇 로그를 근거로 PCA의 행동을 자신의 의도에 맞게 설정하는 상황에서:

- **RQ1 (Organization).** 교수자는 실제 로그로부터 자신의 의도를 어떻게 설정으로 조직해 가는가 — 그리고 표현 형식은 **어떤 의도가 표명되어 설정에 담기는지**를 어떻게 바꾸는가?
- **RQ2 (Comprehension).** 두 표현에서 교수자는 자신의 설정이 새 질문에 무엇을 할지를 얼마나 정확히 **예측**하고, 그 행동을 만들 설정의 부분에 얼마나 정확히 **귀속**하며, 그 행동을 어떻게 **서술**하는가 — 곧 자기 설정에 대한 mental model은 얼마나 정확한가?
- **RQ3 (Alignment).** 두 표현으로 만든 설정은 설정 중 보지 않은 **새 학생 질문**에서 교수자의 의도와 얼마나 부합하며, 어긋날 때는 **어디서·어떤 양상으로** 어긋나는가?

*English:* In the context of instructors configuring a PCA's behavior to match their intent based on real student interaction logs, we ask: **RQ1 (Organization).** How do instructors organize their intent into a PCA configuration as they review real interaction logs — and how does the representation shape which intents become articulated in it? **RQ2 (Comprehension).** In each representation, how accurately do instructors predict what their configuration will do on new questions, how accurately do they attribute that behavior to parts of the configuration, and how do they describe it — that is, how accurate is their mental model of their own configuration? **RQ3 (Alignment).** How well do configurations authored in each representation match the instructor's intent on new student questions, and where and in what ways do they diverge?

**세 RQ = intent–configuration–behavior 삼각형의 세 엣지.** intent→configuration(articulation)은 RQ1 후반절, configuration→behavior(comprehension)는 RQ2, intent↔behavior(alignment)는 RQ3. 겹침 없이 하나씩이다.

### 2.3 왜 질적 중심이고 왜 A/B가 없는가

블라인드 A/B(같은 질문에 두 설정의 응답을 나란히 놓고 고르기)는 **"두 설정이 같은 의도를 인코딩했다"**를 전제한다. 그런데 이 연구의 가설 자체가 **표현 형식이 어떤 의도를 이끌어내는지를 바꾼다**는 것이다(RQ1 후반절). 전제와 가설이 충돌하므로 A/B는 주 측정이 될 수 없고, 같은 논거가 **모든 조건 간 정량 비교**에 정도의 차이만 두고 적용된다.

**귀결:** 조건 간 수치 비교는 **기술통계 + 효과크기의 보조 지표**로 내리고, **질적 분석**(참가자의 판정·설명·예측 행동·최종 아티팩트)을 주된 답으로 삼는다. **평가는 시스템이 아니라 문항에 묶는다** — "이 도구가 좋았나"가 아니라 "이 답이 당신이 원한 답인가".

### 2.4 RQ2 construct — comprehension의 정의와 근거

**construct는 하나다: comprehension = 자기 설정에 대한 mental model의 정확도.** 참가자가 자신의 설정 표현으로부터 새 질문에 대한 챗봇의 행동을 (a) **서술**하고, (b) 의도 부합 여부를 **예측**하고, (c) 그 행동을 만들 설정의 부분에 **귀속**할 수 있는 정도.

정의의 뿌리는 **Rouse & Morris (1986)**: *"Mental models are the mechanisms whereby humans are able to generate **descriptions** of system purpose and form, **explanations** of system functioning and observed system states, and **predictions** of future system states."* 블록 테스트 Pass 1의 세 문항(**포인팅 → 서술 → 짐작**, 08-18 개정 — §5.4)이 이 세 성분의 조작화다 — 제시 순서는 R&M의 나열 순서를 따르지 않는다 — 단 조작화는 R&M의 것이 아니라 **XAI/EUP 실무**의 것이다(R&M 본론은 mental model 측정의 근본 한계론이므로 **정의만** 인용). Interpretability 용어로는 **simulatability**, 측정 과제는 **forward simulation**(Chromik et al. 2021).

**측정 변인.** V1 **예측 정확도**(짐작 예/아니오 ↔ 5점 판정을 3점 이하='아니오'로 접어 대조) · V2 **귀속 정확도**(포인팅 ↔ Slate는 `appliedIntentId`로 **객관 채점**, Clay는 지목 양상 코딩) · V3 **서술 부합**(텍스트 서술 ↔ 실제 응답, 2인 코딩) · 파생: **확신 보정**.

> V1은 RQ3와 통계적으로 독립이 아니다(부합도가 높으면 일치율이 base rate만으로 오른다). 그래서 판정 '아니오' 문항에서의 적중률을 함께 보고하고, **V2를 판정과 독립인 유일한 comprehension 앵커**로 세운다.

**같은 construct를 잰 선례.** Kulesza et al. CHI 2012(mental model soundness, 정답 비공개, N=62) · Poursabzi-Sangdeh et al. CHI 2021(simulation error = |m − u_m|, 사전등록 N=3,800, 조작 변인이 '표현') · Chromik et al. IUI 2021(forward simulation 8문항; 결과 확인 **뒤** 자기평가 유의 하락 = IOED) · Bansal et al. HCOMP 2019(error boundary mental model) · Hoffman et al. 2018(prediction task를 mental model 도출법으로 목록화, **confidence rating + free-response elaboration 동반** 권고).

**왜 응답을 보기 전에 재는가.** ① 사후 free-text가 재는 것은 *perceived* understanding이라는 **다른 construct**다(Chromik: 자기평가는 결과 확인 뒤 하락 · Kulesza: 실측 soundness는 갈렸는데 자기평가는 수렴). ② 응답을 본 뒤에는 "예측할 수 있었는가"를 잴 수 없다(hindsight). ③ 구두 보고는 *"what they expect the inquirer wants"*를 반영할 수 있다(R&M 1986). ④ 능력 주장은 행동으로 잰다.

**용어 규율.** RQ2에는 **comprehension만** 남긴다. 통제감·신뢰는 *저작 경험의 주관 지표*로 별도 보고(RQ2와 병치 해석). **confidence**는 확신 보정(calibration)으로만. **부담**은 RQ 밖 비용 지표. **self-efficacy는 측정하지 않으므로 언급하지 않는다.**

### 2.5 RQ → 답하는 방법

| RQ | 어떻게 답하는가 |
|---|---|
| RQ1 (Organization) | 행동 기록(화면 녹화 + DB 상태 + 진행자 관찰 메모) + **최종 설정 아티팩트 분석** + 인터뷰 |
| RQ2 (Comprehension) | **예측 정확도** + **귀속 정확도**(Slate는 실제 라우팅과 대조 = 객관 채점) + **행동 서술 코딩** + 파생: 확신 보정 |
| RQ3 (Alignment) | 블록 테스트 **5점 부합도** + 부합 실패 지점의 **misalignment 유형 코딩** + 사후 "다룬/안 다룬 영역" 분해 |

---

## 3. 두 조건 — Slate와 Clay

### 3.1 명칭 (참가자 대면)

두 버전에 **고정 닉네임**을 붙인다. **Slate = intent–rule(SCORE, 처치) · Clay = 단일 Rules 문서(Baseline, 대조).** 매핑은 **고정**이며 카운터밸런싱하지 않는다.

- **순서 라벨("first/second version")을 쓰지 않는 이유.** 카운터밸런싱 탓에 참가자마다 다른 것을 가리켜 **고정 산출물(데모 영상·설문 템플릿·논문 그림)에 쓸 수 없고**, 참가자가 "두 번째 = 개선판"으로 읽으면 절반이 반대 방향으로 틀리는 **비대칭 오해**가 된다.
- **이 쌍을 고른 이유.** 완전 임의어(Maple/Cedar)는 중립적이지만 40분 뒤 회상이 약하고, 서술형(`Intents / Rules`)은 "intents"가 고유어이고 "Rules"는 일반 명사라 **격식이 어긋난다.** Slate/Clay는 **1음절 자연 재료**로 격식이 평행하고, 서로가 서로의 원료가 아니어서 서열 함의가 없으며(clay → brick은 원료 → 가공이라 탈락), 차이를 **은유 수준에서만** 반영한다 — Clay = 한 덩어리를 주무르면 손대지 않은 쪽이 변형된다, Slate = 자연히 판으로 쪼개진다.
- **이름의 뜻을 절대 설명하지 않는다.** 은유는 연구팀·자료용이고 참가자에게는 코드네임이다. 설명하는 순간 가설 프라이밍이 된다. 물으면: *"They're just labels so we can tell the two apart — nothing behind them."*
- **고정 매핑의 대가와 방어.** 이름 연상이 조건과 교락된다. 방어: ① 연상이 약한 쌍, ② 방향이 오히려 **보수적**(clay = malleable·flexible이면 대조군에 유리, slate = rigid이면 처치군에 불리), ③ 뜻을 설명하지 않음, ④ 논문에 *"the two versions were presented under the opaque code names Slate and Clay, which were never explained to participants"*로 명시.
- **이름이 나오는 곳:** 화면 헤더 칩(`Chatbot Studio · Slate`) · 데모 영상 · 진행자 발화 · 최종 설문 열 라벨 · 인터뷰.
  **나오지 않는 곳:** 모집 메일 · 동의서 · Bookings · **논문 본문**(SCORE / Baseline).
- **[구현]** 헤더 칩은 **설정 가능한 문자열**이어야 한다 — 논문 그림·발표 영상 렌더링 때 `SCORE`로 바꿔 끼운다.

### 3.2 조작 변인 — 수정이 적용되는 범위, 그것 하나

Clay는 Slate의 **ablation**이다. 두 조건은 거의 모든 것을 공유한다 — 질문을 네 유형(Planning / Translating / Reviewing / Drafting)으로 나눠 보여 주는 화면, 자연어 검색, rule 작성을 돕는 상위 LLM 기능, 프리뷰, 배포.

- **Slate.** 유형 안에 **rule을 소유하는 intent**를 만든다. 수정은 해당 intent의 rule에만 적용된다. 질문은 걸리는 intent의 rule을 따르고, 어디에도 안 걸리면 type root의 기본 rule로 간다.
- **Clay.** 챗봇의 행동은 **전역 Rules 문서 하나**가 정하고, 수정은 그 문서 전체에 적용된다. 유형 안에 만들 수 있는 것은 **filter**(저장된 자연어 검색)뿐이며, filter는 아무것도 소유하지 않는다.

런타임에 과제 설명은 프롬프트로 들어가지 않는다 — 문맥은 대화로만 들어간다.

**조건 간 차이의 전체 목록** (as-built §0과 동일; 이것 외에는 동일해야 한다):

| 축 | Slate | Clay |
|---|---|---|
| 조직 객체 | **Intent** = rule을 소유하는 집합. 중첩·first-match·배타 소유 | **Filter** = inert한 저장 검색. 겹침 허용, 아무것도 소유하지 않음 |
| Rule | intent별 + 타입별 else rule | **하나의 Rules 문서** |
| 커버리지 | 보드 상시: 트리 카운트, 스코프별 Uncategorized, shadowing/containment 진단 | 없음 |
| 경계 교정 | correction(in/out/send-here) → **fold**로 definition에 흡수 | 없음 |
| 검토 세트 시드 | Revise 진입 시 edge-case 3개 **자동 시드** | anchor 1개 |
| 버전 | intent config 버전 + rule 버전 + chat deploy 스냅샷 | rule 버전 + coarse prompt 버전 |

### 3.3 예상되는 차이의 세 기제

| 기제 | 내용 | 무엇이 직접 관찰하는가 |
|---|---|---|
| **간섭** | monolithic에서는 한 수정이 손대지 않은 질문의 행동까지 바꾼다 | 부합 실패의 유형 코딩 · 설문 L1·L2 |
| **누적** | 의도가 쌓일수록 문서가 길어지고 안에서 서로 당겨 뒤의 수정이 잘 먹지 않는다 | 부합 실패 유형 · 설문 O1 · 인터뷰 Q4 후속 ② |
| **예측 가능성** | monolithic 사용자는 문서 전체를 머릿속에 돌려야 하지만, intent–rule 사용자는 "이 질문은 어느 intent에 걸리나"로 국소적으로 따질 수 있다 | 블록 테스트 예측 정확도·포인팅 양상 · 설문 P1·L3 |

> **누적은 25분 과제에서 실제로 발생하지 않는다**(문서가 길어질 시간이 없다). 그래서 누적에 대한 주장은 **지각(O1)과 인터뷰 서술**에 근거하며, 그 근거 수준에 맞게 조심해서 쓴다.

---

## 4. 데이터와 세트

**출처.** SWAG — 자체 글쓰기 플랫폼으로 실제 수업에서 수집(AI와 인간관계 토론글 과제, 얇은 코치 프롬프트). NIRVANA — 유사 시스템의 공개 데이터셋(자동화 에세이 과제, 시스템 프롬프트 없음). 질문 수는 DB 기준 **SWAG 507 / NIRVANA 348**.

**큐레이션 원칙.** 애매한(경계) 질문을 일부러 빼지도, 몰아넣지도 않는다. 연구팀 2~3명이 후보 질문에 **독립적으로** subtype을 라벨하고 전원 일치 = "확실", 갈리면 "경계". 전체 로그의 경계 비율을 재고 **모든 세트가 그 자연 비율을 따르게** 한다. 선정 절차와 라벨 일치율은 논문에 그대로 보고한다.

**세트 구성 (파이프라인 순서대로).** A/B 세트는 만들지 않는다.

0. **기채점 NIRVANA 학생 제외.** 참가자 전원은 2026-05 선행 연구에서 **NIRVANA 학생 6명의 에세이를 채점했고 replay는 그 학생들의 ChatGPT 대화를 노출했다.** 그 6명을 해당 참가자의 NIRVANA 세트에서 제외한다(참가자별 채점 배정 기록으로 매칭). 배정 풀이 작아 사실상 고정된 소수 학생만 쓰였다면 **전역 제외**가 훨씬 간단하다(먼저 확인할 것). 77명 중 6명 ≈ 8%.
1. **데모 subtype 격리.** 튜토리얼 영상에 쓸 subtype 하나(두 데이터셋 모두에서 드문 것)를 고르고, 해당 질문을 가진 학생을 **양쪽 데이터셋의 모든 세트**에서 제외한다. 영상에서 만들어 보인 intent가 참가자의 실전 재료에 적용될 수 없게 하기 위함이다(**한쪽만 격리하면 다른 블록에서 재활용 가능하므로 반드시 양쪽**).
2. **검토 세트** — 유형당 **12~15개** [파일럿]. 참가자가 작업 중에 보는 재료. 유형 안에서 서로 다른 subtype이 고루 들어가고, 겉은 닮았지만 다르게 다뤄야 마땅한 질문들이 함께 들어가도록 뽑는다. 두 데이터셋의 개수·유형 구성을 맞춘다(평평 배분 — 실제 분포의 쏠림은 큐레이션 사실과 함께 보고).
3. **블록 테스트 세트** — 데이터셋당 **8개**(유형당 2, 각 유형의 가장 흔한 두 subtype에서 하나씩). 검토 세트와 겹치지 않는다. 두 데이터셋의 테스트 세트는 **문항 성격 구성을 같게** 짠다(시험의 A형/B형).

**문항 제시의 원칙.** 참가자에게 보여 주는 것은 **챗봇이 받는 입력과 동일**하다 — 직전 대화 턴들 + 학생 질문. 참가자가 챗봇보다 많이 알지도 적게 알지도 않는다.

---

## 5. 세션 프로토콜

### 5.0 시작 (0:00, ~3분)

동의는 **사전 폼에서 이미 받았으므로** 여기서는 구두로 재확인만 한다 — 녹화를 시작하는 시점에 화면·음성 녹화를, 사전 폼에서 웹캠에 동의한 경우 웹캠 녹화를 확인한다. 미작성자는 이 자리에서 동의를 받아 진행하되 **배경 데이터는 결측 처리**한다. 동의를 거부하면 세션을 취소하고 보상을 지급하지 않는다.

### 5.1 튜토리얼 — 데모 영상 (0:03 ~4분 / 0:43 ~3분)

**영상 3편으로 나눈다.**

| | 내용 | 길이 |
|---|---|---|
| ⓐ **공통** | 가운데 질문 목록·검색 + 오른쪽 대화 뷰어 — **두 조건이 문자 그대로 같은 화면** | ~1분 |
| ⓑ **Slate** | 왼쪽 트리 + 한 사이클: 보고 있는 질문으로 intent 만들기 → intent 수정(교정→fold) → rule 만들기 → 예제 추가로 rule 수정 → 프리뷰 → 배포 | ~2.5분 |
| ⓒ **Clay** | 왼쪽 Rules 패널·Filters + 한 사이클: 자연어 검색(= filter 저장) → 예제 추가로 rule 변경 → **프리뷰** → 배포 | ~2.5분 |

**블록 1 = ⓐ + 해당 버전 세그먼트 · 블록 2 = 다른 버전 세그먼트만.**

- **ⓑ·ⓒ의 길이 차는 15초 이내**로 맞춘다(패리티). **ⓒ에서 프리뷰 단계를 빠뜨리지 않는다** — 프리뷰는 양 조건 공용 기능이다.
- **왜 영상인가.** 08-10에 교수 의견으로 라이브 시연으로 바꿨으나, 08-18 파일럿에서 **라이브의 변인 통제가 실제로 어렵다는 것이 확인되어** 되돌렸다. 영상은 전원이 **글자 그대로 같은 교육**을 받게 한다.
- **재생은 세션 중 그 자리에서**(사전 발송 없음 — 시청 횟수가 사람마다 달라진다). Zoom 화면 공유 시 **"컴퓨터 소리 공유"를 반드시 켠다.**
- 재생 후 질문은 **기능 위치·조작에 한해** 답하고, 전략 질문("어떤 rule이 좋은가")은 우회한다. 필요하면 진행자가 화면 공유로 그 부분만 다시 보여 준다.
- **데모 재료**는 §4-1에서 격리한 subtype의 실제 대화이고, **데모 rule의 내용은 교육 철학이 실리지 않은 사무적인 것**으로 한다(예: "분량 질문에는 숫자를 짐작하지 말고 과제 안내문을 확인하도록 안내"). 격리해도 rule의 태도는 보이기 때문이다.

### 5.2 설정 작업 (0:07 / 0:46, 25분 상한)

**작업 시작 화면**(타이머 시작 **전**, ~15초)이 먼저 뜨고 [Start]로 진입한다. 작업 내내 상단에 **한 줄 고정 배너**로 과제가 남는다. 원문은 §6.2.

> **왜.** 08-18 파일럿에서 **시스템이 무엇이 과제인지 화면에서 한 번도 말하지 않아** 참가자가 초반에 헤맸다. 초반 헤맴은 **RQ1의 신호가 아니라 노이즈**다 — RQ1이 재려는 변이는 *어떤 의도를 조직하는가*이지 *과제를 이해했는가*가 아니다. 과제를 명시하면 RQ1 측정의 타당도가 **올라간다.**

**원칙: 경계(boundary)는 주되 기준(criterion)은 주지 않는다.**

| 줘야 할 것 (경계) | 주면 안 되는 것 (기준) |
|---|---|
| 무슨 활동인가 — 대화를 훑고, 설정을 고치고, 배포한다 | 몇 개를 봐야 하는가 |
| 어디서 시작해 어디서 끝나는가 | 몇 개를 고쳐야 하는가 |
| **정해진 분량이 없다**는 사실 | 어떤 rule이 좋은가 · 어떻게 조직해야 하는가 |

- **think-aloud는 하지 않는다.** 참가자는 조용히 작업하고, 진행자는 개입 없이 **관찰 메모**를 남긴다(눈에 띈 순간 2~3개 — 인터뷰 회고 프로브의 재료).
- 진행자는 **기능을 못 찾아 막힐 때 위치 안내 한 줄까지만** 개입하고, 전략 조언은 하지 않는다.
- **시간 경고는 20분 시점에 구두로** [파일럿]. **화면에 카운트다운을 표시하지 않는다** — 시각적 타이머는 행동을 바꾸고 TLX의 시간 압박 문항을 직접 오염시킨다.
- **경과 표시는 허용한다** — 보드 헤더에 `12 / 25 min`(경과, 정수 분, 한 가지 흐린 색, 25분을 넘겨도 멈추거나 붉어지지 않음)이 있다. **금지 대상은 남은 시간의 카운트다운**이지 시간을 알 수 있다는 사실 자체가 아니다. 근거: 무엇을 몇 개나 보고 고칠지가 RQ1의 주 측정값인데, **예산이 있는 줄 모르고 한 선택은 자유로운 선택이 아니라 정보 없는 선택**이고 둘은 데이터에서 구분되지 않는다 — 한 intent를 20분간 다듬은 사람이 깊이를 택한 것인지 아무도 말해 주지 않은 마감에 걸린 것인지 알 수 없다. 진행자 발화도 같은 정보를 이미 준다(*"You have up to 25 minutes"* + 20분 경고). **[파일럿]** 이 표시가 W2(시간 압박) 응답을 끌어올리는가 — 끌어올리면 제거하고 구두 안내만 남긴다.

### 5.3 작업 부하 설문 (0:32 / 1:11, ~1분)

배포 직후, **블록 테스트 전**에 **NASA-TLX 하위척도 5개**(신체 제외, 7점, 가중치 없음)를 받는다. 원문은 §6.4.

> **왜 이 자리인가.** ① TLX는 정의상 **과제 직후** 측정이다, ② 배포 직후 테스트 8문항 응답을 백그라운드로 일괄 생성하는 **대기 시간을 채운다**, ③ 아직 아무 피드백도 받지 않았으므로 **Pass 1의 무정보 조건을 해치지 않는다**.

### 5.4 블록 테스트 (0:33 / 1:12, ~8분, 2-pass)

8문항 × 4단계를 **문항별로 돌지 않고 두 번에 나눠 돈다** — Pass 1에서 8문항의 예측을 모두 받은 뒤, Pass 2에서 8문항의 응답을 차례로 열어 판정한다.

**짐작하는 동안에도 판정하는 동안에도 자기 설정 화면(intent 트리 / Rules 문서)은 열려 있다 — 재는 것은 기억력이 아니라 표현의 해독력이다.**

**Pass 1 — 예측 (8문항 연속, ~4.5분, 응답은 열지 않는다).** 문항마다:
1. **포인팅** — Slate: intent 트리에서 클릭 / Clay: Rules 문서에서 **구간 선택** (양쪽 "None"/"Not sure" 버튼 병행)
2. **서술** — 텍스트 박스: "챗봇이 이 질문에 어떻게 답할 것 같은가"(한 구절~한 문장)
3. **짐작** — 예/아니오: "내 설정이 내 의도대로 답할까?"

**왜 포인팅이 먼저인가 (08-18).** 구 순서는 서술 → 짐작 → 포인팅이었다. 08-18 파일럿에서 참가자들은 서술 칸을 지나쳐 **포인팅부터** 하고 돌아와 썼다 — 설정의 어느 부분이 걸리는지를 먼저 정해야 무엇을 예상하는지 쓸 수 있기 때문이다. 그 순서가 §3.3이 세운 **예측 가능성** 기제의 순서와 같다: *"이 질문은 어느 intent에 걸리나"* 로 국소적으로 따질 수 있다는 것이 이 연구의 주장인데, 서술을 먼저 요구하면 재려는 기제를 **끄고** 예측하게 만든다. 방치하면 순서가 참가자마다 갈려 서술이 서로 다른 정보 상태에서 나오고, 세 응답은 Next에서 한 번에 저장되므로 누가 어떤 순서로 답했는지 사후에 알 수도 없다. **대가**는 서술(V3)이 free recall에서 cued 응답이 되는 것이다 — 엉뚱한 곳을 짚으면 서술도 같은 이유로 빗나가므로 **V2와 V3은 독립적인 두 지표가 아니며** "둘이 일치한다"를 증거로 쓰지 않는다(V2가 *판정과* 독립이라는 앵커 지위는 그대로다). 조건 간 cue 크기가 다르다는 점(Slate는 클릭 한 번에 해당 rule이 열리고 Clay는 드래그한 만큼)은 교란이 아니라 측정 대상 그 자체이므로, RQ2의 과제를 **locate-then-predict**로 읽는다. **순서는 화면 배치일 뿐 잠그지 않는다.**

**Pass 2 — 공개·판정 (8문항 연속, ~3.5분).** 문항마다:
2. **공개** — 본인 서술·짐작·포인팅을 **재표시**하고 참가자가 버튼으로 실제 응답을 연다
3. **판정** — **5점 부합도.** 3점 이하면 "무엇이 달랐나?" 텍스트 박스
4. **프로브** — 예측이 빗나간 문항(짐작≠판정, 또는 Slate에서 포인팅≠실제 라우팅)에 **조건부 텍스트 박스**가 열린다

**왜 2-pass인가.** ① **측정 대상의 고정** — 재려는 것은 *저작이 끝난 시점의* mental model인데, 문항별 공개면 2번 문항부터 테스트 중 피드백으로 갱신된 모델을 재게 된다. ② 초반 문항의 응답 품질이 후반 짐작에 주는 오염을 막는다. ③ 확신 보정이 전부 무정보 짐작이 되어 해석이 깨끗해진다. 선례도 무피드백 측정 쪽이다(Kulesza 정답 비공개 · Poursabzi-Sangdeh 테스트 단계 실제값 무공개 · Chromik: 공개가 곧 개입).

**구두 문항이 없다.** 서술·"무엇이 달랐나"·프로브까지 **전부 UI 텍스트 박스**이고 진행자는 두 Pass 모두 **묻지 않고 지켜본다**(표정·"good"·"hmm" 금지). 텍스트로 받으면 verbatim이 문항 ID에 묶여 남고, Pass 2에 본인 문장을 그대로 재표시할 수 있으며, Pass 1에서 응답 힌트가 샐 통로가 사라진다.

### 5.5 최종 설문 (1:20, ~4분)

**두 버전을 나란히 놓고 한 번에** 평정한다 — 진술 11행(저작 경험 8 + 맥락·패리티 3) × 2열 · 양극 비교 5 · 자유서술 2칸. 원문은 §6.5.

> **왜 블록 안이 아니라 말미인가.** ① within-subjects에서 첫 블록의 절대 평정은 **비교 앵커가 없다**. ② 블록 테스트 직후의 평정은 도구 경험이 아니라 **방금 본 8개 응답의 성적**에 끌린다 — 말미면 두 버전이 같은 거리에서 회고된다. ③ 설문 → 인터뷰 순서라 진행자가 **극단·불일치 응답을 프로브**할 수 있고, 자유서술로 **진행자 영향 없는 개인 회고**를 먼저 확보한다. ④ 블록이 행동 측정만으로 깨끗해진다.
>
> **회상 보조.** 참가자의 두 보드는 다른 탭에 그대로 열려 있고, 도입문과 진행자 발화에서 **"돌아가 보셔도 된다"고 명시**한다. 40분 전 경험을 평정하는 이 설계의 가장 약한 고리를 가장 싸게 메운다. **세션 중 어느 탭도 닫지 않는다.**

### 5.6 인터뷰 (1:24, ~8분)

think-aloud 부재를 메우는 **유일한 "왜" 채널**이므로 시간을 지킨다. 넘치면 다른 것을 줄이고 **인터뷰는 줄이지 않는다.** 가이드는 §6.6.

### 5.7 종료 (1:32, ~2분)

디브리핑 → 보상 방식 확인 → 질문 → 녹화 종료.

**시간이 넘칠 때 줄이는 순서:** ① **작업 25 → 22분**(−6분, 가장 큰 레버) → ② 프로브 상한/생략 → ③ 최종 설문 문항 축소(R1 → U3 → T2 → I4 → O1). **인터뷰는 사수.**

---

## 6. 참가자 대면 원문

> **문구 원칙.** ① **중립 어휘** — 진행자 공통 발화에서 "rules", "prompt"를 쓰지 않고 "setup" / "configuration"으로 말한다(예외: 화면 요소를 *지칭*할 때 — Intent / Rule / Rules / Filter / Deploy). ② **평가는 문항에 묶는다.** ③ 두 버전은 **Slate / Clay**, 순서 라벨 금지. ④ 시스템 이름(SCORE)·조건명(baseline/treatment)·"Prolific"은 참가자 대면 텍스트 어디에도 쓰지 않는다.
>
> 각 항목의 **국문**은 검토·IRB용 **참고 번역**이며 참가자에게 제시되지 않는다. 세션은 **영어로** 진행한다.

### 6.1 진행자 핵심 발화

**인트로 (0:00)**
- EN: *"Today you'll look at real conversations that students had with a course chatbot, and you'll use two versions of a configuration tool to set the chatbot up to behave the way you want. There are no right or wrong answers — what matters is your own judgment as an instructor."*
- 국문: "오늘은 학생들이 수업용 챗봇과 실제로 나눈 대화를 보시면서, 설정 도구의 두 가지 버전을 사용해 챗봇이 원하시는 대로 동작하도록 설정해 보시게 됩니다. 정답이나 오답은 없습니다 — 중요한 것은 교수자로서의 선생님 자신의 판단입니다."

**영상 재생 전**
- EN: *"I'll play a short video showing the version you'll be using — about {four/three} minutes. Just watch; I'll answer questions after."*
- 국문: "사용하실 버전을 보여 드리는 짧은 영상을 재생하겠습니다 — {4/3}분 정도입니다. 보시기만 하시면 되고, 질문은 끝나고 받겠습니다."

**작업 지시문 (각 블록 — 화면과 글자 그대로 같은 문장)**
- EN: *"Please look through the conversations students in this course had with the chatbot. Whenever a chatbot response is not what you would want, adjust the setup so that it responds the way you want. When you feel it's ready, deploy it."*
- 국문: "이 수업에서 학생들이 챗봇과 나눈 대화를 훑어 주세요. 챗봇의 응답이 당신이 원하는 모습이 아니라면, 원하는 대로 바뀌도록 설정을 고치시면 됩니다. 다 되었다고 생각하시면 배포해 주세요."
- 덧붙임 — EN: *"You have up to 25 minutes — I'll let you know when there are about five minutes left. As it says on screen, there's no set amount to cover. I'll be quiet while you work; if you can't find something, just ask."*

**작업 중 개입**
- 위치 안내 — EN: *"That's under {X}."* / 국문: "{X} 아래에 있습니다."
- 전략 우회 — EN: *"That's entirely up to you — whatever fits how you'd run your course."* / 국문: "그건 전적으로 선생님께 달려 있습니다 — 수업을 운영하시는 방식에 맞게 하시면 됩니다."
- **시간 경고 (20분 시점)** — EN: *"About five minutes left. No need to cover everything — deploy whenever you feel it's in a good state."*
- **상한 도달** — EN: *"That's time. Please deploy what you have now — whatever state it's in is fine."*

**TLX 전환 (배포 확인 직후)**
- EN: *"Before we check it — there are five quick questions on screen about setting up the chatbot. Please answer those first, and note the labels at the ends of each scale."*
- 국문: "확인하기 전에 — 챗봇 설정에 대한 짧은 질문 다섯 개가 화면에 나옵니다. 먼저 답해 주시고, 각 척도 양 끝의 라벨을 확인해 주세요."

**Pass 1 전환**
- EN: *"Now let's check the chatbot you just set up, with a few new student questions it hasn't seen. You'll see eight questions one at a time. For each one, type in a few words how you expect your chatbot to respond, mark whether that's what you intend, and point to the part of your setup you think will handle it — we won't look at the actual responses yet. Your setup stays open on the side, so feel free to look at it. I'll stay quiet during this part."*
- 국문: "이제 방금 설정하신 챗봇을, 챗봇이 본 적 없는 새로운 학생 질문 몇 개로 확인해 보겠습니다. 질문 여덟 개가 하나씩 나옵니다. 문항마다 챗봇이 어떻게 답할 것 같은지 몇 단어로 적으시고, 그게 의도하신 대로인지 표시하시고, 설정의 어느 부분이 그 질문을 다룰 것 같은지 지목해 주세요 — 실제 응답은 아직 보지 않습니다. 설정 화면은 옆에 열려 있으니 얼마든지 보셔도 됩니다. 이 동안 저는 조용히 있겠습니다."

**Pass 2 전환**
- EN: *"Now let's go back through the same eight questions and see what it actually said. For each one you'll see what you wrote first, then the actual response. Rate how well it matches what you intended, and where a box appears, type a few words."*
- 국문: "이제 같은 여덟 질문을 다시 돌면서 실제로 뭐라고 답했는지 보겠습니다. 문항마다 아까 적으신 내용이 먼저 나오고, 그다음 실제 응답이 나옵니다. 의도하신 것에 얼마나 맞는지 평가해 주시고, 입력란이 나오면 몇 단어 적어 주세요."

**블록 2 전환**
- EN: *"Now we'll do the same thing with the other version — {Slate/Clay} — and a different course."*
- 국문: "이제 다른 버전인 {Slate/Clay}로, 다른 수업의 대화를 가지고 같은 과정을 진행하겠습니다."

**최종 설문 전환**
- EN: *"That's both rounds done — thank you. Before we talk, there's one last questionnaire, about five minutes. It asks you to rate Slate and Clay side by side. Your two setups are still open in the other tabs, so feel free to look back at either one. I'll be quiet while you fill it in."*
- 국문: "두 라운드 모두 끝났습니다 — 감사합니다. 이야기 나누기 전에 마지막 설문이 하나 있습니다, 5분 정도요. Slate와 Clay를 나란히 놓고 평가하시게 됩니다. 두 설정 모두 다른 탭에 그대로 열려 있으니 언제든 돌아가서 보셔도 됩니다. 작성하시는 동안 저는 조용히 있겠습니다."

**종료·디브리핑**
- EN: *"Both versions were built by our team to compare two ways of configuring a chatbot — thank you for helping us compare them."*
- 국문: "두 버전 모두 챗봇 설정의 두 가지 방식을 비교하기 위해 저희 연구팀이 만든 것입니다 — 비교에 도움을 주셔서 감사합니다."

**자주 나오는 질문에 대한 응답**

| 질문 | EN | 국문 |
|---|---|---|
| 어느 쪽이 연구팀 것인가 | *"We're comparing the two designs — I can tell you more after the session."* | "두 설계를 비교하는 중이라서요 — 세션이 끝난 뒤에 더 말씀드릴 수 있습니다." |
| 이름의 뜻 | *"They're just labels so we can tell the two apart — nothing behind them."* | "두 버전을 구분하려고 붙인 이름일 뿐입니다 — 다른 뜻은 없습니다." |
| 뭘 해야 하는지 모르겠다 | *"The task is on the banner at the top — look through the conversations, and change the setup wherever the chatbot's answer isn't what you'd want. Where to start and how much to do is up to you."* | "과제는 위쪽 배너에 있습니다 — 대화를 훑어 보시고, 챗봇의 답이 원하시는 모습이 아닌 곳에서 설정을 고치시면 됩니다. 어디서 시작할지, 얼마나 하실지는 선생님께 달려 있습니다." |
| 학생 데이터·개인정보 | *"These are real conversations collected in earlier research with consent, and anonymized — nothing here identifies a student."* | "이전 연구에서 동의하에 수집한 실제 대화이고 비식별 처리되어 있습니다 — 학생을 식별할 수 있는 것은 없습니다." |

### 6.2 작업 시작 화면 · 고정 배너 [구현]

**시작 화면** (25분 타이머 시작 **전**, [Start]로 진입, **양 조건 동일 문구**):

```
Your task in this round

Look through the conversations students in this course had with the chatbot.
Whenever a chatbot response is not what you would want, adjust the setup
so that it responds the way you want.
When you feel it's ready, deploy it.

There is no set amount to cover — how much you look at, and how much you
change, is entirely up to you.

                                                            [ Start ]
```
- 국문: "이번 라운드의 과제 — 이 수업에서 학생들이 챗봇과 나눈 대화를 훑어 주세요. 챗봇의 응답이 원하시는 모습이 아니라면, 원하는 대로 바뀌도록 설정을 고치시면 됩니다. 다 되었다고 생각하시면 배포해 주세요. **정해진 분량은 없습니다** — 얼마나 보실지, 얼마나 고치실지는 전적으로 선생님께 달려 있습니다."

**고정 배너** (보드 상단 한 줄, 작업 내내):
- EN: *"Your task: adjust the setup so the chatbot responds the way you want — deploy when you're ready."*
- 국문: "과제: 챗봇이 원하시는 대로 답하도록 설정을 고쳐 주세요 — 되었다 싶으면 배포하시면 됩니다."

> **금지 2개.** 양 조건에 **문자 그대로 동일한 문구**여야 한다(셸 패리티). **남은 시간 카운트다운을 표시하지 않는다.**

### 6.3 블록 테스트 UI 문구 [구현]

문항 화면 = **직전 대화 턴들 + 학생 질문**. 참가자의 설정 화면은 내내 열려 있다.

**Pass 1 — 예측** (문항마다 세 입력을 **포인팅 → 서술 → 짐작** 순으로, **Next**로 진행. 셋 다 입력해야 활성화 — 서술은 빈칸 불가, 짐작·포인팅은 "Not sure"도 유효 응답)

- **포인팅**
  - **Slate** (트리에서 클릭): **"Which intent do you expect this question to fall under — if any?"** — 버튼 **None of them** / **Not sure**
    - 국문: "이 질문이 어느 intent에 걸릴 것 같으세요 — 걸리는 게 있다면요?"
  - **Clay** (문서에서 구간 선택): **"Which part of your Rules document do you expect to shape the response — if any? Select it in the document."** — 버튼 **Nothing specific** / **Not sure**
    - 국문: "Rules 문서의 어느 부분이 이 응답에 작용할 것 같으세요 — 있다면요? 문서에서 그 부분을 선택해 주세요."
  - > **Clay의 구간 선택이 중요한 이유:** 지목의 곤란·분산 자체가 **좌표 데이터**로 남아 "예측 가능성" 기제를 직접 관찰할 수 있다.
- **서술** (텍스트 박스 한 줄): **"In a phrase or a sentence — a few words are fine — how do you expect your chatbot to respond to this?"**
  - placeholder: *e.g., "won't write it for them; asks what they've tried"*
  - 국문: "한 구절이나 한 문장으로 — 몇 단어여도 됩니다 — 선생님의 챗봇이 이 질문에 어떻게 답할 것 같으세요?"
- **짐작** (예/아니오): **"Will your chatbot answer this the way you intend?"** — Yes / No
  - 국문: "내 챗봇이 이 질문에 내가 의도한 대로 답할까?"

**Pass 2 — 공개·판정** (같은 순서)

- **② 공개** — 상단 **"Your prediction"** 패널: **"You wrote: "{서술}" · You expected it to answer the way you intend: {Yes/No} · You pointed to: {intent 이름 / 선택 구간 하이라이트 / None / Not sure}"** → 버튼 **"Show the actual response"**
- **③ 판정** (5점): **"How well does this response match what you intended?"** — 1 = *Not at all what I intended* … 5 = *Exactly what I intended*
  - **3점 이하이면 텍스트 박스**: **"What's off about it? (a few words)"**
  - 국문: "이 응답은 의도하신 것에 얼마나 부합하나요?" / "어떤 점이 어긋났나요?"
- **④ 프로브** (조건부 텍스트 박스 — **예측이 빗나간 문항에만 자동으로** 열린다: 짐작 ≠ 접힌 판정, 또는 Slate에서 포인팅 ≠ 실제 라우팅): **"This turned out differently from what you expected — why do you think that is? (a sentence is fine)"** — 선택 입력(빈칸 허용)
  - 국문: "예상하신 것과 다르게 나왔네요 — 왜 그랬을 것 같으세요?"
  - 시간이 밀리면 진행자 한마디: *"Leave it blank if nothing comes to mind."*

### 6.4 작업 부하 설문 — NASA-TLX 하위척도 5 [구현]

**지시문 (과제 정의 포함)**
- EN: *"Before we check it — five quick questions about **setting up the chatbot** in the round you just finished: from when you started looking through the student conversations to when you deployed."*
- 국문: "확인하기 전에 — 방금 마치신 라운드에서 **챗봇을 설정한 일**에 대한 짧은 질문 다섯 개입니다: 학생 대화를 훑기 시작한 때부터 배포하신 때까지요."

**척도:** 7점 · **양 끝 앵커를 화면에 명시** · 가중치 없음(Raw TLX)

| # | EN (과제명을 넣은 stem) | 앵커 | 국문 |
|---|---|---|---|
| W1 | **Mental Demand.** How mentally demanding was setting up the chatbot? | Very low … Very high | 챗봇을 설정하는 일은 정신적으로 얼마나 부담이 컸습니까? |
| W2 | **Temporal Demand.** How hurried or rushed was the pace while you were setting it up? | Very low … Very high | 설정하시는 동안 진행 속도가 얼마나 급하거나 쫓기는 느낌이었습니까? |
| W3 | **Performance.** How successful were you in accomplishing what you set out to do? | **Perfect … Failure** | 하고자 하신 것을 얼마나 성공적으로 해내셨다고 생각하십니까? |
| W4 | **Effort.** How hard did you have to work to accomplish your level of performance? | Very low … Very high | 그 수준의 성과를 내기 위해 얼마나 힘들게 일해야 했습니까? |
| W5 | **Frustration.** How insecure, discouraged, irritated, stressed, and annoyed were you while setting it up? | Very low … Very high | 설정하시는 동안 얼마나 불안하고, 낙담하고, 짜증 나고, 스트레스받고, 성가셨습니까? |

- **W3 아래 보조문 (필수)** — EN: *"There was no set amount to cover — judge this against your own goal for this round."* · 국문: "정해진 분량은 없었습니다 — 이번 라운드에서 스스로 세우신 목표에 비추어 판단해 주세요."

> **왜 이 형태인가.** ① **과제명 치환은 변형이 아니라 정상 사용법**이다 — TLX는 언제나 *명명된* 과제에 대해 실시한다. 원문의 `the task`는 우리 설계에 **지시 대상이 없어서** 참가자마다 다른 것을 평정하게 된다. ② **W3의 구 문구 *"what you were **asked** to do"*는 우리가 주지 않은 성공 기준을 전제**한다 — 5개만 보고 배포한 참가자가 "실패했다"고 느끼면 부하가 아니라 오해를 잰 것이다. 원 TLX는 *"the goals of the task set by the experimenter **(or yourself)**"*로 자기설정 목표를 허용한다. ③ **Physical Demand 제외**는 소프트웨어 연구의 표준(EvalLM도 동일). ④ **Performance만 앵커 방향이 반대**(Perfect → Failure)라 다섯 개 모두 "높을수록 나쁨"이 되고 역채점이 불필요하다 — **양 끝 라벨을 반드시 표시할 것.** ⑤ **7점**은 TeachTune 선례(원 21점 → 7점, 다른 척도와 일관성).
>
> **폼을 둘로 쪼개지 않는다**(TeachTune은 생성/검토를 쪼갰다). 우리는 훑기와 고치기가 **뒤섞인 하나의 활동**이라 분리가 인위적이다 — 대신 지시문에서 경계를 못 박는다.
>
> **보고.** 하위척도별로 보고하고 **합성 점수(가중 TLX)를 만들지 않는다.** 이름은 *"five unweighted NASA-TLX subscales (excluding Physical Demand), on 7-point scales"*로 쓴다.

### 6.5 최종 설문 [구현 / Qualtrics]

**형태:** 두 버전 **side-by-side** — 행 = 진술, 열 = **Slate / Clay**(그 참가자가 **쓴 순서대로**, 먼저 쓴 것이 왼쪽). 각 열 머리에 그 버전의 **화면 썸네일**.

**도입 화면**
- EN: *"Almost done — thank you. You used two versions of the tool today, Slate and Clay. In this last questionnaire we ask you to rate them separately, side by side. There are no right answers, and critical ratings are just as useful to us as positive ones.*
  *Your two setups are still open in your browser — feel free to switch back and look at either one while you answer."*
- 국문: "거의 끝났습니다 — 감사합니다. 오늘 도구의 두 버전 Slate와 Clay를 사용하셨습니다. 이 마지막 설문에서는 두 버전을 나란히 놓고 따로따로 평가해 주시면 됩니다. 정답은 없고, 비판적인 평가도 긍정적인 평가만큼 저희에게 유용합니다. 두 설정 모두 브라우저에 그대로 열려 있으니, 답하시는 동안 언제든 돌아가서 보셔도 됩니다."

#### B-1. 저작 경험 — 8문항 (7점 동의, 1 = Strongly disagree … 7 = Strongly agree)

지시문 — EN: *"For each statement, please rate Slate and Clay separately."*

| # | EN (제시 순서) | 국문 | 구인 · 왜 남았는가 |
|---|---|---|---|
| E2 | It was easy to say *when* a behavior should apply and when it should not. | 어떤 행동이 *언제* 적용되고 언제 적용되지 않아야 하는지를 말하기 쉬웠다. | 표현력 — **조작 변인 정면** |
| C1 | I felt in control of how the chatbot **will** behave. | 챗봇이 앞으로 어떻게 행동할지를 내가 통제하고 있다고 느꼈다. | 통제감 (미래형) |
| L1 | When I changed something, I knew which student questions it would affect. | 무언가를 바꿀 때 어떤 학생 질문들이 영향을 받을지 알고 있었다. | **국소성** — 다른 채널 없음 |
| O1 | I had a clear overview of everything the chatbot was set up to do. | 챗봇이 어떻게 설정되어 있는지 전체를 명확히 파악하고 있었다. | **조망/누적** — 다른 채널 없음 |
| **L2** | I worried that fixing one thing would change how the chatbot handled other questions. | 하나를 고치면 챗봇이 다른 질문을 다루는 방식까지 바뀔까 봐 걱정되었다. | **간섭** + **유일한 역문항**(straight-lining 감지) |
| P1 | I could predict how the chatbot would respond to a new student question. | 새로운 학생 질문에 챗봇이 어떻게 답할지 예측할 수 있었다. | **지각** 예측 ↔ 실측 V1 대조 |
| L3 | When I noticed a problem, I knew where in my setup to go to fix it. | 문제를 발견했을 때 설정의 어디로 가서 고쳐야 할지 알고 있었다. | **지각** 귀속 ↔ 실측 V2 대조 |
| T2 | I would be comfortable letting my own students use the chatbot I set up with this version. | 이 버전으로 설정한 챗봇을 내 학생들이 쓰게 하는 것이 부담스럽지 않다. | 신뢰의 **행동판** |

> 제시 순서는 구인이 뭉치지 않게 섞었다(halo 완화) — 국소성 3형제가 3·5·7번, 역문항이 한가운데. **행 순서는 고정**(랜덤화하지 않는다).
> **남긴 기준: "이 연구의 다른 측정이 못 잡는 것을 잡는가."** 13문항에서 줄인 것이며, 뺀 것은 E1(E2에 흡수) · C2(C1이 미래형) · V1(사후 "다룬/안 다룬" 객관 분류가 대체) · T1(T2가 행동판) · M1(인터뷰로 이관).

#### B-2. 맥락·패리티 확인 — 3문항 (같은 형식, 별도 페이지)

| # | EN | 국문 | 역할 |
|---|---|---|---|
| U2 | This version was easy to use. | 이 버전은 사용하기 쉬웠다. | **패리티 확인** — 셸을 공유하므로 **차이가 없어야 정상** |
| U3 | The suggestions the tool offered were helpful. | 도구가 제안해 준 것들이 도움이 되었다. | **패리티 확인** — 공용 AI 표면. 차이가 나면 ablation이 AI 지원까지 깎았다는 신호 |
| R1 | The conversations I reviewed in this round were similar to the questions my own students ask. | 이 라운드에서 살펴본 대화는 내 학생들이 하는 질문과 비슷했다. | **생태 타당도** — 조건이 아니라 **데이터셋별**(SWAG/NIRVANA)로 읽는다 |

#### B-3. 직접 비교 — 5문항 (양극 7점)

지시문 — EN: *"Now comparing Slate and Clay directly. Which one made it easier to…"*
척도: 1 = *Much easier with {왼쪽 이름}* · **4 = No difference** · 7 = *Much easier with {오른쪽 이름}* — **양 끝에 이름을 매 문항 반복 표시**(방향 혼동이 이 문항의 유일한 실패 모드)

| # | EN | 국문 | 대응 기제 |
|---|---|---|---|
| I1 | …express what you wanted the chatbot to do? | …챗봇이 하길 원하는 것을 표현하기 | 표현 |
| I2 | …predict how the chatbot would respond to a new question? | …새 질문에 챗봇이 어떻게 답할지 예측하기 | 예측 가능성 |
| I3 | …find and fix a specific behavior you didn't like? | …마음에 들지 않는 특정 행동을 찾아 고치기 | 국소 수정 |
| I4 | …keep an overview of everything you had set up? | …설정한 것 전체를 파악하고 있기 | 누적/조망 |
| I5 | …make a change without worrying about side effects on other questions? | …다른 질문에 미칠 부작용 걱정 없이 수정하기 | 간섭 |

> **절대 평정(B-1)과 상대 판단(B-3)은 다른 것을 잰다.** 절대 평정은 개인 기준선에 묶여 N=16에서 잡음이 크고, 상대 판단은 그 기준선을 상쇄한다. 둘이 어긋나면 그 자체가 보고할 관찰이다.

#### B-4. 자유서술 — 2칸 (필수 아님)

- EN: *"In a sentence or two: for **{Slate/Clay}**, what helped you most, and what got in your way most?"* → 텍스트 박스
- EN: *"And the same for **{Clay/Slate}**."* → 텍스트 박스

> 인터뷰 **전에** 타이핑으로 받는다 — 진행자 영향 없는 개인 회고를 확보하고, 인터뷰를 참가자가 이미 언어화한 것에서 출발시킨다.

#### 마감
- EN: *"Thank you — that's the last of the questions. Let's talk for a few minutes about your experience."*

### 6.6 인터뷰 가이드 (~8분, 반구조화)

**도입**
- EN: *"That's all the tasks — thank you. For the last few minutes I'd like to hear about your experience with the two versions. There are no right answers, and critical comments are just as useful to us as positive ones. I'll use the names you saw — Slate and Clay."*
- 이어서 **설문 답 짚기** (극단값·두 버전 간 큰 차이·역문항 불일치에서 하나): *"Before we start — you rated {Slate/Clay} {quite low/high} on '{statement}'. Tell me about that."*

**Q1 · 차이 (2분)**
- EN: *"You used Slate and Clay today. How did they feel different — in how you got the chatbot to do what you want?"*
- 후속(대칭 프로빙): *"For each of them: was there a moment it clicked, and a moment it got in your way?"*
- 한쪽만 말하면 반드시 다른 쪽도: *"And {Clay/Slate} — same question."*

**Q2 · 회고 프로브 (2–3분, 관찰 메모에서 2~3개)**
- EN: *"Earlier, in {Slate/Clay}, I noticed you {…}. What was going through your mind there?"*
- `{…}` 예시(**행동만, 해석 없이**): "…spent quite a while in the Reviewing questions before changing anything…" / "…wrote an instruction, deleted it, and wrote it again…" / "…went back and forth between Planning and Drafting…" / "…ran the preview several times on the same question…" / "…created {an intent / a filter} and then removed it…" / "…stopped and looked over the whole {tree / Rules document} for a while before deploying…"

**Q3 · 재현 (1분)** — 이월 확인 + RQ1
- EN: *"In the second round, were you trying to rebuild what you'd made in the first one? How did that go?"*

**Q4 · 채택 (1분)**
- EN: *"If you were to use one of these for your own course next term, which would you pick — Slate or Clay — and why?"*
- 후속 ①: *"What would stop you from actually using it?"*
- 후속 ② (**누적 기제의 유일한 채널**): *"And if you kept adding to it over a semester — how do you think that would go?"*
- > **선택 비율은 보고하지 않는다** — 조건이 가려지지 않아 demand에 노출된다. **이유·걸림돌만 코딩**한다. 선택을 재촉하지 않는다.

**Q5 · 이식성 (1분)** — 두 단계로
- EN: *"Think of a writing assignment you actually teach. What kind of writing is it?"* → *"Now imagine taking today's setup to that assignment. Would it carry over? What would you need to change?"*
- 첫 답(과제 종류)을 **기록해 둔다** — 사후에 SWAG·NIRVANA 과제와 대조.

**Q6 · 마무리**
- EN: *"Anything about Slate or Clay you wanted to say but weren't asked?"*

**중립 프로브:** *"Can you say more about that?"* · *"What made you do that?"* · *"Can you give me an example from today?"* · *"How did that compare in the other one?"* · *"Anything else?"*

**하지 말 것:** 유도("So the intents made it easier, right?") · 시스템 변호·설명 · 한쪽에만 프로빙 · 참가자의 말을 요약해 되묻기(인용으로만 되묻는다) · Q4에서 선택 재촉.

### 6.7 진행자 관찰 메모 양식

| 시각 | 블록/조건 | 관찰 (**행동만, 해석 없이**) | 프로브 후보 ✓ |
|---|---|---|---|
| mm:ss | 1/Slate 등 | 예: "Reviewing 유형에서 4분 체류, 같은 질문 세 번 열람" | |

**볼 것:** 특정 유형·질문에 오래 머묾 · 수정 전 망설임/되돌림 · rule/definition 재작성 · 검색/filter 사용 · 유형 간 점프 · 프리뷰 반복 실행 · 자발적 발화. **세션당 프로브 후보 2~3개에 ✓** — 인터뷰 Q2에서 그대로 짚는다.

---

## 7. 측정 정리

| 측정 | 언제 | RQ | 지위 |
|---|---|---|---|
| 블록 테스트 **5점 부합도** (사후 "다룬/안 다룬 영역"으로 분류) | 블록 테스트 | RQ3 | **주** (지각) |
| **"무엇이 달랐나" 텍스트의 misalignment 유형 코딩** (간섭 · 미반영 · 과잉일반화 · 미커버 등) | 블록 테스트 | RQ3 | **주** (질적) |
| **예측 정확도** (예/아니오 짐작 ↔ 5점 판정을 3점 이하='아니오'로 접어 대조) | 블록 테스트 | RQ2 (V1) | **주** (행동) |
| **귀속 정확도**(포인팅) — Slate는 `appliedIntentId`와 대조해 **객관 채점**, Clay는 지목 양상 코딩 | 블록 테스트 | RQ2 (V2) | **주** (행동/객관) — 판정과 독립인 유일한 앵커 |
| **행동 서술 코딩** (서술 ↔ 실제 응답, 2인 코딩) | 블록 테스트 | RQ2 (V3) | **주** (행동) |
| 확신 보정 (Pass 1 짐작 '예' 개수 vs 실제 부합 개수 — 2-pass라 전부 무정보 짐작) | 블록 테스트 | RQ2 (파생) | 보조 |
| 프로브 텍스트 (예측이 빗나간 이유의 귀속) | 블록 테스트 | RQ2 주 · RQ3 보조 | 질적 |
| **작업 부하 W1~W5** (NASA-TLX 하위척도 5, 신체 제외, 가중치 없음) | **배포 직후·테스트 전** | — | 비용 지표 (RQ 밖). 하위척도별 보고, 합성 없음 |
| **최종 설문 B-1** (E2·C1·L1·O1·L2·P1·L3·T2) | 세션 말미 | — (RQ1·RQ2와 병치) | **저작 경험의 주관 지표** — 어느 RQ의 측정도 아님 |
| 최종 설문 P1·L3 | 세션 말미 | RQ2 실측(V1·V2)과 **병치** | 지각 — 반드시 *perceived*로 표기. **갈림 자체가 결과**(IOED) |
| 최종 설문 U2·U3 | 세션 말미 | — | **패리티 확인** — 차이가 **없음**을 보이는 것이 목적 |
| 최종 설문 R1 | 세션 말미 | — | 생태 타당도 — **데이터셋별** 집계 |
| 최종 설문 B-3 (I1~I5 양극) · B-4 자유서술 | 세션 말미 | 기제의 상대 판단 | 보조 (분포·이유만) |
| **행동 기록**: 화면 녹화 + DB 상태(생성 경로 · 트리 배치 · correction과 이유 · fold/filter 사용 · Rules 편집 패턴) + 관찰 메모 | 작업 중 | RQ1 | **주** |
| **최종 설정 아티팩트 분석**: 표명된 의도의 개수·입도·검토 세트 커버리지, Clay Rules 문서의 구조(조건화 표현 등) | 세션 후 | RQ1 (+RQ3 해석) | **주** |
| 인터뷰 (회고 프로브 포함) | 세션 말미 | RQ1·RQ2 | **주** (질적) |

**construct 규율.** RQ2 = comprehension 하나. 설문의 통제감·신뢰·부담은 **어느 RQ의 답도 아니며** 결과 절에서 '저작 경험' 소절로 따로 보고한다.

**행동 지표는 이벤트 로그가 아니라 DB 상태 + 화면 녹화 + 관찰 메모에서 뽑는다** — 이벤트 커버리지가 얇다(as-built §8 참조). think-aloud가 없으므로 **작업 중의 "왜"는 실시간으로 얻지 못한다** — 인터뷰 회고 프로브와 아티팩트·행동 기록의 삼각측량으로 보완하고, "의도의 진화"에 대한 주장은 이 근거 수준에 맞게 조심한다.

**LLM 채점기는 이번 범위에서 제외한다** — 세션의 판정 데이터는 보존되므로 사후 확장은 열려 있다.

---

## 8. 배치·통제·분석

### 8.1 배치

조건 순서 × 데이터셋 짝의 **4셀에 균형 배정**. 16명이면 셀당 4명.

| 셀 | 블록 1 | 블록 2 | 참가자 번호 | 먼저 여는 코스 |
|---|---|---|---|---|
| A | **Slate**–SWAG | **Clay**–NIRVANA | 짝수 | SWAG |
| B | **Slate**–NIRVANA | **Clay**–SWAG | 홀수 | NIRVANA |
| C | **Clay**–SWAG | **Slate**–NIRVANA | 홀수 | SWAG |
| D | **Clay**–NIRVANA | **Slate**–SWAG | 짝수 | NIRVANA |

> **셀은 연구자가 참가자를 만들 때 배정해 행에 저장한다** — 조건과 데이터셋 짝, 그리고 블록 순서까지 셀 하나가 전부 결정한다(`phases.ts`의 `planForCell`, 클론 조건은 `provision.ts`가 그 배정에서 읽는다). 위 표의 **참가자 번호 홀짝 열은 셀 컬럼이 생기기 전 행을 위한 폴백 규칙**일 뿐이며, 지금은 번호가 설계를 결정하지 않는다(번호를 바꿔도 셀이 움직이지 않게 하려고 분리했다). **순서도 진행자가 여는 코스로 통제하지 않는다** — 페이즈가 블록마다 보드 하나만 열어 준다. 참가자 화면에는 데이터셋 이름이 아니라 **중립 코스명**이 보인다.

### 8.2 블라인딩

**숨기는 것:** 어느 쪽이 연구팀의 시스템인지(중립 명명 "Chatbot Studio", 코드네임 Slate / Clay).
**숨길 수 없는 것:** 블록 테스트에서 지금 시험하는 챗봇이 어느 조건 것인지.

**A/B 삭제로 조건 블라인드 측정이 없어졌다** — 모든 지각 측정이 demand characteristics에 노출되며 이는 **한계로 명시**한다. 남는 완화 장치: ① 중립 명명 유지(어느 쪽도 "새 것"으로 읽히지 않는 코드네임), ② 평가를 시스템이 아니라 문항에 묶기, ③ 예측 단계는 참가자가 꾸며낼 수 없는 행동 측정, ④ 인터뷰에서 두 버전의 아쉬운 점을 **대칭으로** 묻기.

### 8.3 데이터셋 친숙도의 비대칭

참가자 전원이 선행 연구에서 **NIRVANA 학생–ChatGPT 대화를 이미 읽었고, SWAG는 전원에게 처음**이다. 두 데이터셋은 친숙도 면에서 **교환 가능하지 않다.**

- **주 비교(조건 간)는 보호된다** — 4셀 균형 배정이 NIRVANA 친숙도를 두 조건에 고르게 흩뿌리므로 친숙도는 편향이 아니라 잡음으로 들어간다. **이것이 4셀 균형을 반드시 지켜야 하는 이유다.**
- **RQ1 서술에서는 짚는다** — 이미 읽어 본 로그를 조직하는 것과 처음 보는 로그를 조직하는 것은 cold start의 성격이 다르다. 데이터셋별로 갈라 보고 차이가 보이면 그대로 쓴다.
- **개별 인식 위험**은 §4 파이프라인 0단계로 막는다.
- **참가자 절에 명시 보고**: "모든 참가자는 선행 연구에서 NIRVANA 대화를 읽은 적이 있고 SWAG는 처음이었다. 조건×데이터셋 균형 배정으로 이 비대칭이 조건 대비에 실리지 않게 했다."

### 8.4 이월의 처리

교수자의 안정된 교육 철학이 두 블록에 걸쳐 있는 것은 **오염이 아니라 전제**다. 진짜 이월은 의도를 조직하는 인지 작업이 첫 블록에서 끝나 있다는 것인데, **방향이 비대칭이다**: Slate를 먼저 쓰면 유형별로 가르는 사고를 배워 **Clay에 유리**하게 작용한다 — 즉 측정되는 차이를 줄이는 **보수적 편향**.

확인 장치: ① 4셀 균형, ② 블록 단위 측정은 **첫 블록만 떼어**(모든 참가자의 첫 블록에는 이월이 있을 수 없음, 조건당 8명) 참가자 간 비교로 방향 일치를 확인, ③ 인터뷰 Q3에서 재현 시도를 직접 질문. 두 번째 블록에서 첫 블록의 구조를 재현하려 애쓰는 행동은 오염이 아니라 **RQ1 관찰물**이다.

### 8.5 분석

**질적 (주).** misalignment 유형 · 예측 실패 사례 · 포인팅 양상 · 아티팩트 구조 · 인터뷰를 **2인 코딩 + 일치율 보고**. 조건 간 대비는 코딩된 범주의 분포와 대표 사례로 보인다.

**정량 (보조).** 5점 부합도 · 예측 정확도 · 설문의 조건 간 차이를 **기술통계 + 효과크기**로 보고. 탐색적 쌍 비교(Wilcoxon signed-rank, 효과크기 r = Z/√N)는 할 수 있으나 **확증적 주장은 하지 않는다** — N=16이고, 조건 간 정량 비교는 A/B를 드롭시킨 것과 같은 intent-divergence 논거에 노출된다.

**설문 분석 규율.**
- **문항 단위로 보고한다.** 검증되지 않은 자작 문항이므로 **합성 척도를 만들지 않는다.** L1·L2·L3는 *주제적 묶음*으로만 서술한다(척도가 아니다).
- **다중비교.** 27개 평정에 개별 검정을 돌리고 별표를 다는 것은 하지 않는다. 비교한다면 **사전 지정한 소수**(I1~I5)로 한정하고 그 사실을 밝힌다.
- **L2는 역채점 없이 원점수로** 보고한다(문항 뜻이 "우려"이므로).
- **straight-lining 감지**: L2와 L1·L3의 불일치 · 한 열 전체 동일값. 해당 참가자는 배제하지 않되 **질적 해석에서 가중을 낮추고 그 사실을 보고**한다.
- **지각과 실측을 섞지 않는다.** P1·L3는 반드시 *perceived*로 표기하고 실측(V1·V2)과 병치한다. **갈리면 그 갈림이 결과다.**

**선택적 중단 방지.** "16명 목표로 모집하되 [날짜]까지 완료된 세션으로 분석"을 **사전에 고정**. 문항 수는 사람 수를 대체하지 못한다 — 일반화의 단위는 참가자다.

---

## 9. 모집과 운영 (요약)

**모집 경로.** 2026-05 선행 서베이(Prolific로 모집된 교수자 대상) 응답자의 **학술 이메일 메일링 리스트**로 직접 접촉. 이번에는 플랫폼을 경유하지 않으므로 **선발과 보상 집행의 책임은 연구팀이 진다.** 참가자 대면 텍스트에 **"Prolific"을 쓰지 않는다.**

**원 모집단 (논문 참가자 절에 그대로 쓸 것).** 세 필터의 AND — Current Job Role ∈ {Adjunct Faculty/Lecturer–College, Lecturer/Professor–College, School Principal/Head Teacher, Secondary School Teacher, University Lecturer/Professor} · First Language = English · Country of Residence ∈ {UK, US, Canada}. 광고문은 "writing-intensive courses (ideally STEM-based writing)" 명시.
- **일반화 한계** — 영어 모어, 영미권 3개국. 명시 보고.
- **중등교사를 배제하지 않는다** — 논문의 근거 문헌 상당수가 K-12이고, 참가자는 어차피 자기 강좌가 아닌 로그를 다루며, 측정이 참가자 내 자기참조라 교수자 간 기준 차이는 전제다. 수준은 스크리너로 기록해 **4셀에 고르게 배정**하고 최종 구성을 보고한다.

**세션 전 폼 2종.** ① **Screening Survey**(~2분) — 연결 동의 · 이메일 · 게이트 5문항. 적격자는 완료 화면의 **Microsoft Bookings 링크로 직접 예약**. ② **Consent Form with Background Survey**(~5분) — **예약 확인 메일에 링크 포함**(예약 직후), 세션 1시간 전 리마인더로 재안내. IRB 24-325 정식 동의문 + 웹캠 별도 동의 + 배경 8문항.

> **동의 폼 링크는 예약 확인 메일에, 리마인더는 1시간 전.** 리마인더가 *동의서 전달*과 *출석 독촉*을 겸하면 둘의 최적 시점이 정반대라 충돌한다 — 24시간 내 예약 시 리마인더가 아예 발송되지 않아 동의서를 못 받고, 리마인더를 1시간 전으로 당기면 동의서 읽을 시간이 사라져 자발성이 흔들린다. 그래서 분리한다.

**미작성자 처리.** 세션 시작 3분에 동의를 받아 진행하되 **배경 문항은 받지 않고 결측으로 보고**한다. 동의를 거부하면 세션 취소·보상 미지급.

**선발의 투명성.** 규칙을 사전 고정해 논문에 그대로 보고 — "적격 응답자를 응답 순으로 초대하되 4셀 균형을 맞춰 18명이 찰 때까지". **모집 퍼널(접촉 n → 응답 n → 적격 n → 등록 18 → 분석 16)은 계수만** 기록한다. 논문에 들어가는 스크리너 데이터는 **최종 참가자 16명의 것뿐**이며 비선발 응답자의 실질 응답은 분석·보고하지 않는다.

**보상.** 약 90분에 **$60** (Amazon 기프트카드 · Zelle · Venmo 중 택1).

**세션.** 전원 Zoom 동기 진행, 진행자 배석, **화면·음성 녹화 필수**(웹캠은 선택). 참가자는 브라우저(Chrome, 데스크톱/노트북)로 접속하고 화면을 공유한다.

**IRB.** 24-325 **amendment**. 반영 항목: 세션 90분·$60, 메일링 리스트 재접촉, Zoom 녹화, think-aloud 삭제, 이전 서베이 응답과의 연결(이메일 문자열이 조인 키). **[운영]** 동의서 Q1의 *"…and to answer a short questionnaire"*가 현 절차(블록 내 TLX + 말미 설문)와 정합하는지 확인.

**세션 후 (참가자 없음).** 테스트 문항을 각 참가자의 최종 설정과 대조하는 사후 분류("다룬/안 다룬 영역") · Slate 측 포인팅 ↔ 실제 라우팅 대조 · DB 상태에서 행동 지표 추출 · 블록 테스트 텍스트 응답 코딩 · 인터뷰 전사와 코딩 · 최종 설정 아티팩트 코딩.

---

## 10. 시스템 요건 — 무엇을 만들어야 하는가

> as-built(`SCORE_BASELINE_DESIGN.md`)에 **이미 있는 것**은 여기 다시 적지 않는다. 아래는 **스터디를 위해 추가로 필요한 것**과 **스터디 시작 전 반드시 처리해야 할 것**이다.

### 10.1 스터디 시작 전 필수 (as-built §10에서 이월)

- [ ] **PHASE 2 격리 스위치** — `resolveStudioView`의 `?view=` 우선을 해제하고, 개요 페이지를 단일 `[Chatbot Studio]` 버튼으로. 헤더 중립 명명.
- [ ] **이벤트 커버리지** — 스펙 의도보다 얇다(§8 카탈로그). **분석 계획을 실제 이벤트 표에 맞추거나** 이벤트를 보강할 것. 이 문서의 §7은 이미 "행동 지표는 DB 상태 + 녹화 + 관찰 메모에서 뽑는다"로 잡혀 있다.
- [ ] 고아 표면 정리 결정 (`baseline/revise` · `baseline/preview` · `review-set` CRUD 등).

### 10.2 신규 — 명칭

- [ ] **헤더 칩** `Chatbot Studio · {NAME}` — `{NAME}`은 **설정 가능한 문자열**(기본: 조건에 따라 `Slate` / `Clay`). 논문 그림·발표 영상 렌더링 시 `SCORE`로 치환 가능해야 한다.
- [ ] 참가자 표면 어디에도 `SCORE` · `baseline` · `treatment` 문자열이 렌더되지 않는지 확인(에러 문구 포함).

### 10.3 신규 — 작업 화면 (§6.2)

- [ ] **작업 시작 화면** — 코스 진입 시 표시, [Start]로 보드 진입. **양 조건 동일 문구.**
- [ ] **[Start] 시점을 작업 시작 타임스탬프로 기록** (25분 상한의 기준).
- [ ] **고정 배너** — 보드 상단 한 줄, 작업 내내 표시. 양 조건 동일.
- [ ] **카운트다운 표시 금지.**

### 10.4 신규 — 작업 부하 설문 (§6.4)

- [ ] **Deploy → TLX 5문항 화면 → 블록 테스트** 흐름. 배포 직후 테스트 8문항 응답의 **백그라운드 일괄 생성이 이 화면 동안 진행**된다.
- [ ] 7점, **양 끝 앵커 라벨을 화면에 표시**. **W3만 방향이 반대**(Perfect → Failure).
- [ ] W3 아래 보조문 표시.
- [ ] 응답을 `participant · block · condition · dataset · timestamp`와 함께 저장.

### 10.5 신규 — 블록 테스트 UI (§6.3)

- [ ] **2-pass 진행** — Pass 1(예측 8문항) 전부 → Pass 2(공개·판정 8문항).
- [ ] Pass 1 입력 3종을 **포인팅 → 서술 → 짐작** 순으로 배치: **포인팅** + **서술 텍스트 박스**(빈칸 불가) + **예/아니오**. 순서는 배치일 뿐 잠그지 않는다
  - Slate: intent 트리에서 **클릭** → `intentId` 저장
  - Clay: Rules 문서에서 **구간 선택** → **문자 오프셋 좌표** 저장
  - 양쪽: **"None"/"Not sure"** 버튼
- [ ] **Pass 2 재표시** — 본인 서술(입력 문장 그대로) · 짐작 · 포인팅(intent 이름 / 선택 구간 하이라이트)
- [ ] **"Show the actual response"** 버튼 → 사전 생성된 응답 표시 (대기 없음)
- [ ] **5점 판정** → **≤3이면 "What's off about it?" 텍스트 박스 자동 노출**
- [ ] **조건부 프로브 텍스트 박스** — 자동 판정 조건: (짐작 ≠ 접힌 판정) **또는** (Slate에서 포인팅 ≠ 실제 `appliedIntentId`)
- [ ] **응답 메타데이터 보존** — `chatDeployVersion` · `appliedIntentId` · `appliedOutcome` (V2 객관 채점의 근거)
- [ ] 모든 입력을 **문항 ID · 타임스탬프**와 함께 저장
- [ ] **진행자 개입이 필요 없도록** 화면 안내만으로 완결될 것

### 10.6 신규 — 최종 설문 (§6.5)

- [ ] **Qualtrics 권장** (파일럿 중 가장 많이 바뀔 부분). 2벌 제작 — `SC`(왼쪽 Slate) / `CS`(왼쪽 Clay), 셀에 맞춰 링크 발송.
- [ ] **문항 타입: Side by Side** — Matrix Table > Likert는 행마다 척도가 하나라 **두 버전을 나란히 놓을 수 없다.** B-3만 Matrix Table > Bipolar.
- [ ] 참가자 키는 **참가자 번호**(이메일·이름 금지 — 동의서가 "participant number rather than your name"을 약속).
- [ ] 열 머리에 **화면 썸네일 2장**(Slate · Clay).
- [ ] 진행률 표시줄 켜기 · 뒤로 가기 허용 · 강제 응답(자유서술 제외) · **행 순서 고정**.
- [ ] `DataExportTag` = 이 문서의 문항 번호(E2·C1·L1·O1·L2·P1·L3·T2·U2·U3·R1·I1~I5·FT1·FT2). **삭제된 태그(E1·C2·V1·M1·T1)는 재사용하지 않는다.**

### 10.7 세션 운영이 시스템에 요구하는 것

- [ ] 참가자당 **클론 2개**가 대시보드에 **동시에 열려 있고 세션 내내 유지**된다(최종 설문의 회상 보조 — 어느 탭도 닫지 않는다).
- [ ] **셀프 리셋(`/api/study/reset`)이 본 세션 중 눌리지 않도록** 주의 — 재클론은 데이터를 버린다.
- [ ] 세션 후 **클론 상태 보존**(배포 스냅샷 · rule 버전 · 테스트 응답).

---

## 11. 준비물과 미확정

### 11.1 [준비] 만들 것

- **데모 영상 3편** — ⓐ 공통(~1분) · ⓑ Slate(~2.5분) · ⓒ Clay(~2.5분), 두 세그먼트 길이 차 ≤15초. 자막 권장, 배경음악 없음. 나레이션 원고는 연구 폴더 런북 §3.1의 문장 단위 고정 대본 2벌.
- **세트 큐레이션** — subtype 독립 라벨링 → 자연 비율 산출 → 세트 추출 스크립트(검토 세트 + 테스트 세트).
- **최종 설문 Qualtrics 2벌** + 화면 썸네일 2장.
- **시스템**: §10 전체.
- **IRB amendment**.

### 11.2 [파일럿] 확정할 것

- 세션 총 **92분**이 지켜지는가 · 작업 상한 25분의 소화 · 검토 세트 규모(유형당 12 vs 15)
- **과제 명시**(§6.2)가 초반 헤맴을 실제로 없애는가 · 배너가 시야를 방해하지 않는가 · "정해진 분량 없음"이 오히려 **적게 하도록** 부추기지 않는가
- **TLX** 5문항이 1분에 끝나는가 · Deploy → TLX → Pass 1에서 응답 백그라운드 생성이 제때 끝나는가 · **W3의 뒤집힌 앵커**를 헷갈리는가 · W3이 여전히 "무엇에 비추어 답하나"를 되묻는가(되물으면 **Temporal보다 먼저** 삭제)
- **블록 테스트** Pass 1 ~4.5분 / Pass 2 ~3.5분 · 서술 타이핑 부담 · 프로브 상한 필요 여부 · **Clay 구간 선택이 쓸 만한가** · Pass 2 재표시가 회상을 충분히 받치는가
- **최종 설문** 22 평정 + 5 비교 + 2 서술이 4분에 들어오는가 · **Side by Side 그리드(8행 × 2그룹 × 7점)가 노트북에서 스크롤 없이 보이는가** · **Slate/Clay 이름이 40분 뒤 회상에서 변별되는가** · 양극 척도 방향 혼동 · 역문항 L2 오독
- **데모 영상** 소요(블록1 ~4분 / 블록2 ~3분)와 이해도 · 재생 후 Q&A 길이
- 척도: 판정 5점 / 설문·TLX 7점의 **혼재가 문제를 일으키는가**(TLX 7점 → 1분 뒤 판정 5점의 인접)

### 11.3 [운영] 결정할 것

- 데모 영상 녹화 담당·자막·업로드 위치
- Zoom 녹화 방식(클라우드/로컬)·저장 위치·파일명 규칙
- 보상 지급 기한 · 부분 참여(기술 문제로 중단) 시 보상 정책
- 종료 후 "어느 쪽이 새 것이냐"는 질문에 사실대로 답할지
- 동의서 문구와 현 절차의 정합 확인

---

## 12. 결정 이력 (왜 지금 이 모습인가)

| 날짜 | 결정 | 요지 |
|---|---|---|
| 08-08 | 초기 설계 | 4단계 블록 테스트 · think-aloud 포함 · 데모 영상 · A/B 포함 |
| 08-10 | **A/B 삭제 · 질적 중심 전환** | A/B는 "두 설정이 같은 의도를 인코딩했다"를 전제하는데 그게 곧 우리 가설과 충돌 |
| 08-10 | think-aloud 삭제 | 참가자 부담. 관찰 메모 + 인터뷰 회고로 대체 |
| 08-10 | 영상 → 라이브 시연 | 교수 의견(실제 동작을 설명과 함께) — **08-18에 번복** |
| 08-10 | 90분·$60·16명 확정 | 작업 25분 상한이 여기서 강제됨 |
| 08-10 | RQ 순서 개정 | 과정 우선: Organization → Comprehension → Alignment |
| 08-12 | 모집 경로 확정 | 메일링 리스트 재접촉 · 중등교사 포함 · NIRVANA 사전 노출 대응 |
| 08-14 | 사전 폼 2단계 분할 | 동의서 링크 = 예약 확인 메일, 리마인더 = 1시간 전 |
| 08-15 | **RQ2 = comprehension 단일 construct** | 통제감·신뢰를 RQ2에서 분리. 문헌으로 정의·측정 선례 고정 |
| 08-15 | **블록 테스트 2-pass** | 저작이 끝난 시점의 mental model을 고정해서 재기 위해 |
| 08-15 | 블록 테스트 구두 문항 삭제 | 전부 UI 입력. think-aloud를 뺀 원칙과 같은 선상 |
| **08-18** | **설문을 세션 말미 비교 설문으로** | 첫 블록 평정에 비교 앵커가 없고, 테스트 직후 평정은 응답 성적에 끌린다 |
| **08-18** | **부담 = NASA-TLX 하위척도 5**, Deploy 직후로 | 동의문 2문항은 하위척도가 아니었고, 테스트 후 배치는 "과제 직후"를 어겼다. UBS는 검토 후 불채택(장기 사용 부담 척도라 대상이 다름) |
| **08-18** | **버전 명칭 Slate / Clay 고정** | 순서 라벨은 참가자마다 다른 것을 가리켜 고정 산출물에 못 쓰고 "두 번째=개선판" 오독을 부른다 |
| **08-18** | **튜토리얼 = 데모 영상 3편** (08-10 번복) | 파일럿에서 라이브의 변인 통제가 실제로 어려움을 확인 |
| **08-18** | **과제를 화면에 명시** | 시스템이 과제를 말하지 않아 초반 헤맴 발생. TLX가 지칭할 대상도 없었다. **경계는 주되 기준은 주지 않는다** |
| **08-18** | **블록 테스트 Pass 1 순서 = 포인팅 → 서술 → 짐작** | 파일럿에서 참가자가 서술 칸을 지나쳐 포인팅부터 했다. 그 순서가 예측 가능성 기제의 순서다 — 서술을 먼저 요구하면 재려는 기제를 끄고 예측하게 만든다. 대가는 V3이 cued가 되는 것(V2·V3을 독립 지표로 쓰지 않는다) |
| **08-18** | **최종 설문 저작 경험 13 → 8문항** | 분석 계획이 비확증인데 문항만 늘면 검정하지 않을 막대만 늘어난다. 남긴 기준 = "다른 측정이 못 잡는 것을 잡는가" |

---

## 13. 이것만은 건드리지 말 것 (불변식)

구현·운영 중에 "좋아 보여서" 바꾸면 연구가 깨지는 것들.

1. **두 조건의 차이는 수정 범위 하나뿐이다.** 셸·AI 표면·프리뷰·검색·생성 chooser는 문자 그대로 같은 코드여야 한다. 한쪽에만 편의 기능을 넣지 않는다.
2. **참가자 표면에 `SCORE`·`baseline`·`intent`(Clay 조건)라는 단어가 뜨지 않는다.** 에러 문구까지.
3. **Pass 1에서 응답을 보여 주지 않는다.** 힌트도, 미리보기도, 로딩 중 일부 텍스트도.
4. **블록 테스트 중 진행자는 개입하지 않는다** — UI만으로 완결되어야 한다.
5. **작업 화면에 카운트다운을 표시하지 않는다.** (남은 시간의 카운트다운이 금지 대상이고, **경과 표시는 허용** — §5.2)
6. **과제 문구는 경계만 말하고 기준을 말하지 않는다** — "몇 개를 보세요/고치세요"가 들어가는 순간 RQ1의 측정값이 사라진다.
7. **버전 이름의 뜻을 참가자에게 설명하지 않는다.**
8. **최종 설문의 열 순서는 참가자가 쓴 순서**(먼저 쓴 것이 왼쪽) — 조건을 열 위치에 고정하면 좌측 우선 편향이 한 조건에 몰린다.
9. **세션 중 참가자의 두 보드 탭을 닫지 않는다.**
10. **4셀 균형 배정을 지킨다** — NIRVANA 사전 노출 비대칭이 조건 대비에 실리지 않게 하는 유일한 장치다.

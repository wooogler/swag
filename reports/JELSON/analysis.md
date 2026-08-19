# JELSON 파일럿 세션 로그 분석

> 작성 2026-08-17 (§7 인터뷰는 2026-08-18 추가). 재료: `reports/JELSON/` (timeline · snapshots · rules · block-test · survey) + DB 보강(블록 테스트의 실제 라우팅·응답 `study_generated_responses`, 룰 버전의 피드백 원문 `score_rule_versions.instruction`, 7059의 판정 이력 `score_intent_ratings`, 검토 세트의 subtype). 참가자 셀 1: **블록 1 = Baseline × SWAG, 블록 2 = SCORE × NIRVANA**.
> 읽기(GET)는 로깅되지 않으므로 "무엇을 봤는가"는 알 수 없고, "무엇에 손댔는가"만 안다.

---

## 0. 한눈에

| | 블록 1 · Baseline (SWAG) | 블록 2 · SCORE (NIRVANA) |
|---|---|---|
| 작업 시간 | **28.0분** (상한 25) | **34.5분** (상한 25) |
| 손댄 질문 (앵커·핀) | 7개 — drafting 1 · planning 4 · translating 2 · **reviewing 0** | 앵커 8 + 핀 18개 질문 — planning 집중(검토 15개 중 12개) · reviewing 4 · drafting 6 · **translating 0** |
| 만든 것 | RULES 문서 1개, 260 → **1,774자**(×6.8), 저장 6회 (버전 19개) | intent 7개 (정의) + rule **4개** (3개 intent·4개 type-root는 rule 없음) |
| AI 보조 의존 | 편집 12회 중 10회가 feedback/rewrite 경유(direct 2회: 문장 1·숫자 1); rewrite 제안 6/7 채택(3회는 제안 전부 그대로) | intent 7/7 제안·템플릿에서 출발; 핀 이유 19개 중 15개가 제안 문구 그대로(13개는 1순위); fold 14회 |
| 블록 테스트 평균 (5점) | **3.75** (5,5,3,1,5,4,2,5) | **3.50** (1,1,4,2,5,5,5,5) |
| 실패 양상 | 문서가 명목상 다 덮는데 **잘못 적용/간섭** (essay 요청을 그대로 써줌 1점, 아이디어 요청에 outline 2점) | **미커버** — rule 없는 type/intent로 빠져 시스템 프롬프트 없이 답함(1,1,2점). **rule이 있는 4문항은 전부 5점** |
| 예측 정확도 (예/아니오 ↔ ≤3=아니오) | 5/8 (전부 '예'라 함) | 6/8 (translating 1문항은 '아니오'로 맞힘) |
| 귀속(포인팅) | span 8/8 지목; 그럴듯 6/8 | intent 정확 3/8 + 'none' 정답 1/8; **커버리지 과대평가 2**(rule 있는 intent를 짚었으나 실제는 type default) |
| 설문 (7점) | 통제 5·5 / 부담 6·3 / 신뢰 6 | 통제 5·**3** / 부담 6·**4** / 신뢰 6 |

한 줄 요약: **JELSON의 의도는 두 블록에서 동일하고 일관된다("nudge, don't solve" — 써주지 말고, 짧게, 출발점만, 빈칸 채우기 금지, 본인 글의 소소한 교정은 허용). Baseline에서는 그 의도를 한 문서에 담아 전역 적용됐지만 모델이 일부 문항에서 문서를 따르지 않았고, SCORE에서는 의도를 intent마다 다시 써야 해서 시간이 모자라 반 이상이 비어 있는 채 배포됐다.** 두 블록의 평균 점수는 비슷하지만 실패의 종류가 정반대다.

---

## 1. 세션 타임라인

| 시각 | 단계 | 소요 |
|---|---|---|
| 16:53 / 17:06 | 참가자 생성 / 로그인 | (튜토리얼·소개 ~10분) |
| 17:16:16 – 17:44:17 | **블록 1 작업** (baseline) | 28.0분 |
| 17:44:17 – 17:54:13 | 블록 1 테스트 (Pass 1 5.9분 · Pass 2 3.1분) | 9.9분 |
| 17:54:13 – 17:54:43 | 블록 1 설문 | 0.5분 |
| 17:54:43 – 18:01:23 | 휴식 (+블록 2 차이점 시연) | 6.7분 |
| 18:01:23 – 18:35:52 | **블록 2 작업** (score) | 34.5분 |
| 18:35:52 – 18:40:22 | 블록 2 테스트 (Pass 1 2.2분 · Pass 2 2.1분) | 4.5분 |
| 18:40:22 – 18:40:46 | 블록 2 설문 → done | 0.4분 |

로그인부터 done까지 **94.5분** (+인터뷰). 설계 90분에서 초과분은 거의 전부 작업 단계 초과(+3.0, +9.5)에서 왔다. 블록 1 테스트 Pass 1은 첫 문항까지 2분이 걸렸다(첫 문항 설명·UI 적응으로 추정).

---

## 2. 블록 1 — Baseline (SWAG)

### 2.1 과정

7개 질문을 앵커로 RULES 문서를 6번 저장했다. 진행 순서와 JELSON의 피드백 원문(`instruction`):

| 시각 | 앵커 (type/subtype) | 경로 | JELSON의 입력 (원문) | 결과 버전 |
|---|---|---|---|---|
| 17:18 | 129458 drafting/Regenerate — 과제 프롬프트 붙여넣고 essay 요청 | direct 편집 | "When a student asks for you to write a essay for them, do not do it. If they give you examples, you can help them expand on their ideas but refrain from generating the essay text for them" | v2 |
| 17:19 | 〃 | feedback | "This is still generating text. Do not give them a draft" | v3 → **저장 v4** |
| 17:23 | 129434 planning/Factual Lookup "Explain the meaning of correspondence?" | rewrite (제안 4개 중 1개 취지 + 자작) | "If they do not ask for it, do not give them fill in the blanks or sentence tips. Planning questions like this should just give the definitions and examples (and memory tip)" | v5 |
| 17:25 | 129428 planning/Answer a Topic Q "Explain how human emotions and AI related…" | rewrite (제안 3개 중 1개) | "Use nested bullets to separate key points from details." | v6 → **저장 v7** |
| 17:30 | 129484 planning/Recommend Topics — 과제 프롬프트 붙여넣기 | rewrite (**제안 4개 전부**) | "Trim prompts to only the essential ideas… / Avoid extra illustrative examples… / Keep each section focused on one main point… / Omit sentence frames…" | v8 |
| 17:32 | 〃 | feedback | "it still had a little too much detail. please give shorter responses that answer the student question directly without doing most of the thinking for them. They still need to critically engage with the topic so just give them starting points for their thinking" | v9 → **저장 v10** |
| 17:34 | 129516 planning/Essay Structure "Create an outline for me…" | rewrite (**제안 3개 전부**) | "Limit the outline to the prompt's requested sections only. / Do not add a separate conclusion suggestion… / Omit word-count recommendations…" | v11 |
| 17:35 | 〃 | rewrite (**제안 4개 전부**) | "Embed guidance directly under each section… / Keep section-specific advice close… / Omit word-count… / Prioritize a clearer outline structure…" | v12 |
| 17:36 | 〃 | direct 편집 ("3" → "1-3", "2" → "1-2") | — | v13 → **저장 v14** |
| 17:38 | 129438 translating/Paragraph from Idea "write a short paragraph based on my opinion…" | feedback | "Do not write the paragraph for them. If they ask for you to write give them outline advice" | v15 |
| 17:39 | 〃 | rewrite (제안 3개 중 2개) | "Avoid optional assistance prompts… / Keep responses concise by omitting unnecessary closing offers." | v16 → **저장 v17** |
| 17:41 | 129444 translating/Paragraph from Idea "Make this a complete sentences: …" | feedback | "When the student gives you their essay and asks for helping with rewrite or proofing you can make small edits. SO this case is where they want you to help make their sentences complete and not being messed up. You can rewrite for them in this case" | v18 → **저장 v19** |
| 17:44 | — | **배포 v1** | | |

관찰:
- **type 순회: drafting(1) → planning(4) → translating(2). reviewing은 한 번도 손대지 않았다.** 그런데 최종 문서에는 proofread 조항이 있다 — translating 앵커(129444 "complete sentences")에 대한 피드백을 rewrite 모델이 "paste their own essay… rewrite or proofread → small edits, ≤4 revised sentences"로 일반화한 결과다. 이 조항이 테스트의 reviewing 2문항(q6, q7)을 5점으로 만들었다 — **참가자가 다루지 않은 영역이 모델의 일반화로 '우연히' 덮인 사례**.
- 자연어 검색 1회(25건) 후 filter 저장 없음. `suggest_intents` 1회 호출, 미채택.
- rewrite 제안 채택률: 7회 중 6회 채택(60초 휴리스틱은 5회로 집계 — 1건은 63초 뒤 채택). **3회는 제안된 bullet을 하나도 빼지 않고 전부 채택**(v8, v11, v12). rewrite = "제안 전부 수락"이 기본 동작이었다.
- 저장(major)마다 시스템이 59문항 프리뷰를 자동 생성(rule_apply 6회 × 59) — 참가자 행위가 아니라 Save의 부수효과.
- 문서는 단락 하나, 제목 없음. 8개 조건절이 한 문단에 이어진다("Answer understanding questions… / When students ask you to write… / If they paste their own essay… / When students ask for help planning… / For outline and structure requests… / In every reply…").
- rewrite/feedback 모델의 지문: **"If they push back / ask again… restate the boundary"** 절이 v3부터 끝까지 매 버전에 남아 있는데, JELSON의 입력에는 그런 요구가 한 번도 없다. 모델이 넣은 것이다. (블록 2의 rule 4개에도 전부 같은 절이 들어갔다.)

### 2.2 최종 아티팩트 (배포 v1 = rule v19, 1,774자)

의도 8개가 한 단락에: ① 이해 질문 → 정의+예 1+기억팁, 1-3 top bullets ② 써달라 → 쓰지 말고 outline 조언(≤3 fragmentary bullets) ③ 본인 글 proofread → 소소한 교정(≤4 revised sentences) ④ 재요청 시 거절 ⑤ 계획/outline → thinking-support level ⑥ outline은 과제 필수 섹션만, 팁 목록·결론 제안·분량 추천 금지 ⑦ 마무리 권유문 금지 ⑧ "nudge, not solve".

### 2.3 블록 테스트 (SWAG 8문항)

| q | type/subtype | 예측(서술) | 지목한 span | 실제 응답 | 점수 | "무엇이 달랐나" / 프로브 |
|---|---|---|---|---|---|---|
| 2 | drafting/Write Conclusion "write the essay… title it…" | outline+tips | ② 써달라→outline | 거절 + 섹션별 outline | **5** | |
| 5 | drafting/Write Conclusion — 과제 붙여넣고 "I will provide a thesis for each paragraph, you expand them into full paragraphs, include intro and conclusion" | outline과 tools | ② | **intro·본문 3단락 전부 써줌 (2,703자)** | **1** | "it gave them a full rewrite instead of just guiding them" / "This was probably read as a reviewing code… proofreading it for them, so it rewrote it as well" |
| 6 | reviewing/Proofread "can you review this" | 실수 지적 | ③ proofread | 교정 목록 + 4문장 수정 | **5** | |
| 4 | translating/Paragraph from Idea (문장 완성) | 샘플 문장 | ③ "≤4 revised sentences" | 어구 2안 + 예문 | **4** | |
| 3 | translating/Paragraph from Idea "how can i end this" | 마무리 아이디어 | ② | 3 bullets 조언 | **5** | |
| 1 | planning/Essay Structure "What do you think of… how to start this prompt" | 아이디어 제공 | ① 이해 질문 조항 | 3 bullets **outline** | **2** | "this gives more of a outline" / "I expected it to build upon their ideas and help them think, but instead, it gave them a writing/thesis outline" |
| 7 | reviewing/Proofread "Now editor, provide me feedback: my answer: …" | proofing+feedback | ③ | 긴 구조화 피드백(3,462자 — 조항의 분량 제한은 무시됨) | **5** | |
| 0 | planning/Essay Structure "Give me a idea of good format" | outline | ⑤ 계획 조항 | Intro/Body1/Body2 3 bullets | **3** | "It is a little short" / "gave them a minimal outline without helping them answer the prompt itself" |

실패 3건의 성격:
- **q5 (1점)**: 문서가 명시적으로 금지한 행동("do not write the paragraph… no paste-ready text")을 모델이 어겼다. 학생이 "thesis를 줄 테니 expand해라"고 지시하자 시스템 프롬프트보다 학생 지시를 따랐다. JELSON이 블록 첫 3분에 가장 먼저 막으려던 바로 그 행동. 프로브의 자기 진단(reviewing 조항과 섞였을 것)은 **간섭 가설**에 해당하고, 진위와 무관하게 참가자가 monolithic 문서를 그렇게 읽는다는 점이 데이터.
- **q1 (2점)**: 참가자는 ①(이해 질문) 조항을 짚었지만 실제로 발화한 건 ⑤/⑥(계획·outline) 조항 — **엉뚱한 절이 잡았다.** 귀속 실패.
- **q0 (3점)**: 문서가 시킨 대로 했다(필수 섹션만, 팁 없음) — 129516 앵커에서 본인이 "outline은 요청 섹션만, 팁 목록 금지"라고 조인 결과가 다른 outline 질문에서 **과잉일반화**됐다.
- 예/아니오 짐작을 8문항 전부 '예'라고 했다 → 확신 보정: 짐작 8 vs 실제 부합 5.

---

## 3. 블록 2 — SCORE (NIRVANA)

### 3.1 과정 — 두 국면

**국면 A: 정의 만들기 18:01:51 – 18:24:14 (22.4분).** intent 7개.

| intent | type | 시작 | 출처 | 핀 (in/out) | fold | 소요 |
|---|---|---|---|---|---|---|
| 7059 Generate Task Examples | planning | 18:01:51 | 제안 1순위 (앵커 129947 "examples for a machine doing better…") | **17회 (in 12 / out 5; 같은 질문 재핀 5회)** | **10** | **13.7분** |
| 7060 Interpret Assignment Requirements | planning | 18:07:39 | 제안 2순위, 그대로 | 0 | 0 | 10초 |
| 7061 Proofread | reviewing | 18:16:15 | **템플릿** + 한 문장 덧붙임 | 0 | 0 | 33초 |
| 7062 Rewrite to Spec | reviewing | 18:17:09 | **템플릿** | out 2 | 1 | 57초 |
| 7063 Generate Text with a criteria | drafting | 18:19:25 | **템플릿**(Regenerate with Feedback) 정의 그대로 + 제목만 자작 | 0 | 0 | 11초 |
| 7064 Draft Body Paragraph | drafting | 18:19:53 | 제안 1순위 | out 2 (+1 철회) | 1 | 1.6분 |
| 7065 Draft Prompt Essay | drafting | 18:21:48 | 제안 1순위 | in 2 / out 1 | 2 | 2.4분 |

**국면 B: rule 쓰기 18:25:31 – 18:35:38 (10.1분).** rule 4개.

| intent | JELSON의 피드백 원문 | 버전 |
|---|---|---|
| 7059 | "These are long. try to give them shorter repsones that provide the example they ask for but not give them the full cognitive thinking step. They need to figure out how to incoporate it in on their own" → direct 편집 "3" → "3-5" | 저장 v4 |
| 7062 | "dont rewrite for the but guide them in how to rewrite" | 저장 v3 |
| 7063 | "do not write for them but help them to understand what makes it fall into the criteria that they are asking for and help them to think through it and write it themselves" | 저장 v3 |
| 7064 | ① "dont write paragraphs. make them supply the ideas then help them by giving them outlines…" ② "this is a little long. paragraphs are 4-6 sentences so focus more on just telling them what the points are…" ③ "do not give fill in the blanks. give them ways that they can figure out how to write the sentence so: Main point: This should describe the theme of the argument [optional if given: your theme of ____ fits here]" ④ rewrite(제안 5개 중 3개) "Use more general wording… / Keep the scaffold shorter… / Focus on broad paragraph roles…" | 저장 v4, v7 |
| **7060, 7061, 7065** | **rule 없음** | |
| **type-root 4개** | **rule 없음** | |

18:35:38 마지막 저장 → **18:35:45 배포** (7초). 배포 모달의 "No rule yet" 표시를 검토할 시간은 없었다.

관찰:
- 시간의 40%(13.7/34.5분)를 intent 하나의 정의에 썼다. 나머지 6개 intent 정의에 8.7분, rule 4개에 10분.
- **translating은 intent도 rule도 없다** (블록 1에서는 translating을 마지막에 2개 다뤘고 reviewing을 안 다뤘다 — 두 블록 모두 마지막 type 하나가 비었다: 시간 부족의 신호).
- rule 4개는 내용이 사실상 하나다 — "쓰지 말고, 짧게, 출발점만, 빈칸 금지, 재요청 시 거절." JELSON의 교육 철학은 전역적 stance인데 SCORE에서는 intent마다 다시 표현해야 했고, **4번 반복하고 3번은 못 했다.** Baseline 문서의 문장이 그대로 재등장한다(no fill-in-the-blank, at most 4 items, outline-level, refuse briefly) — 인터뷰 ③("첫 블록 것을 다시 만들려 했나")의 답은 로그상 "그렇다".
- AI 보조: `suggest_intents` 7/7 사용(4개 제목 채택, 3개는 템플릿 선택), `suggest_reasons` 32회 호출, 남은 핀 이유 19개 중 15개가 제안 문구 그대로(그중 13개는 **1순위 제안**). 자작 이유 4개는 모두 재핀이나 경계 사례("Asking for multiple paragraphs. this intent is 1 paragraph only", "asks to write full essay and gives prompt or idea as context only", "Examples and all supporting evidence claims that are for research purposes should be in", "pros and cons are all asking for evidence for their work/research step").

### 3.2 7059 "Generate Task Examples"의 13분 — fold 루프가 수렴하지 않은 기록

정의는 288자 → **1,127자**(×3.9)로 자랐고 제목은 그대로다. 최종 정의는 "provide, find, suggest, or develop research material for a writing assignment about machines/AI/automation… evidence, factual claims, examples, statistics, argument material, affected jobs, industry uses, employment effects, historical rates, future trends, pros and cons… but not opinion / pasted prompt / vague 'build on' / outlines" — 즉 **planning type의 'Answer a Topic Question' 대부분을 흡수한 catch-all**이 됐다. 제목("Task Examples")과 정의의 괴리가 크다.

왜 13분이 걸렸나 — 판정 이력(`score_intent_ratings`, 44개 planning 질문 × 재판정 13회)을 fold 단위로 보면:

| 재판정 | 시각 | 소비된 핀 | 의도한 수정 | **부수 flip** (핀 안 한 질문의 in↔out) | 그중 **이전 핀의 회귀** |
|---|---|---|---|---|---|
| 1 | 18:01:56 | (초기) | | in 5 | |
| 2 | 18:02:32 | 130027 in | 1/1 | 5 | 0 |
| 3 | 18:03:29 | 129889 in | 1/1 | **10** (in 9 → 20: 정의가 크게 넓어짐) | 0 |
| 4 | 18:04:41 | 129977·130051·130101 in | 3/3 | 7 | 0 |
| 5 | 18:05:15 | 130107 in | 1/1 | 3 | 0 |
| 6 | 18:06:12 | 129893·129941 **out** | 2/2 | 3 | 0 |
| 7 | 18:07:02 | 129891 out | 1/1 | 2 | 0 |
| 8 | 18:08:53 | (create — **정의 변화 없음**) | — | **4** | **1** (129941 out→in) |
| 9 | 18:09:51 | 129941 out (재핀) | 1/1 | 4 | **1** (130107 in→out) |
| 10 | 18:11:04 | 130107 in (재핀) | 1/1 | 3 | **1** (130051 in→out) |
| 11-12 | 18:13:32 | 130051 in (재핀) + 129835·130055·129900 in | 4/4 | 1 | **1** (129941 out→in, 세 번째) |
| 13 | 18:15:03 | 129941 out (3번째 핀) + 130051 in (3번째 핀) | 1/2 (130051은 probably_in으로 남음) | 1 | 0 |

- 12번의 재판정에서 **부수 flip 43건**, 그중 **핀으로 정한 판정이 뒤집힌 회귀 4건** → 같은 질문을 다시 핀 5회 (129941 "Automation is generally seen as a sign of progress…" 3회, 130051 "what does the future of automation look like" 3회, 130107 "Unemployment rate in the 1950s" 2회).
- 재판정 8은 정의가 한 글자도 안 바뀐 재판정(create로 hash가 바뀜)인데 4/44 = **9%가 뒤집혔다** — 순수 test-retest 잡음 (기존 안정성 측정의 5.4%와 같은 현상).
- 한 번도 핀 안 한 문맥 턴 3개(130043·129873·129829)는 5~7번 왔다 갔다 했다.
- 두더지잡기의 구조: 핀 하나 → 즉시 fold → 전체 재판정 → 다른 질문이 튐 → 핀 → fold … 워크벤치의 "Needs decision"(probably_in) 목록이 결정을 하나씩 유도하고, JELSON은 결정 1~2개마다 fold를 눌렀다(핀 17개에 fold 10회). fold마다 정의가 다시 쓰이므로 매번 경계 전체가 흔들린다.
- 최종적으로 130051은 세 번 in으로 핀했는데도 probably_in(=미소속)으로 끝났다 — 소비된 핀은 판정을 강제하지 않으므로.

이 13분은 RQ1의 "correction과 이유" 데이터인 동시에, **본 스터디 전에 손볼 시스템 이슈**다(§6).

### 3.3 최종 아티팩트 (배포 v1)

| intent | type | rule | 검토 세트 소속(inCount) |
|---|---|---|---|
| Generate Task Examples | planning | ○ (3-5 bullets 스니펫만) | 10 |
| Interpret Assignment Requirements | planning | **×** | 1 |
| Proofread | reviewing | **×** | 10 |
| Rewrite to Spec | reviewing | ○ (고쳐주지 말고 guidance) | 5 |
| Generate Text with a criteria | drafting | ○ (revision steps ≤3 + stem 1) | 5 |
| Draft Body Paragraph | drafting | ○ (scaffold ≤4 items) | 4 |
| Draft Prompt Essay | drafting | **×** | 5 |
| Planning / Translating / Reviewing / Drafting root | — | **× × × ×** | |

NIRVANA는 base prompt가 비어 있으므로 rule 없는 곳에 걸리면 **시스템 프롬프트 없이** 답한다(`buildInjectedSystemPrompt('') = ''`). 즉 배포된 설정에서 (a) translating 질문 전부, (b) planning 중 7059가 안 잡는 것, (c) reviewing 중 7062가 안 잡는 것(proofread 포함), (d) **"essay 통째로 써줘"(7065)** 는 전부 맨 GPT다. JELSON이 가장 막고 싶어 한 (d)에 rule이 없다 — 정의에는 2.4분(핀 3개, fold 2회)을 썼고 rule은 못 썼다.

### 3.4 블록 테스트 (NIRVANA 8문항) — 실제 라우팅과 대조

| q | type/subtype | 예측 | 지목 intent | **실제 라우팅** | 응답 | 점수 | "무엇이 달랐나" / 프로브 |
|---|---|---|---|---|---|---|---|
| 2 | reviewing/Give Feedback "look at this essay I wrote" | proof | 7061 Proofread (rule 없음) | **type default** (rule 없음) | 긴 피드백+제안 | 4 | "It gave more rewrites than I expected" |
| 4 | drafting/Regenerate "Pretend you are a college student… write an essay" | outline | 7063 | **7064** Draft Body Paragraph | 4-bullet scaffold | 5 | "it did good" |
| 1 | planning/Answer a Topic Q "give me an alternative view to these three" | paragraph outline | 7059 | **type default** (7059가 out으로 판정) | **"Perspective Four" 단락 통째로** | **1** | "It wrote the paragraph for them" / "probably did not see this as a examples question so it wasnt in my criteria" |
| 7 | planning/Answer a Topic Q "Where is automation used most" | examples | 7059 | 7059 ✓ | 4 bullets | 5 | |
| 3 | translating/Paragraph from Idea "How would I put that into a thesis statement" | thesis 줄 것 | **none, 짐작 '아니오'** | type default ✓ | thesis 통째로 | 2 | "it gave the full thesis instead of helping them write it" |
| 6 | reviewing/Proofread "make it better for an essays introduction" | tools to rewrite | 7062 | 7062 ✓ | 수정 가이드 | 5 | |
| 0 | translating/Paragraph from Idea "Finish the sentence: …" | tools to rewrite | 7062 Rewrite to Spec (reviewing) | **type default (Translating)** | 문장 완성해 줌 | **1** | "it did all the work for them" / "I am unsure. maybe I thought it was a different criteria then expected" |
| 5 | drafting/Write a Section "write a conclusion" | outline | 7064 | 7064 ✓ | 3-bullet scaffold | 5 | |

- **rule에 걸린 4문항(q4·5·6·7) = 전부 5점. 안 걸린 4문항 = 1·1·2·4.** 블록 2의 점수는 거의 전적으로 커버리지 이야기다.
- 귀속: 정확 3/8(q5·6·7) + 'none' 정답 1/8(q3). q4는 다른 intent를 짚었으나 같은 type의 유사 rule이라 결과 무관. **q0·q1은 rule이 있는 intent를 짚었지만 실제로는 아무 rule도 안 걸렸다 — 자기 설정의 커버리지를 과대평가.** q0은 translating 질문에 reviewing intent를 짚었다: **라우팅이 type-first(질문의 type이 먼저 고정되고 그 type의 intent만 후보)라는 점이 mental model에 없었다.** q3에서는 반대로 "translating은 안 만들었으니 안 될 것"을 정확히 예측했다 — 부분적으로만 알고 있었다는 뜻.
- q1: 7059가 out으로 판정한 이유는 JELSON이 직접 핀한 exclusion(129891 "build upon these perspectives" out, 129941 pasted prompt out)이 fold를 거치며 "vaguely asks to discuss or build on such prompts → out"으로 일반화된 데 있다. 본인이 준 예외가 본인이 원하는 문항을 밀어냈고, 그 사실을 미리 예측하지 못했다(프로브에서는 사후에 정확히 진단).
- Pass 1 소요 문항당 **~16초**(블록 1은 33초, 첫 문항 제외) — intent 클릭이 span 선택보다 빠르고, 순서 효과도 섞여 있다.
- 확신 보정: 짐작 '예' 7 vs 실제 부합 5.

---

## 4. 두 블록 비교 — RQ별로

**RQ1 (Organization).** 같은 사람, 같은 의도, 다른 표현.
- Baseline: 의도가 한 문서에 8개 조건절로 쌓였고, 참가자는 **질문 하나 → 피드백 → 문서 전체 재작성**을 6번 반복했다. 손댄 type이 3개인데 문서는 4개 type을 다 덮는다(모델의 일반화). 결과물의 조직은 참가자가 아니라 rewrite 모델이 했다(조항 순서·문구·"push back" 절).
- SCORE: 의도가 7개 intent로 쪼개졌고 정의는 fold, rule은 feedback으로 썼다. **표명된 의도의 개수는 훨씬 많지만(7 vs 1) 완성된 것은 4개**, 그리고 4개 rule의 내용은 동일한 stance의 변주다. 시간이 한 intent의 경계 조정(13.7분)에 빨려 들어갔다.
- 두 블록에서 참가자가 **직접 타이핑한 rule 문장은 블록 1의 첫 편집(v2) 한 문장뿐**이다 — 이후로는 피드백 문장(짧은 영어 1~3문장)을 주고 모델이 rule을 쓰게 하는 방식이 일관됐다. 나머지 direct 편집 2회는 숫자 조정("3"→"1-3", "3"→"3-5").

**RQ2 (Comprehension).** 예측 정확도 5/8 vs 6/8로 비슷. 귀속은 다른 방식으로 틀린다 — Baseline은 "어느 절이 잡을지"(q1), SCORE는 "잡히기는 하는지"(q0·q1)를 틀렸다. SCORE의 mental-model 결손은 구체적으로 둘: ① type-first 라우팅, ② rule 없는 intent/type = 무지시 응답.

**RQ3 (Alignment).** 평균 3.75 vs 3.50. misalignment 코딩(잠정):
- Baseline: 미반영/불복종(q5) · 간섭/오귀속(q1) · 과잉일반화(q0).
- SCORE: 미커버(q0·q1·q3, 그리고 q2도 형식상 미커버) — 커버된 곳은 부합 100%.
- 이식성(인터뷰 ⑤) 관점: 7059의 정의는 "machines/AI/automation… human labor"에 묶여 있어 다른 과제로 못 간다. Baseline 문서는 과제 독립적으로 쓰였다.

---

## 5. 설문 (7점)

| 문항 | Baseline | SCORE |
|---|---|---|
| I felt in control of how the chatbot will behave | 5 | 5 |
| I could get the chatbot to behave the way I wanted | 5 | **3** |
| Setting up was mentally demanding | 6 | 6 |
| I felt frustrated while setting it up | 3 | **4** |
| I trust this chatbot to handle future questions in line with my intent | 6 | 6 |

"원하는 대로 되게 할 수 있었다"가 SCORE에서 2점 낮고 좌절감이 1점 높다 — 7059 루프와 미완성 배포에 부합. 신뢰는 둘 다 6으로 같다(테스트에서 1점짜리를 두 개씩 보고도).

---

## 6. 파일럿에서 드러난 것 — 프로토콜 · 시스템 · 계측

**프로토콜**
1. 작업 상한 25분이 두 블록 모두 넘었다(+3, +9.5). 진행자가 끊지 않으면 SCORE 블록은 특히 길어진다. 설계의 fallback(25→22분, 프로브 상한)보다 **상한을 실제로 집행하는 장치**(타이머 표시·진행자 알림)가 먼저다.
2. 블록 1 테스트 Pass 1의 첫 문항까지 2분 — 첫 문항 안내가 필요하거나, 안내를 시연에 포함해야 한다.
3. SCORE 튜토리얼에 **type-first 라우팅**과 **"rule 없는 intent/type은 아무 지시 없이 답한다"** 가 들어가야 한다. 이번 결과의 절반은 이 두 사실을 몰라서 생겼다고 볼 여지가 있고, 그렇다면 표현 형식의 효과가 아니라 교육의 효과를 재는 셈이 된다.
4. 관찰 메모 후보(인터뷰 회고 프로브): (a) 7059를 13분 동안 붙든 이유 — 무엇이 계속 틀려 보였나, (b) 7065 Draft Prompt Essay에 rule을 안 쓴 것이 시간 때문인지 몰라서인지, (c) translating을 두 블록 모두 뒤로 미룬 이유, (d) rewrite 제안을 전부 수락한 것이 동의여서인지 편의여서인지.

**시스템**
5. **fold 루프의 비수렴** (§3.2). 결정 하나마다 fold → 전체 재판정 → 부수 flip 43건, 핀 회귀 4건, 무변화 재판정에서도 9% flip. 고려할 것: 결정을 모았다가 한 번에 fold하도록 유도(fold 버튼을 결정 N개 이상에서 활성화, 또는 "N개 결정 대기 중" 카운터), fold 뒤 **소속 변화 diff**("이 fold로 8개가 들어오고 3개가 나갔습니다 — 그중 당신이 정한 것 1개가 뒤집혔습니다")를 정면에 보여주기, 소비된 핀이라도 로그 질문에 대해서는 판정을 고정하기(현재는 fold가 소비하면 강제력이 사라진다 — 설계 결정이므로 재검토 대상), 그리고 판정 안정성 자체.
6. **rule 없는 배포**. 배포 모달은 "No rule yet"을 표시하지만 JELSON은 마지막 저장 7초 뒤에 배포했다. "intent 3개·type 4개에 rule이 없습니다 — 그 질문들은 아무 지시 없이 답합니다"를 배포 전에 확인받는 한 단계가 필요하다(또는 진행자 대본에).
7. 제목–정의 괴리(7059): fold가 정의를 넓히는 동안 제목은 그대로다. fold가 제목 변경도 제안하거나(이미 `suggestedTitle`이 있으나 제목이 비었을 때만 쓰임), 정의가 크게 바뀌면 제목 재검토를 띄우는 것을 고려.
8. ~~모델의 습관~~ **정정(2026-08-19): 우리 propose 프롬프트가 모든 변형에 강제한 것**이다 — "if they push back…" 한 줄, 셀 수 있는 상한 하나, 빈칸 예시. 재측정 결과 상한·pushback은 강제하지 않아도 모델이 쓰므로 강제분은 삭제했고(세 줄 → 미완성-예시 한 줄), 준수율은 8/4/0 → 9/3/0로 유지됐다. 참가자 의도가 아닌 문구가 아티팩트를 오염시킨다는 지적 자체는 유효. 아티팩트 분석 시 이 지문을 분리해야 하고, 가능하면 프롬프트에서 억제.

**계측 (trail export)**
9. `revise_submit`에 참가자의 **피드백 원문**이 없다 — `score_rule_versions.instruction`에 있으므로 export에 넣을 것(이번 분석의 가장 유용한 데이터였다).
10. `block-test.csv`에 **실제 라우팅**(`study_generated_responses.applied`: intent·outcome·type)과 **응답 본문**을 넣을 것. 포인팅 채점과 misalignment 코딩이 이 두 열 없이는 안 된다.
11. `adopted_within_60s`는 1건을 놓쳤고(63초), 채택 여부는 텍스트로 정확히 판정할 수 있다 — rewrite는 `instruction`의 bullet과 제안 목록을, 핀 이유는 `reason`과 제안 목록을 문자열 대조하면 된다. 다만 핀 테이블은 재핀 시 덮어써서 **이전 이유가 사라진다** — pin_set 이벤트 payload에 이유 텍스트를 함께 남기는 것을 권한다.
12. **fold별 flip 리포트**를 export에 추가할 것 — `score_intent_ratings`의 hash-keyed 이력으로 §3.2 표를 자동 생성할 수 있다(정의 변경 시각 기준으로 pass를 묶고, 소비된 핀 대비 부수 flip·회귀를 센다). RQ1의 "correction 궤적"을 이것 없이는 서술하기 어렵다.
13. 핀·앵커의 질문 텍스트가 export에 없다(ID만) — `timeline`에 `message_text` 한 열을 붙이면 파일만으로 읽힌다.
14. 블록별 검토 세트 목록(message_id·type·subtype·certainty)이 export에 없다 — 커버리지 계산에 필요.

---

## 7. 세션 직후 인터뷰 (7분) — 발언 · 로그 대조 · 시사점

> 2026-08-18 추가. 재료: `docs/JELSON-Pilot-Interview.txt` (블록 2 설문 직후, 인터뷰 가이드 없이 즉석 5문항). 아래 "로그 대조"는 이 문서 §2–§6과 룰 생성 과정 재검토(2026-08-18: `rules/block2`, `score_rule_versions.instruction`, `score_rule_version_responses` 카운트)를 근거로 한다.

**한 줄 요약**: SCORE를 **선호**한다고 두 번 말했고(00:55, 04:11) 이유는 "rule이 격리돼 간섭이 없다"이다. 그런데 실제로 겪은 마찰은 전부 **정의/판정 쪽**(type 분할, fold 루프)이고, "클릭 순간"은 **baseline에서만** 있었다.

| # | 발언 (시각) | 로그 대조 | 시사점 |
|---|---|---|---|
| 7.1 | **체감 차이·선호** (00:55, 04:11): baseline = "giant system prompt", SCORE = "tailored for specific problems". SCORE 선호 — "planning을 고치면 이미 써둔 것이 깨질 수 있는데 criteria mode에선 그런 게 없다"; "blanket하게 'do X'라 쓰고 시스템이 어디에 적용되는지 알아내게 하는 것보다 내가 pre-filter 하는 게 낫다." | 블록 1 실패 3건 중 q5(1점)·q1(2점)이 정확히 간섭/오귀속 유형(§2.3) — 인식과 데이터 일치. SCORE 실패는 전부 미커버(§3.4). | RQ1의 논지를 참가자가 자기 말로 진술. 단, rule을 "조건+행동"("this is only for when they ask for examples, not when…")으로 이해 — 정의(WHEN)/rule(THEN) 분리를 별개로 인식하지 않음. 실제 rule 4개가 정의를 베껴 넣은 if-then인 것(룰 생성 재검토 A)과 같은 방향. |
| 7.2 | **type 분할과 싸웠다** (00:55, 04:11): "I was fighting with the criteria… it would classify things that I wanted classified together. I don't know if criteria should be based on the entire question set rather than planning/translating/reviewing." 예: "generate examples는 planning인데 translating과 섞인다." | q0에서 translating 질문에 reviewing intent 지목(§3.4) — §6.3은 튜토리얼 부족으로 읽었는데, 인터뷰를 보면 몰라서만이 아니라 **분할 자체가 본인 범주와 안 맞았다**. translating 재현율 48%·drafting 누수, multi-activity 9.8%(v7 gate)와 같은 지점. | v7 type-first를 흔드는 유일한 참가자 발언(N=1). 결정을 바꿀 근거는 아니지만 본 스터디 인터뷰 가이드에 "type 경계가 당신 범주와 맞았나"를 넣을 것. |
| 7.3 | **fold 루프의 좌절과 처방** (01:53): "it kept adding things back in that I had told it explicitly not to, or tried to remove things I said to keep in." 제안: "**첫 find 이후엔 도구가 스스로 추가하지 말고**, 전부 사이드바에 올려 내가 in/out 버튼 + 이유로 검토하게." | §3.2 그대로 — 재판정 12회, 부수 flip 43, 핀 결정 회귀 4, 재핀 5회. "explicitly not to"는 129941(out 3회). | 결정 원장 계획(08-18, 핀 비소비·holds)이 앞부분을 겨냥. 이 발언은 한 걸음 더 나감 — **정의 재작성이 다른 질문의 소속을 자동으로 바꾸는 것 자체를 원치 않음**. D3(델타 모집단) 결정 시 "fold 후 소속 변화는 적용이 아니라 검토 목록으로" 옵션에 힘이 실림. |
| 7.4 | **"클릭"은 baseline에서만, 7~8회 반복 후** (01:53–02:42): "all of my responses were becoming more and more what I wanted **across the board… even for questions I hadn't necessarily looked at yet**." SCORE의 클릭 순간은 언급 없음. | baseline은 저장마다 59문항 프리뷰 자동 생성(§2.1)으로 일반화가 보였다. SCORE는 **모든 rule이 앵커 1개로만 검증**됐고 나머지 응답은 Apply 이후 보드가 생성(`rule_apply` "v4 on 6"… 카운트가 저장 응답 수와 정확히 일치 → 세션 중 탭 전환 프리뷰 0회), 마지막 Apply→배포 7초. | 클릭 = 교차 질문 증거의 가시성. SCORE에 **Apply 전 in-scope 2~3개 응답 미리보기**가 필요하다는 근거가 로그에 이어 인터뷰에서도 나옴. |
| 7.5 | **첫 블록 재현 시도 / "intents는 one-time setup"** (03:18): "A little bit. 확실히 느리다 — intents를 먼저 만들어야 하니까." 그러나 "수업에서 여러 번 쓴다면 intent는 one-time setup이고 과제마다 fine-tuning만 하면 된다. baseline이면 과제마다 반복 사이클을 다시 돌아야 한다." | 재현은 로그상 "그렇다"(§3.1, rule 4개가 baseline 문서 문장의 변주). 그런데 **재사용 믿음과 산출물이 어긋남** — 7059 정의는 "machines/AI/automation… human labor"에 묶여 다른 과제로 못 감(§4 RQ3). fold가 정의를 과제 특정적으로 키우는 동안 참가자는 이식 가능하다고 믿었다. | 인터뷰 ⑤(이식성) 프로브를 "이 정의를 다른 과제에 그대로 쓸 수 있나 — 읽어보라"로 구체화하면 이 괴리를 직접 잴 수 있다. |
| 7.6 | **블록 테스트 형식** (05:19): "answer all then look at all" 대신 "question → answer → question → answer"; 시간이 문제면 8→5문항. | 2-pass는 의도된 설계(`BlockTest.tsx` 상단: 첫 답들이 이후 예측을 가르치므로 예측을 동일 정보 하에 먼저 받는다; Pass 2는 본인 예측을 다시 보여줌). 인터리브는 후반 예측을 오염시킨다. 소요: 블록 1 테스트 9.9분, 블록 2 4.5분(§1). | 형식 유지. 참가자의 불편(기억·지루함)은 진짜이므로 5문항 축소는 시간 레버로 고려. |
| 7.7 | **Phase 2 작업량 비대칭** (05:46): "phase two는 make intents + make rules라 step one(rules만)보다 훨씬 커졌다. rules보다 intents에 시간을 더 썼다." 제안 둘: **intents가 미리 생성돼 있거나**, **phase two는 intents만 하고 rules는 안 하거나.** | 34.5분 중 정의 22.4분(7059 하나 13.7분), rule 10분, 배포 시 rule 없는 set 7개(§3.1·§3.3). 설문 "원하는 대로 되게 할 수 있었다" 5→3, 좌절 3→4(§5). | 조건 간 과제 크기 confound를 참가자가 직접 명명. 선택지: (a) 마스터 큐레이션 intent pre-seed(v7이 버린 starter intents의 부활 — RQ1 '조직' 측정이 일부 주어진 것이 됨), (b) 시간 배분 차등, (c) fold 루프 개선으로 정의 시간 자체를 줄이기. 본 스터디 전 결정 사안. |
| 7.8 | **기타**: 연구자 메모(00:19) — 두 시스템 **직접 비교 설문** 필요, 인터뷰 가이드 아직 없음. 연구자 자평(07:03) — "concept is good, but the system seems too complex for users not familiar with computers." JELSON — Dr. Chen의 코딩 플랫폼 연구와 유사, 학회 조언 권유(07:28). | — | 비교 설문·인터뷰 가이드 둘 다 to-do. |

**인터뷰가 보태는 액션 후보**: ① 인터뷰 가이드 문항 — type 경계 적합성(7.2), fold 후 자동 변경 vs 검토 목록 선호(7.3), 정의 이식성 실측(7.5), 조건별 작업량 체감(7.7); ② 직접 비교 설문(어느 쪽을 쓰겠나 + 이유, 통제·간섭·커버리지 항목별); ③ Apply 전 교차 질문 미리보기(7.4 — 로그와 인터뷰가 같은 것을 가리킴); ④ Phase 2 작업량: pre-seed / 시간 / 루프 개선 중 결정.

## 부록 A. 7059의 핀 목록 (최종 상태)

| message | 질문 | 핀 | 이유 (◦=제안 그대로, ●=자작) | 재핀 |
|---|---|---|---|---|
| 130027 | Provide a list of tasks/jobs where automation… are abundant | in | ◦ A list of such tasks can support assignment examples. | |
| 129889 | As automation is continued to be used… (pros/cons 요청) | in | ● pros and cons are all asking for evidence for their work/research step | |
| 129977 | Any ideas for syllogisms I can use… | in | ◦ Asks for example arguments… | |
| 130101 | unemployment rate before automation | in | ◦ Asks for evidence about jobs affected by automation. | |
| 130107 | Unemployment rate in the 1950s | in | ● Examples and all supporting evidence claims that are for research purposes should be in | ×2 |
| 130051 | what does the future of automation look like | in | ◦ Future-oriented labor impacts are valid research material… | ×3 |
| 129835 | What would be a good second example | in | ◦ | |
| 130055 | how can automation help revolutionize industries… | in | ◦ | |
| 129900 | would it cause people to lose their jobs? | in | ◦ | |
| 129893 | Automation is generally seen as… what do you think about this issue | out | ◦ Requests an opinion, not evidence or examples. | |
| 129891 | Here are some perspectives… I want you to build upon them | out | ◦ Pastes assignment prompt content without asking for argument material. | |
| 129941 | Automation is generally seen as a sign of progress, but what is lost… (프롬프트 붙여넣기) | out | ◦ Pasted prompt text is context, not a student request for material. | ×3 |

## 부록 B. Baseline RULES 문서 성장 (자수)

v1 260 → v2 449 → v4 660 → v5 853 → v7 1,016 → v8 892 → v10 883 → v11 1,134 → v12 1,108 → v14 1,112 → v15 1,328 → v17 1,487 → v19 **1,774**. 두 번(v8, v12) 줄었다 — rewrite가 조항을 합치며 압축한 경우.

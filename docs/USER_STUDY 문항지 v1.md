# USER_STUDY 문항지 (v1)

> 작성 2026-08-11 (같은 날 국문 병기 추가). 참가자에게 실제로 제시되는 **모든 문항과 진행자 발화의 원문**. `USER_STUDY 설계 v2.md`의 [준비] 중 "미니 설문 원문 · 인터뷰 가이드 · 관찰 메모 양식"에 스크리너와 세션 핵심 발화를 더해 한 문서로 묶는다. 튜토리얼 고정 대본 2벌은 별도 문서로 만든다(이 문서 범위 밖).
>
> **언어 전제.** 참가자 대면 텍스트는 전부 **영어**다 — Prolific 모집, 영어 UI(Intent / Rule / Rules / Deploy), 영어 데이터셋. 세션도 영어로 진행한다. 각 문항 아래의 **국문:** 줄은 검토·IRB용 **참고 번역**이며 참가자에게 제시되지 않는다.
> 미확정은 **[파일럿]** 표시. 문항→측정 대응은 각 절의 주석에 명시.

---

## 0. 문구 원칙

- **중립 어휘.** 진행자의 공통 발화에서 "rules", "prompt"를 쓰지 않는다 — "setup" / "configuration"으로 말한다. 예외는 블록 테스트의 포인팅 질문뿐이다: 각 조건의 화면 요소(intent / Rules document)를 지칭하는 것은 편향이 아니라 지칭이다.
- **평가는 문항에 묶는다.** "이 도구가 좋은가"를 묻지 않는다 — "이 응답이 당신이 원한 답인가"를 묻는다.
- **척도.** 문항 판정 5점(1–5, 양끝 앵커) · 설문 7점 동의(1–7). [파일럿: 5점 통일 여부]
- 구두 응답(서술·포인팅·프로브)은 녹화에서 전사한다.
- 어느 쪽이 연구팀 시스템인지 묻는 참가자에게: *"We're comparing the two designs — I can tell you more after the session."*
  - 국문: "두 설계를 비교하는 중이라서요 — 세션이 끝난 뒤에 더 말씀드릴 수 있습니다."

---

## 1. 스크리너 (Prolific, ~2–3분)

재접촉 allowlist라 이미 한 번 확인된 모집단이지만, 전제 조건은 재확인한다. **게이트 = S1 · S2 · S6.**

- **S1.** "Have you taught or assisted a college-level course in which students completed writing assignments (essays, reports, discussion posts, etc.)?" — Yes, as the instructor / Yes, as a TA / No **[No → 종료]**
  - 국문: "학생들이 글쓰기 과제(에세이, 보고서, 토론글 등)를 수행하는 대학 수준의 수업을 가르치거나 보조한 경험이 있으십니까?" — 예, 담당 교수자로 / 예, 조교로 / 아니요
- **S2.** "In that course, were you responsible for guiding students' writing — giving feedback, setting expectations, or answering their questions?" — Yes / Partially / No **[No → 종료]**
  - 국문: "그 수업에서 학생들의 글쓰기를 지도하는 역할 — 피드백 제공, 기대 수준 설정, 질문 응대 — 을 맡으셨습니까?" — 예 / 부분적으로 / 아니요
- **S3.** "When did you most recently teach or assist such a course?" — I currently do / Within the past 2 years / Longer ago (기록용)
  - 국문: "그런 수업을 가장 최근에 가르치거나 보조하신 것은 언제입니까?" — 현재 진행 중 / 최근 2년 이내 / 그보다 이전
- **S4.** "Have you used AI chatbots (e.g., ChatGPT, Claude) yourself?" — Never / Occasionally / Regularly (기록용)
  - 국문: "본인이 직접 AI 챗봇(예: ChatGPT, Claude)을 사용해 보셨습니까?" — 전혀 없음 / 가끔 / 자주
- **S5.** "Have students in your course used an AI chatbot for writing help — either one provided by the course or a general one?" — Yes, course-provided / Yes, a general one / No / Not sure (기록용)
  - 국문: "수업의 학생들이 글쓰기 도움을 받기 위해 AI 챗봇을 사용한 적이 있습니까 — 수업에서 제공한 것이든 일반 챗봇이든?" — 예, 수업 제공 챗봇 / 예, 일반 챗봇 / 아니요 / 잘 모름
- **S6.** "This study is a ~90-minute Zoom session. Can you join from a desktop or laptop with Chrome, and share your screen during the session?" — Yes / No **[No → 종료]**
  - 국문: "이 연구는 약 90분의 Zoom 세션입니다. 데스크톱 또는 노트북에서 Chrome으로 접속하고, 세션 중 화면을 공유하실 수 있습니까?" — 예 / 아니요
- **S7.** 가용 시간 슬롯 선택 + 녹화 고지: "Sessions are recorded (screen and audio) for research purposes, with your consent."
  - 국문: "세션은 동의하에 연구 목적으로 녹화(화면·음성)됩니다."

주석: S1·S2가 "기준은 교수자에게서 나온다" 전제의 게이트. S4·S5는 배경 변인(게이트 아님). 셀 배정(조건 순서 × 데이터셋)은 스크리너 후 연구팀이 한다.

---

## 2. 세션 핵심 발화 (진행자 스크립트)

- **인트로 (0:00).** *"Today you'll look at real conversations that students had with a course chatbot, and you'll use two versions of a configuration tool to set the chatbot up to behave the way you want. There are no right or wrong answers — what matters is your own judgment as an instructor."*
  - 국문: "오늘은 학생들이 수업용 챗봇과 실제로 나눈 대화를 보시면서, 설정 도구의 두 가지 버전을 사용해 챗봇이 원하시는 대로 동작하도록 설정해 보시게 됩니다. 정답이나 오답은 없습니다 — 중요한 것은 교수자로서의 선생님 자신의 판단입니다."
- **작업 지시문 (각 블록).** *"Please look through the conversations students in this course had with the chatbot. Whenever a chatbot response is not what you would want, adjust the setup so that it responds the way you want. When you feel it's ready, deploy it."*
  - 국문 (설계 v2 §5와 동일): "이 수업에서 학생들이 챗봇과 나눈 대화를 훑어 주세요. 챗봇의 응답이 당신이 원하는 모습이 아니라면, 원하는 대로 바뀌도록 설정을 고치시면 됩니다. 다 되었다고 생각하시면 배포해 주세요."
- **작업 중 개입.** 기능 위치 안내 한 줄만: *"That's under {X}."* 전략 질문 우회: *"That's entirely up to you — whatever fits how you'd run your course."*
  - 국문: "{X} 아래에 있습니다." / "그건 전적으로 선생님께 달려 있습니다 — 수업을 운영하시는 방식에 맞게 하시면 됩니다."
- **시간 경고 (작업 20분 시점).** *"About five minutes left. No need to cover everything — deploy whenever you feel it's in a good state."* [파일럿: 경고 시점]
  - 국문: "약 5분 남았습니다. 전부 다루실 필요는 없습니다 — 충분히 되었다 싶으시면 언제든 배포해 주세요."
- **테스트 전환.** *"Now let's check the chatbot you just set up, with a few new student questions it hasn't seen."*
  - 국문: "이제 방금 설정하신 챗봇을, 챗봇이 본 적 없는 새로운 학생 질문 몇 개로 확인해 보겠습니다."
- **블록 2 전환.** *"Now we'll do the same thing with the other version of the tool, and a different course."*
  - 국문: "이제 도구의 다른 버전으로, 다른 수업의 대화를 가지고 같은 과정을 진행하겠습니다."
- **종료.** 보상 안내 + *"Both versions were built by our team to compare two ways of configuring a chatbot — thank you for helping us compare them."*
  - 국문: "두 버전 모두 챗봇 설정의 두 가지 방식을 비교하기 위해 저희 연구팀이 만든 것입니다 — 비교에 도움을 주셔서 감사합니다."

---

## 3. 블록 테스트 문항 (블록당 8문항 × 4단계, ~7분)

문항 화면 = 직전 대화 턴들 + 학생 질문. 참가자의 설정 화면(intent 트리 / Rules 문서)은 내내 열려 있다. 문항당 ~50초.

**① 예측**
- 서술 (구두): *"How do you expect your chatbot to respond to this question — in a sentence or two?"*
  - 국문: "선생님의 챗봇이 이 질문에 어떻게 답할 것 같으세요? 한두 문장으로 말씀해 주세요."
- 짐작 (UI, 예/아니오): **"Will your chatbot answer this the way you intend?"** — Yes / No
  - 국문: "내 챗봇이 이 질문에 내가 의도한 대로 답할까?" — 예 / 아니오
- 포인팅 (구두 또는 클릭):
  - SCORE: *"Which intent do you expect this question to fall under — if any?"* ("None of them" / "Not sure" 유효 응답)
    - 국문: "이 질문이 어느 intent에 걸릴 것 같으세요 — 걸리는 게 있다면요?" ("어디에도 안 걸림" / "잘 모르겠음" 유효 응답)
  - Baseline: *"Which part of your Rules document do you expect to shape the response — if any?"* ("Nothing specific" / "Not sure" 유효 응답)
    - 국문: "Rules 문서의 어느 부분이 이 응답에 작용할 것 같으세요 — 있다면요?" ("특별히 없음" / "잘 모르겠음" 유효 응답)

**② 공개** — *"Let's see what it actually says."* (배포 직후 백그라운드 일괄 생성 — 대기 없음)
  - 국문: "실제로 뭐라고 답하는지 볼까요."

**③ 판정** (UI, 5점): **"How well does this response match what you intended?"** — 1 = *Not at all what I intended* … 5 = *Exactly what I intended*. **3점 이하이면**: *"What's off about it?"* (한 마디, 구두)
  - 국문: "이 응답은 의도하신 것에 얼마나 부합하나요?" — 1 = "전혀 의도한 것이 아니다" … 5 = "정확히 의도한 것이다". 3점 이하이면: "어떤 점이 어긋났나요?"

**④ 프로브** (예측이 빗나간 문항만 — 짐작≠접힌 판정, 또는 포인팅≠실제 라우팅): *"That's different from what you expected — why do you think that happened?"* 시간이 밀리면 블록당 1~2문항으로 제한. [파일럿]
  - 국문: "예상하신 것과 다르네요 — 왜 그랬을 것 같으세요?"

주석: 서술·포인팅·짐작 정확도 = RQ2 (SCORE 포인팅은 응답 메타데이터의 `appliedIntentId`와 대조 = 객관 채점). ③ 5점 = RQ3, "What's off" 발화 = misalignment 유형 코딩 재료. ④ = RQ2·RQ1. 접기 규칙: 5점 3 이하 = '아니오'. 단계 순서(서술→짐작→포인팅)는 설계 v2 §5를 따른다.

---

## 4. 미니 설문 (블록당 5문항, 7점 동의, ~2분)

지시문: *"Thinking about the version you just used, please rate your agreement with each statement."* — 1 = *Strongly disagree* … 7 = *Strongly agree*
국문: "방금 사용하신 버전을 떠올리면서, 각 진술에 동의하는 정도를 표시해 주세요." — 1 = "전혀 동의하지 않음" … 7 = "매우 동의함"

| # | 문항 (영어 원문) | 국문 | 구인 |
|---|---|---|---|
| C1 | "I felt in control of how the chatbot will behave." | "챗봇이 앞으로 어떻게 행동할지를 내가 통제하고 있다고 느꼈다." | 통제감 |
| C2 | "I could get the chatbot to behave the way I wanted." | "나는 챗봇이 내가 원하는 대로 행동하게 만들 수 있었다." | 통제감 |
| B1 | "Setting up the chatbot was mentally demanding." | "챗봇 설정은 정신적으로 많은 노력을 요구했다." | 부담 (TLX 정신적 요구 번안) |
| B2 | "I felt frustrated while setting it up." | "설정하는 동안 좌절감을 느꼈다." | 부담 (TLX 좌절 번안) |
| T1 | "I trust this chatbot to handle future student questions in line with my intent." | "이 챗봇이 앞으로의 학생 질문을 내 의도에 맞게 처리할 것이라고 신뢰한다." | 신뢰 |

주석: C1·C2 = RQ2 통제감(주·주관). B1·B2 = 결정 로그 §9-6의 TLX 축약. T1 = 구 계획(PromptHive 계열)의 1문항 축약. C1·T1이 **미래 행동**("will behave", "future questions")을 묻는 것이 요점 — 지금 화면이 아니라 배포된 뒤에 대한 통제·신뢰다. [파일럿: 척도 통일(7점 vs 5점), 문구 이해도]

---

## 5. 인터뷰 가이드 (~8분, 반구조화)

think-aloud 부재를 메우는 유일한 "왜" 채널이므로 시간을 지킨다. 괄호는 배분 목표.

1. **차이 (2분).** *"You used two versions today. How did they feel different — in how you got the chatbot to do what you want?"*
   - 국문: "오늘 두 가지 버전을 사용하셨는데요. 챗봇이 원하는 대로 하게 만드는 과정에서, 두 버전이 어떻게 다르게 느껴지셨나요?"
   - 후속: *"For each version: was there a moment it clicked, and a moment it got in your way?"* (대칭 프로빙 — demand 완화)
     - 국문: "각 버전에서 '아, 이거구나' 싶었던 순간과, 오히려 방해가 된다고 느낀 순간이 있었나요?"
2. **회고 프로브 (2–3분, 관찰 메모 슬롯 2~3개).** 템플릿: *"Earlier, in the {first/second} block, I noticed you {paused before editing X / rewrote Y / jumped between types / …}. What was going through your mind there?"* — RQ1의 실시간 "왜"를 회고로 회수하는 장치.
   - 국문: "아까 {첫/두} 번째 블록에서 {X를 고치기 전에 잠시 멈추셨는데요 / Y를 다시 쓰셨는데요 / 유형 사이를 오가셨는데요}. 그때 어떤 생각을 하고 계셨나요?"
3. **재현 (1분).** *"In the second block, were you trying to rebuild what you'd made in the first one? How did that go?"* (이월 확인 + RQ1)
   - 국문: "두 번째 블록에서, 첫 번째 블록에 만드신 것을 다시 만들려고 하셨나요? 해 보니 어떠셨나요?"
4. **채택 (1분).** *"If you were to use one of these for your own course next term, which would you pick — and why?"*
   - 국문: "다음 학기에 선생님 수업에 이 중 하나를 쓰신다면, 어느 쪽을 고르시겠어요? 이유는 무엇인가요?"
   - 후속: *"What would stop you from actually using it?"*
     - 국문: "실제로 쓰시게 된다면, 무엇이 걸림돌이 될까요?"
5. **이식성 (1분).** *"Imagine taking today's setup to a different course, with a different writing assignment. Would it carry over? What would you need to change?"* (이식성 지각 — 설계 v2 §2)
   - 국문: "오늘 만드신 설정을, 글쓰기 과제가 다른 별개의 수업에 그대로 가져간다고 상상해 보세요. 그대로 통할까요? 무엇을 바꾸셔야 할까요?"
6. **마무리.** *"Anything about either version you wanted to say but weren't asked?"*
   - 국문: "두 버전에 대해, 여쭤보지 않았지만 말씀하고 싶으셨던 것이 있나요?"

---

## 6. 진행자 관찰 메모 양식 (작업 중)

| 시각 | 블록/조건 | 관찰 (행동만, 해석 없이) | 프로브 후보 ✓ |
|---|---|---|---|
| mm:ss | 1/SCORE 등 | 예: "Reviewing 유형에서 4분 체류, 같은 질문 세 번 열람" | |

**볼 것(가이드).** 특정 유형·질문에 오래 머묾 · 수정 전 망설임/되돌림 · rule/definition 재작성 · 검색/filter 사용 · 유형 간 점프 · 프리뷰 반복 실행 · 자발적 발화. **규칙:** 세션당 프로브 후보 2~3개에 ✓ — 인터뷰 §5-2에서 그대로 짚는다. 해석·판단은 적지 않는다.

---

## 7. 진행 체크리스트 (요약)

- **세션 전.** 셀 배정 확인(조건 순서 × 데이터셋) → 참가자용 클론 2개 준비 → 테스트 8문항 세트 확인 → Zoom 녹화 설정.
- **시작.** 동의 확인(녹화 포함) → 참가자 화면 공유 + 브라우저 접속 링크 전달.
- **블록마다.** 라이브 튜토리얼(고정 대본) → 작업(20분 시점 경고) → 배포 확인 → 테스트 8문항 → 미니 설문.
- **종료.** 인터뷰 → 종료 발화 + 보상 안내 → 녹화 저장 확인 → 관찰 메모에 세션 ID 기입.

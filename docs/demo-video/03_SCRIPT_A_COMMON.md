# ⓐ Getting around — 샷리스트 + 내레이션 (공통 세그먼트)

> 길이 목표 **60–75 s**. 블록 1에서 자기 버전 세그먼트 앞에 재생. **두 번 찍는다**(Slate 보드 테이크 + Clay 보드 테이크), **보이스오버는 하나**(`06_NARRATION.md` ⓐ). 두 테이크의 클릭 순서·타이밍을 같게 맞춰 같은 VO가 둘 다에 맞도록 한다.
>
> 시작 상태: `Run demo · SCORE`(또는 `· Baseline`)로 막 들어온 보드 — 브리핑 모달이 열려 있고, 경과 시간은 0–1분. 참고 스크린샷: `shots/a01_briefing.png`, `a02_slate_question_open.png`, `a02_clay_question_open.png`, `a03_search.png`.

내레이션 약어: **VO** = 보이스오버 원문(영어, 그대로 읽는다). 시간은 편집 후 기준의 목표치.

---

## A0 · 타이틀 카드 (0:00 – 0:02)

- **화면**: 검은 배경에 흰 글자 **"Getting around"**(세션 화면의 세그먼트 라벨과 같은 글자). 음성 없음.
- **메모**: 세 편 모두 같은 스타일·같은 길이.

## A1 · 브리핑 모달 (0:02 – 0:17)

- **화면/액션**
  1. 보드 위에 모달 *"What you're working from · Intelligent Machines"*. 세 절이 보인다: **YOUR TASK IN THIS ROUND**(과제 문장, 강조 표시된 세 동작) → **THE ASSIGNMENT STUDENTS WERE GIVEN** → (모달 안을 천천히 스크롤) **THE CHATBOT'S STARTING PROMPT**(NIRVANA는 *"No system prompt — the chatbot ran without any default guidance."*).
  2. 오른쪽 아래 **Start** 클릭 → 모달 닫힘.
  3. 커서를 헤더의 **ⓘ Your task** 버튼 위에 1초 올려 둔다(클릭하지 않는다).
- **VO**: *"This is the Chatbot Studio. It opens on a short briefing: your task for this round, the assignment the students were given, and the prompt the chatbot started from. You can reopen it any time from Your task, in the header."*
- **메모**: 스크롤은 VO의 세 항목과 박자를 맞춘다(과제 → 과제문 → 시작 프롬프트). 모달 문구는 두 버전이 동일.

## A2 · 가운데 열 — 질문 목록·검색·정렬 (0:17 – 0:31)

- **화면/액션**
  1. 커서를 가운데 열 머리 **PLANNING QUESTIONS · 38**로 → 한 행(**P19 · Turn 2 · how do you spell exaggeration**) 위에 잠깐 머문다(행 = 학생 ID · 몇 번째 질문 · 날짜 · 질문 텍스트).
  2. 검색창 **Search query text…**에 `spell` 타이핑 → 목록이 1개로 줄어든다(`shots/a03_search.png`) → ✕로 지운다 → 38개로 돌아온다.
  3. 정렬 메뉴 **PID ↑**를 열어 항목(PID ↑ / PID ↓ / Newest / Oldest)을 보여 주고 **PID ↑**로 둔다.
- **VO**: *"The middle column lists the questions students asked the chatbot — one row per question, with the student's ID and which turn it was. The search box finds questions by their text, and the menu beside it changes the order."*
- **메모**: Slate 보드의 행에는 `Planning · No rule` 칩이, Clay 보드의 행에는 칩이 없다 — VO는 칩을 말하지 않는다. 타이핑은 또박또박(실시간), 컷 없음.

## A3 · 오른쪽 열 — 대화 뷰어 (0:31 – 0:47)

- **화면/액션**
  1. **P19 · Turn 2** 행 클릭 → 오른쪽에 대화 전체가 열리고 그 질문이 테두리로 강조된다(뷰어 머리: `P19 · Turn 2 · 1/1/2026, 2:03:09 PM`).
  2. 커서로 아래쪽의 붙여 넣은 텍스트 표시를 가리킨다 — **[OWN DRAFT · 26 words · 12%]** 노란 강조, **hide pasted text**.
  3. 강조된 질문 옆의 **⌃ 2/5 ⌄** 중 **⌄**(Next question)를 한 번 눌러 다음 질문으로 내려갔다가 **⌃**로 돌아온다.
- **VO**: *"Click a question and the whole conversation opens on the right, with that question highlighted. Text the student pasted in — their own draft, or the assignment prompt — is marked, and these arrows step through the student's other questions."*
- **메모**: 뷰어 머리의 오른쪽 버튼(Slate: `+ New intent` · `Revise rule ›` / Clay: `+ New filter` · `Revise rules ›`)은 **가리키지도 말하지도 않는다** — 버전 세그먼트의 몫. 스크롤은 천천히.

## A4 · 왼쪽 열 — 네 유형 (0:47 – 0:59)

- **화면/액션**
  1. 왼쪽 열의 유형 머리 네 개를 커서로 위에서 아래로 훑는다: **PLANNING 38 · TRANSLATING 10 · REVIEWING 28 · DRAFTING 27**.
  2. **TRANSLATING** 클릭 → 가운데가 *TRANSLATING QUESTIONS · 10*으로 바뀐다 → **PLANNING** 클릭해 돌아온다.
  3. 가운데 열 맨 위 **WHEN** 줄(유형 설명, *"The student is deciding WHAT to write…"*)을 가리키고 **Show more**를 한 번 연다(읽을 만큼만 1–2초) → 다시 접는다.
- **VO**: *"On the left, the questions are grouped into four types — Planning, Translating, Reviewing, and Drafting. Click a type to list its questions; the line at the top says what the type covers."*
- **메모**: 왼쪽 열의 나머지(Slate: `No intent yet · No default rule · + New intent in …` / Clay: `RULES` 패널 · `+ New filter in …`)는 커서가 지나가기만 한다. **유형 머리의 글자만** 가리킨다.

## A5 · 헤더 — 경과 시간과 Deploy (0:59 – 1:10)

- **화면/액션**
  1. 헤더 오른쪽 **n / 25 min** 칩 위에 커서 → 툴팁 *"This part of the session is about 25 minutes. Your facilitator keeps the time — nothing stops on its own."*이 뜨면 1초.
  2. **🚀 Deploy** 위로 커서(클릭하지 않는다) → **Not deployed** 표시를 함께 보여 준다.
  3. 마지막 프레임 2초 홀드.
- **VO**: *"And at the top: how many minutes you've been working this round, and Deploy, which sends your setup to the student chat. The next video shows how a setup is made."*
- **메모**: `Participant DEMO`는 말하지 않는다. Deploy는 **누르지 않는다**.

---

## 두 테이크를 맞추는 법

- 같은 순서, 같은 멈춤. 특히 A2의 타이핑 속도와 A3의 스크롤 양을 맞춘다(VO가 하나다).
- 테이크마다 `Run demo`로 새로 들어가면 경과 시간 칩이 0–1분에서 시작한다 — 두 테이크가 같은 숫자(1 / 25 min)에서 찍히도록 Start 직후 바로 진행.
- 파일명: `getting-around-slate.mp4` / `getting-around-clay.mp4` → `NEXT_PUBLIC_STUDY_DEMO_COMMON_SCORE` / `…_COMMON_BASELINE`.

## 단어 수

VO 합계 ≈ 190 단어 → 분당 160단어 전후의 차분한 속도로 **70 s ± 5**.

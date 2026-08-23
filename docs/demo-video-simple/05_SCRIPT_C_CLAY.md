# ⓒ Clay (simple_baseline) — 샷리스트 + 내레이션

> 목표 **165 s ± 7**, ⓑ와 15 s 이내(목표 7 s). **음성·화면 어디에도 "intent" 금지**(보드가 렌더하지 않음을 확인). 시작 상태: `Run demo · Simple Baseline` → **Start** 직후. 왼쪽 **RULES · 0 / 8000** 빈 에디터(*What the chatbot should do, in your own words.*) · Apply · Save · *Saved versions will appear here.* 한 테이크로 끝까지.
>
> 타이핑 원문·분기표는 `02_SCENARIO.md` §4–5. 참고: `shots/c01_*` ~ `c07_*`. 응답 스트리밍은 자르지 않는다.

---

## C0 · 타이틀 카드 (0:00–0:02)

검은 배경, **"Clay"**. 음성 없음.

## C1 · 왼쪽 열이 무엇인가 (0:02–0:15)

- **화면**: 커서로 **RULES** 에디터(빈 상자·placeholder·`0 / 8000`)와 아래 **Apply · Save**, 그 아래 *Saved versions will appear here.* 를 차례로 짚는다.
- **VO**: *"In Clay, the left column is where the setup lives: one Rules document, in your own words, that says how the chatbot responds to every question. Below it, the versions you save will build up."*

## C2 · 질문을 읽는다 (0:15–0:30)

- **화면**: **P19 · 2 · how do you spell exaggeration** 클릭 → 원래 응답(한 줄). **P56 · 4** 클릭 → 원래 응답(한 문단). P19 · 2로 복귀.
- **VO**: *"Say you've noticed students asking quick word questions — a spelling, a synonym — and the chatbot answering them unevenly: one word here, a whole paragraph there. You want these answered one way."*
- **메모**: ⓑ B2와 같은 행·같은 VO — 관찰까지는 조건이 같다.

## C3 · Pin으로 고정 → 첫 문단 쓰기 (0:30–1:00)

- **화면**:
  1. P19 · 2 행 호버 → 📌(**Keep this one in view**) → **Kept in view** 선반에 올라간다. P1 · 5(*convinience is that correct*)도 핀 → 선반 · 2.
  2. **RULES에 타이핑**(문단 1): `When a student asks for a word — a spelling, a synonym, or how to use a term — answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.`
- **VO**: *"Pin the questions you're fixing, so they stay in reach while you write. Then you write the rules yourself, in the document — here, how word questions should be answered. Nothing has taken effect yet: the document is just text until you apply it."*
- **메모**: 타이핑은 실시간(ⓑ B3의 타이핑과 같은 속도). 핀 선반은 ⓐ에서 배운 것의 사용 — 다시 설명하지 않는다.

## C4 · 사이클 1 — Apply → 확인 (1:00–1:30)

- **화면**:
  1. **Apply** 클릭 → 뷰어 어시스턴트 줄이 **Working out this reply under [Now (unsaved) · {LLM 이름}]** — 접힌 회색 상자에 지금 문서 전문 — 새 응답이 스트리밍되어 **한두 줄 형식**으로 온다.
  2. **선반의 P1 · 5** 클릭 → 같은 문서 아래 그 질문의 응답도 짧게 바뀌는 것을 확인.
- **VO**: *"Apply, and the reply is worked out again under what you just wrote — you can read the exact text it ran under, right above the answer. The pinned questions are one click away, so checking the second one is immediate. This is the loop: write, apply, look."*

## C5 · 사이클 2 — 다른 질문, 문서 덧붙이기 (1:30–2:05)

- **화면**:
  1. 검색 또는 스크롤로 **P11 · 1 · Write two paragraphs about…** 클릭 → **Original (as delivered)**: 챗봇이 두 문단을 그냥 써 줬다. 1–2초 읽는다.
  2. **RULES 끝에 빈 줄 하나 띄우고 타이핑**(문단 2): `When a student asks you to write a full essay or a whole paragraph for them, do not write it. Ask what they want to say, and offer at most an outline of two or three bullet points.`
  3. **Apply** → 이 질문의 응답이 새 문서 아래 다시 나온다(개요 제안으로). **선반의 P19 · 2** 클릭 → 단어 질문 응답도 여전히 형식대로인지 본다.
- **VO**: *"A different kind of question — here the chatbot simply wrote the paragraphs. The same document answers this question too, so you add to it: a second paragraph, applied the same way. One document, so every change applies to every question — which is why the pinned ones are worth a look after each apply."*
- **메모**: "every change applies to every question"은 사실 진술(설계 §4 — 보정 금지, 숨김 금지). 경고 톤 금지.

## C6 · Save → 버전, 버전별 열람 (2:05–2:35)

- **화면**:
  1. **Save** 클릭 → 왼쪽 아래 버전 행(이름은 몇 초 뒤 · 시각). Apply·Save가 흐려진다(할 것 없음), **↺**(Undo)가 남는다 — 커서 1초.
  2. 뷰어의 **This reply is under [ ]** 드롭다운을 연다 — **Original (as delivered)** · 이름 붙은 순간들 — Original을 골라 학생이 실제 받은 답과 잠깐 비교하고, 최신으로 되돌린다.
- **VO**: *"Save keeps this point — versions are named for you and listed on the left. On any reply you can switch what it's read under: any moment you've written, or Original, as delivered — the one answer no setup can reproduce, and the fixed point to compare against."*

## C7 · Deploy (2:35–2:50)

- **화면**: 헤더 **Deploy** 클릭 → **Deployed vN** · **I'm done** 등장(**누르지 않는다**). 마지막 프레임 2초 홀드.
- **VO**: *"When you're ready, Deploy saves what's in effect and stamps it as the setup you stand behind — and an I'm done button appears for the end of the round."*

---

## 단어 수·길이

VO ≈ 425 단어 → **165 s ± 7**. 비트별: C1 42 · C2 40 · C3 62 · C4 62 · C5 78 · C6 68 · C7 36 + 타이핑 무음 구간(ⓑ와 같은 총량 — ⓑ는 When·Then 4개, ⓒ는 문단 2개, 글자 수가 거의 같다: §4의 원문이 서로의 재배열이므로).

# ⓒ Clay (simple_baseline) — 샷리스트 + 내레이션

> 목표 **180 s ± 10**, ⓑ와 **20 s 이내**. **음성·화면 어디에도 "intent" 금지** — 08-23에 HEAD 소스로 재확인했다(버전 히스토리·Undo 툴팁·Types 팝오버·카운트 툴팁 어디에도 그 단어가 렌더되지 않는다). 시작 상태: `Run demo · Simple Baseline` → **Start** 직후. 왼쪽 열은 헤더 **Setup**(오른쪽에 **Undo** · **Redo**) 아래 **RULES · 0 / 8000** 빈 에디터(*What the chatbot should do, in your own words.*) · Apply · Save · **VERSION HISTORY 1**(`v0` **Original (as delivered)** 한 행). 한 테이크로 끝까지.
>
> ⚠ **08-23 개정.** 별도 버전 패널이 삭제되고 ⓑ와 **같은 Version history**를 RULES 카드 안에서 쓴다 · 가운데 열에 **Types** 피커가 새로 생겨 C5가 이걸로 다시 짜였다 · **`I'm done`이 없어졌고 Deploy는 팝오버로 한 번 묻는다** · Undo/Redo가 Setup 헤더로 올라갔다.
>
> 타이핑 원문·분기표는 `02_SCENARIO.md` §4–5. 참고 화면 `shots/c01_*` ~ `c07_*`(08-23 재촬영). 응답 스트리밍은 자르지 않는다.

---

## C0 · 타이틀 카드 (0:00–0:02)

검은 배경, **"Clay"**. 음성 없음.

## C1 · 왼쪽 열이 무엇인가 (0:02–0:15)

- **화면**: 왼쪽 열 맨 위 헤더 **Setup**과 그 오른쪽 **Undo** · **Redo**에 1초 → 커서로 **RULES** 에디터(빈 상자·placeholder·`0 / 8000`) → 아래 **Apply · Save** → 그 아래 **VERSION HISTORY 1** 을 차례로 짚는다. 히스토리는 **비어 있지 않다** — `v0` **Original (as delivered)** 한 행이 처음부터 있고, 효력 중인 것이 그것뿐이라 오른쪽 칸에 **showing**이 붙어 있다(참가자가 저장한 것이 아니라 바닥이다. 커서로 강조하지 않는다).
- **VO**: *"In Clay, the left column is where the setup lives: one Rules document, in your own words, that says how the chatbot responds to every question. Under it is its history, which starts from the chatbot as it was delivered — every version you save is kept there."*

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
  1. **Apply** 클릭 → 뷰어 어시스턴트 줄이 **Working out this reply under [Now (unsaved)]**(미저장 옵션에는 이름이 붙지 않는다) — 그 아래 접힌 상자(카드색 테두리, 응답 폭 전체, 두 줄)에 지금 문서 — 새 응답이 스트리밍되어 **한두 줄 형식**으로 온다. 상자를 한 번 클릭해 전문을 폈다 접는다(*Show the whole rule* / *Show less*).
  1b. 같은 프레임에서 왼쪽 **VERSION HISTORY** 맨 위에 `v1 · unsaved` 행이 선다(이름은 몇 초 뒤). 저장 전에도 번호가 보인다 — **Save 비트에서 "행이 새로 생긴다"고 말하지 않는다.**
  2. **선반의 P1 · 5** 클릭 → 같은 문서 아래 그 질문의 응답도 짧게 바뀌는 것을 확인.
- **VO**: *"Apply, and the reply is worked out again under what you just wrote — you can read the exact text it ran under, right above the answer. The pinned questions are one click away, so checking the second one is immediate. This is the loop: write, apply, look."*

## C5 · 사이클 2 — 분류로 좁혀 읽고, 문서에 덧붙이기 (1:30–2:15)

- **화면**:
  1. 가운데 열 헤더의 **Types** ▾ 클릭 → 준비된 분류 목록(Planning · Translating · Reviewing · **Drafting**과 그 하위). **Drafting**(또는 하위 *Write Full Essay (from prompt)*)을 고른다 → 목록이 그 분류로 좁아지고, **리스트 제목이 그 분류 이름으로**, 카운트가 `n of 103`으로 바뀌며 **제목 아래에 그 분류의 정의문**이 찍힌다.
  2. 좁아진 목록에서 **P11 · 1 · Write two paragraphs about…** 클릭 → 응답이 **지금 문서 아래에서 다시** 나온다 — **여전히 두 문단을 그냥 써 준다**(문서가 이 종류에 대해 아무 말도 하지 않았으므로). 1–2초 읽는다.
  3. **RULES 끝에 빈 줄 하나 띄우고 타이핑**(문단 2): `When a student asks you to write a full essay or a whole paragraph for them, do not write it. Ask what they want to say, and offer at most an outline of two or three bullet points.`
  4. **Apply** → 이 질문의 응답이 새 문서 아래 다시 나온다(개요 제안으로).
  5. **✕**(**Show every question again**)로 분류를 지운다 → 목록이 103행으로 돌아온다. **선반의 P19 · 2** 클릭 → 단어 질문 응답이 **여전히 한두 줄인지** 본다.
- **VO**: *"The middle column can also be read through prepared categories — pick one and the list narrows to it, with what that category covers written under the title. Here, the requests to write something outright. Open one and the same document you just wrote answers this question too: it still writes the paragraphs, because you haven't said anything about these yet. So you add to the document — a second paragraph, applied the same way. Then clear the category, and the question you pinned earlier is still answered the way you asked. You can narrow what you read; what you write applies to every question."*
- **메모**:
  - **분류는 읽는 방법이지 쓰는 방법이 아니다.** 고른다고 RULES 문서에 아무것도 들어가지 않는다. *"이 분류로 규칙을 만든다"* 류의 말은 금지 — 분류가 설정에 들어간다는 뜻이 되고, 그건 다른 보드의 기능이다. 화면 사실만 말한다: **목록에 무엇이 보일지를 바꾼다.**
  - 5번이 이 비트의 핵심이다. 필터를 지우고 핀으로 돌아가는 동작이 **"좁혀 읽었지만 쓴 것은 전 질문에 걸린다"** 를 말이 아니라 화면으로 증명한다. 자르지 않는다.
  - "every question"은 사실 진술이다(설계 §4 — 보정 금지, 숨김 금지). **경고 톤 금지.**
  - 2번에서 응답이 두 문단이 아니게 나오면 그대로 진행한다 — 둘째 문단을 덧붙이는 명분은 학생이 실제로 받은 답(대필)에 있고, 그건 분류 목록이 이미 말해 준다.

## C6 · Save → 버전, 버전별 열람 (2:15–2:45)

- **화면**:
  1. **Save** 클릭 → **RULES 카드 안** Apply·Save 줄 아래 **VERSION HISTORY**의 맨 윗행이 `v1 · {이름} · **unsaved**` 에서 `v1 · {이름} · **current**` 로 바뀐다(그 아래는 `v0` **Original (as delivered)**). 행이 새로 생기는 것이 아니라 **상태 칸이 바뀐다.** Apply·Save가 흐려진다(할 것 없음) — 커서를 왼쪽 열 맨 위 **Setup** 헤더의 **Undo · Redo** 로 옮겨 1초.
  2. 뷰어의 **This reply is under [ ]** 드롭다운을 연다 — 위에서부터 이름 붙은 순간들(`v1 · {이름}`), **맨 아래 v0 · Original (as delivered)**. **v0**을 골라 학생이 실제 받은 답과 잠깐 비교하고, 최신으로 되돌린다.
- **VO**: *"Save keeps this point — versions are named for you and kept under the document. On any reply you can switch what it's read under: any moment you've written, or at the bottom of the list, Original, as delivered — the one answer no setup can reproduce, and the fixed point to compare against."*
- **메모**: **Save는 Apply 전에는 dim**이다(*Apply these edits first — Save keeps what is in effect*). 순서는 언제나 타이핑 → Apply → Save. 그리고 히스토리 **행을 클릭하지 않는다** — 누르면 보드 전체가 그 버전으로 읽기 전용이 되어 Apply·Save가 사라지고, `Latest`로 돌아와야 다음 비트가 이어진다. 버전별 열람은 **뷰어의 드롭다운**으로만 찍는다.

## C7 · Deploy (2:45–3:00)

- **화면**: 헤더 **Deploy** 클릭 → 버튼 아래 팝오버가 열린다: *This deploys the setup you have now and ends it. There are a few quick questions next, then you will check what it answers. You will not be able to come back and change it.* · **Not yet** / **Deploy and finish**. 마지막 프레임 2초 홀드 — **Deploy and finish는 누르지 않는다**(누르면 그 자리에서 블록이 끝나고 `/study/session`으로 넘어간다).
- **VO**: *"When you're ready, Deploy saves what's in effect and stamps it as the setup you stand behind. It asks once before it does, and confirming ends the round."*

---

## 단어 수·길이

VO **360 단어**(08-23 실측) ≈ 135 s. 비트별: C1 48 · C2 33 · C3 44 · C4 48 · C5 105 · C6 54 · C7 28. **화면 길이는 ~180 s** — 차이는 타이핑·확인 무음이다(ⓒ는 문단 2개 ≈380자를 치고, 사이클마다 응답 스트리밍을 두 번 기다린다).

ⓑ(448 단어 · ≈170 s)와의 차이는 ~10 s로 `01_PLAN` §4의 상한 20 s 안이다. **초 단위로 맞추지 않는다** — C5가 길어진 것은 이 보드에 실제로 있는 표면(Types)을 가르치기 때문이고, 그걸 빼서 길이를 맞추면 참가자가 설명 없는 버튼을 25분 내내 보게 된다.

## 이 스크립트에서 찾지 말 것 [08-23]

- **`Saved versions will appear here.`** — 별도 버전 패널이 컴포넌트째 삭제됐다. 히스토리는 RULES 카드 안이고, 첫 프레임부터 `v0` 한 행이 있다.
- **`Original (as delivered)` 단독 라벨 · 목록 맨 위** — 이제 **`v0 · Original (as delivered)`** 이고 드롭다운 **맨 아래**다.
- **↺(Revert)** — 카드에 없다. Undo/Redo는 **Setup** 헤더에 글자로 있다(Clay 툴팁: *Undo (⌘Z) — changes the rules document*).
- **벽시계 시각**(09:14 류) — 히스토리 행의 오른쪽 칸은 `current` / `unsaved` / `showing` / `4m ago`다.

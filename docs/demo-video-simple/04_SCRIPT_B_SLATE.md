# ⓑ Slate (simple_score) — 샷리스트 + 내레이션

> 목표 **165 s ± 7**, ⓒ와 15 s 이내(목표 7 s). 시작 상태: `Run demo · Simple SCORE` → 브리핑 **Start** 직후. 왼쪽 `+ ○ New intent` 행과 **Uncategorized · 103**만 있는 리스트. 한 테이크로 끝까지.
>
> 타이핑 원문·분기표는 `02_SCENARIO.md` §4–5. 참고: `shots/b01_*` ~ `b07_*`. **판정·응답 스트리밍은 자르지 않는다** — 5 s 초과 구간만 ≤2 s.

---

## B0 · 타이틀 카드 (0:00–0:02)

검은 배경, **"Slate"**. 음성 없음.

## B1 · 왼쪽 열이 무엇인가 (0:02–0:17)

- **화면**: 커서를 왼쪽 열로 — `+ ○ New intent` 행, **Uncategorized · 103**. Uncategorized 행을 클릭해 펼친다: rule 에디터 하나(When 없음)가 열리는 것을 1초 보여 주고 다시 접는다.
- **VO**: *"In Slate, the left column is where the setup lives. You create intents: an intent is a group of questions you describe in words, with its own rule for how the chatbot responds to them. The list is read top to bottom, and anything no intent catches lands in Uncategorized at the end — which has a rule of its own."*
- **메모**: "read top to bottom"은 순서 의미론의 예고(비트 6에서 ↑↓로 회수).

## B2 · 질문을 읽는다 (0:17–0:31)

- **화면**: 가운데에서 **P19 · 2 · how do you spell exaggeration** 클릭 → 뷰어에 원래 응답(한 줄). 이어 **P56 · 4 · a word for understanding that something should be slow** 클릭 → 원래 응답(한 문단). P19 · 2로 돌아온다.
- **VO**: *"Say you've noticed students asking quick word questions — a spelling, a synonym — and the chatbot answering them unevenly: one word here, a whole paragraph there. You want these answered one way."*

## B3 · 경로 ② — 쿼리에서 intent (0:31–1:03)

- **화면**:
  1. P19 · 2 행 호버 → **+**(**Start an intent — read before "Uncategorized"**) 클릭.
  2. 폼이 리스트의 그 자리(Uncategorized 위)에 열린다: *Read before "Uncategorized".* · *Started from: "how do you spell exaggeration"* · **WHEN A QUESTION…** · **Starter sets ▾** · **THEN** · Add / Cancel.
  3. **Starter sets**를 한 번 연다 — 범례 *● the question you started from is in this set*, 유형·subtype 목록에 점 — 고르지 않고 닫는다(맥락 소개만).
  4. **WHEN에 타이핑**: `asks for a word — a spelling, a synonym, or how to use a term`
  5. **THEN에 타이핑**: `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.`
  6. **Add** 클릭.
- **VO**: *"Reading a question and deciding it should be handled differently is the move this board is built around — so an intent starts from the question. The form opens right where the intent will sit, quoting what you started from; starter sets are there if you want a ready-made description, marked where this question already belongs. You write the description and the rule in your own words, and Add."*
- **메모**: 이름 칸이 없다는 것은 말하지 않는다(비트 6에서 제목이 저절로 붙는 것으로 보여 준다).

## B4 · 판정을 지켜본다 → Examples와 정렬 (1:03–1:33)

- **화면**:
  1. 리스트 머리에 *working out where questions go* — 행마다 소속 칩(● {제목})이 붙어 간다(스트리밍 그대로).
  2. 왼쪽에 새 intent 행(제목이 몇 초 뒤 저절로 붙는다 — LLM 라벨) · 카운트.
  3. intent 행 클릭 → 아코디언(When·Then·Apply·Save·↺·🗑) + 가운데가 그 intent의 목록으로: 맨 위 **Examples · 1**(*The list below is ordered by these* · **Rewrite**) — 시드 P19 · 2가 들어 있다. 그 아래 *{제목} · n of 103* · **Most like these** · 헤더에 When 원문 · 전형적인 단어 질문들부터.
- **VO**: *"The tool then reads every question against your description — you can watch it work out where questions go, and each row gets a mark saying which intent now answers it. Open the intent and the question you started from sits at the top as its first example. The list below is ordered by these examples, most typical first — and a title has been written for you; the pencil changes it."*
- **메모**: 제목 문자열은 읽지 않는다. 카운트 숫자도 읽지 않는다.

## B5 · Examples 다듬기 — 정렬 뒤집기, 경계, When 수정 (1:33–2:08)

- **화면**:
  1. 목록의 다른 단어 질문 하나(예: P29 · 6 *when is i.e. used*) 행 호버 → ✨(**Use as an example — it orders the list, it does not move the question**) 클릭 → **Examples · 2**, 목록이 재정렬된다.
  2. **Most like these** 클릭 → **Least like these** — 목록이 뒤집혀 **가장 안 닮은 구성원**이 맨 위로. 맨 위 행을 1–2초 읽는다(실측 예: "can the conclusion be longer" — 단어 질문이 아니다).
  3. 아코디언의 **WHEN** 끝에 덧붙여 타이핑: ` — not requests to check or rewrite a whole draft` → **Apply**.
  4. 재판정이 돌고 목록이 바뀐다 — 빠진 행이 잠시 붉게 남고 들어온 행은 초록(소속 diff). 그 행이 이제 **Uncategorized** 칩을 단 것을 1초.
- **VO**: *"Any question can be made another example — it changes the order, it does not move the question. Flip the order to Least like these and the top row answers a different question: of everything your words caught, what is least like what you meant? If something there isn't yours, you fix it the only way this board fixes anything — by rewriting the description — and Apply re-reads the log: rows leaving fade out red, rows arriving come in green."*
- **메모**: 경계가 없으면 분기표 ⓑ5 — When 수정 없이 정렬 읽기까지만(대체 VO는 `06_NARRATION`).

## B6 · 경로 ① — 맨땅 intent, 모델 예시 3 (2:08–2:38)

- **화면**:
  1. 왼쪽 `+ ○ New intent` 행 클릭 → 같은 폼(이번엔 *Started from* 없음).
  2. **WHEN**: `asks the chatbot to write a full essay or a whole paragraph for them` / **THEN**: `Do not write the essay or paragraph. Ask what the student wants to say, and offer at most an outline of two or three bullet points.` → **Add**.
  3. 판정이 도는 동안 왼쪽에 둘째 intent 행(제목 저절로). 행 클릭 → **Examples · 3** — 이번에는 **모델이 쓴 가상 질문 3개**(이탤릭, `[Own draft]`류 자료 태그 포함 가능). **Rewrite**에 커서 1초(누르지 않는다).
  4. intent 행의 **↑**를 한 번 눌러 순서를 올려 본다(리스트 순서 = 읽히는 순서) → 다시 ↓로 복귀.
- **VO**: *"An intent doesn't need a question on screen — New intent starts one from scratch. Since you pointed at nothing, the tool writes three example questions from your description — they mirror what your words mean, they are not part of the setup, and Rewrite redoes them. The arrows change the order intents are read in — a question goes to the first one that claims it."*

## B7 · Save · 버전 · Deploy (2:38–2:53)

- **화면**:
  1. 아코디언의 **Save** 클릭 → 왼쪽 아래 버전 리스트에 행(이름은 몇 초 뒤 채워진다 · 시각). 카드 안 **Version history**를 한 번 펼쳐 행(`when` / `then` 표시)을 1초 — 접는다.
  2. 헤더 **Deploy** 클릭 → **Deployed vN** · **I'm done** 등장. (**I'm done은 누르지 않는다.**) 마지막 프레임 2초 홀드.
- **VO**: *"Save keeps this point — versions are named for you, and each intent keeps its own history of what moved, the description or the rule. When you're ready, Deploy saves what's in effect and stamps it as the setup you stand behind — and an I'm done button appears for the end of the round."*

---

## 단어 수·길이

VO ≈ 430 단어 → **165 s ± 7**. 비트별: B1 58 · B2 40 · B3 74 · B4 78 · B5 88 · B6 70 · B7 60. (ⓒ 합계와 ±5% 이내로 맞춘다 — `05_SCRIPT_C_CLAY.md` 참조.)

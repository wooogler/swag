# ⓑ Slate (simple_score) — 샷리스트 + 내레이션

> 목표 **170 s ± 10**, ⓒ와 **20 s 이내**. 시작 상태: `Run demo · Simple SCORE` → 브리핑 **Start** 직후. 왼쪽 열은 헤더 **Setup**(오른쪽에 **Undo** · **Redo**) 아래 `+ New intent` 행과 **Uncategorized** 행(카운트 알약 103)만 있는 리스트. 한 테이크로 끝까지.
>
> ⚠ **08-23 개정.** 소속 diff 색(빨강/초록)이 삭제됐다 · 정렬 토글이 `Closest first`/`Furthest first`로 바뀌어 Examples 헤더로 옮겨 갔다 · `Rewrite`가 `Generate examples`/`Update examples`가 됐다 · Add 직후 카드가 저절로 열린다 · **`I'm done`이 없어졌고 Deploy는 팝오버로 한 번 묻는다**.
>
> 타이핑 원문·분기표는 `02_SCENARIO.md` §4–5. 참고 화면 `shots/b01_*` ~ `b07_*`(08-23 재촬영). **판정·응답 스트리밍은 자르지 않는다** — 5 s 초과 구간만 ≤2 s.

---

## B0 · 타이틀 카드 (0:00–0:02)

검은 배경, **"Slate"**. 음성 없음.

## B1 · 왼쪽 열이 무엇인가 (0:02–0:17)

- **화면**: 커서를 왼쪽 열 맨 위 헤더 **Setup**과 그 오른쪽 **Undo** · **Redo**에 먼저 1초 → `+ New intent` 행 → **Uncategorized** 행과 카운트 알약(103). Uncategorized 행을 클릭한다 — 행이 켜지고 그 아래 **Then** 하나뿐인 rule 에디터가 그대로 열린다(When 없음). 1초 보여 주고 **열어 둔 채** 다음 비트로 넘어간다(같은 행을 다시 눌러도 닫히지 않는다 — 접는 방법이 없다).
- **VO**: *"In Slate, the left column is where the setup lives. You create intents: an intent is a group of questions you describe in words, with its own rule for how the chatbot responds to them. The list is read top to bottom, and anything no intent catches lands in Uncategorized at the end — which has a rule of its own."*
- **메모**: "read top to bottom"은 순서 의미론의 예고(비트 6에서 ↑↓로 회수).

## B2 · 질문을 읽는다 (0:17–0:31)

- **화면**: 가운데에서 **P19 · 2 · how do you spell exaggeration** 클릭 → 뷰어에 원래 응답(한 줄). 이어 **P56 · 4 · a word for understanding that something should be slow** 클릭 → 원래 응답(한 문단). P19 · 2로 돌아온다.
- **VO**: *"Say you've noticed students asking quick word questions — a spelling, a synonym — and the chatbot answering them unevenly: one word here, a whole paragraph there. You want these answered one way."*

## B3 · 경로 ② — 쿼리에서 intent (0:31–1:03)

- **화면**:
  1. P19 · 2 행 호버 → **+**(**Start an intent — read before "Uncategorized"**) 클릭.
  2. 폼이 리스트의 그 자리(Uncategorized 위, 리스트와 같은 왼쪽 끝)에 열린다: 제목 줄 **○ New intent** · *Read before "Uncategorized", so any of its **103** questions can come here. Nothing above it moves.*(아래에 intent가 없으므로 짧은 형태) · **STARTED FROM** 카드(`P19 · 2` + 질문 원문이 가운데 열과 같은 모양으로) · **When a question…** · **Starter sets ▾** · **Then** · Add / Cancel.
     - 폼이 열리는 동시에 **가운데 열의 선택도 옮겨 간다**(그 질문을 아직 아무도 안 가졌으면 Uncategorized로) — 같은 프레임에서 리스트가 바뀌는 것을 예상하고 컷을 잡는다.
  3. **Starter sets**를 한 번 연다 — 첫 열기에 *Loading…* → 유형·subtype 목록. 시드 질문이 든 행은 **배경이 물들고 제목 왼쪽에 ●**(상단 범례 줄은 없다). 그 행에 1초 호버하면 옆 패널에 *marks the sets the question you started from is in.* 이 나온다 — 고르지 않고 닫는다(맥락 소개만).
  4. **WHEN에 타이핑**: `asks for a word — a spelling, a synonym, or how to use a term`
  5. **THEN에 타이핑**: `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.`
  6. **Add** 클릭.
- **VO**: *"Reading a question and deciding it should be handled differently is the move this board is built around — so an intent starts from the question. The form opens right where the intent will sit, quoting what you started from; starter sets are there if you want a ready-made description, marked where this question already belongs. You write the description and the rule in your own words, and Add."*
- **메모**: 이름 칸이 없다는 것은 말하지 않는다(비트 6에서 제목이 저절로 붙는 것으로 보여 준다).

## B4 · 판정을 지켜본다 → Examples와 정렬 (1:03–1:33)

- **화면**:
  1. 리스트 머리에 *working out where questions go* — 행마다 소속 칩(● {제목})이 붙어 간다(스트리밍 그대로).
  2. 왼쪽에 새 intent 행(제목이 몇 초 뒤 저절로 붙는다 — LLM 라벨) · 카운트.
  3. **Add 직후 새 intent가 이미 선택되고 카드가 열려 있다**(따로 클릭하지 않는다): **When a question…** · **Then** · **Apply** · **Save** · 🗑, 그 아래 **Version history**(`v1` 한 행 — 새 intent는 Save로 태어난다). 가운데는 그 intent의 목록으로: 맨 위 **Examples · 1** — 헤더 오른쪽에 2분할 토글 [**Closest first** | Furthest first]와 **Generate examples** — 시드 P19 · 2가 들어 있다. 그 아래 *{제목}* · `n of 103` · 헤더에 When 원문 전문 · 전형적인 단어 질문들부터.
- **VO**: *"The tool then reads every question against your description — you can watch it work out where questions go, and each row gets a mark saying which intent now answers it. The intent opens on what you just made, with the question you started from at the top as its first example. The list below is ordered by those examples, closest first — and a title has been written for you; the pencil changes it."*
- **메모**: 제목 문자열은 읽지 않는다. 카운트 숫자도 읽지 않는다.

## B5 · Examples 다듬기 — 정렬 뒤집기, 경계, When 수정 (1:33–2:08)

- **화면**:
  1. 목록의 다른 단어 질문 하나(예: P29 · 6 *when is i.e. used*) 행 호버 → ✨(**Use as an example — it orders the list, it does not move the question**) 클릭 → **Examples · 2**, 목록이 재정렬된다.
  2. **Examples 헤더**의 2분할 토글에서 **Furthest first** 클릭(기본은 **Closest first**가 채워져 있다 — 이 컨트롤은 리스트 머리가 아니라 **Examples 카드 안**에 있다) — 목록이 뒤집혀 **가장 안 닮은 구성원**이 맨 위로. 맨 위 행을 1–2초 읽는다(실측 예: "can the conclusion be longer" — 단어 질문이 아니다).
  3. 아코디언의 **WHEN** 끝에 덧붙여 타이핑: ` — not requests to check or rewrite a whole draft` → **Apply**.
  4. 재판정이 돈다 — 리스트 머리에 *working out where questions go*, 그동안 행마다 소속 칩이 **다시 앉는다**(색이 들어왔다 빠지는 표시는 **없다** — 08-22에 삭제됐다). 문제의 행이 이제 회색 점 · **Uncategorized** 칩을 단 것을 1–2초, 이어서 왼쪽 트리의 카운트 알약이 줄어든 것과 카드의 **Version history** 맨 위에 `v{n} · unsaved` 행이 선 것을 1초.
- **VO**: *"Any question can be made another example — it changes the order, it does not move the question. Flip the order to Furthest first and the top row answers a different question: of everything your words caught, what is least like what you meant? If something there isn't yours, you fix it the only way this board fixes anything — by rewriting the description — and Apply re-reads the log, so the mark on each row settles again, and the one that isn't yours now says Uncategorized."*
- **메모**: 경계가 없으면 분기표 ⓑ5 — When 수정 없이 정렬 읽기까지만(대체 VO는 `06_NARRATION`). Apply 뒤 **눈에 보이는 변화가 소속 칩과 카운트뿐**이므로(색이 없다) 그 재정착을 끝까지 기다린다 — 다만 5 s를 넘으면 ≤2 s로 줄인다.

## B6 · 경로 ① — 맨땅 intent, 모델 예시 3 (2:08–2:38)

- **화면**:
  1. 왼쪽 `+ New intent` 행 클릭 → 같은 폼(이번엔 **STARTED FROM** 카드가 없다 — 제목 줄과 *Read before "Uncategorized"…* 위치 줄은 그대로).
  2. **WHEN**: `asks the chatbot to write a full essay or a whole paragraph for them` / **THEN**: `Do not write the essay or paragraph. Ask what the student wants to say, and offer at most an outline of two or three bullet points.` → **Add**.
  3. **Add 직후 둘째 intent가 이미 선택돼 있다**(제목은 몇 초 뒤 저절로). 몇 초 뒤 **Examples · 3**이 채워진다 — **모델이 쓴 가상 질문 3개**(이탤릭, `[Own draft]`류 자료 태그 포함 가능). 헤더 오른쪽 버튼은 3개가 찼으므로 **Update examples** — 커서 1초(누르지 않는다).
  4. intent 행의 **↑**를 한 번 눌러 순서를 올려 본다(리스트 순서 = 읽히는 순서) → 다시 ↓로 복귀.
- **VO**: *"An intent doesn't need a question on screen — New intent starts one from scratch. Since you pointed at nothing, the tool writes three example questions from your description — they mirror what your words mean, they are not part of the setup, and Update examples redoes them. The arrows change the order intents are read in — a question goes to the first one that claims it."*

## B7 · Save · 버전 · Deploy (2:38–2:53)

- **화면**:
  1. 카드의 **Save** 클릭 → 버튼이 흐려진다(호버하면 *Nothing has changed since the last save*). **왼쪽에 따로 뜨는 버전 리스트는 없다** — 히스토리는 카드 안 **Version history**뿐이고 **이미 펼쳐져 있다**(최근 3행 상시 노출). 첫 intent 행을 클릭해 그 카드의 히스토리를 1–2초 읽는다: `v2`(오른쪽 칸 **current**) · `v1`, 각 행에 한 줄 이름과 질문 수 알약. 트리 행의 **unsaved** 칩이 Save로 사라진 것도 같은 프레임에 들어온다.
  2. 헤더 **Deploy** 클릭 → 버튼 아래 팝오버가 열린다: *This deploys the setup you have now and ends it. There are a few quick questions next, then you will check what it answers. You will not be able to come back and change it.* · **Not yet** / **Deploy and finish**. 팝오버가 열린 프레임에서 **2초 홀드하고 녹화를 끝낸다** — **Deploy and finish는 누르지 않는다**(누르면 실제로 배포되고 블록이 끝나 `/study/session`으로 넘어간다).
- **VO**: *"Save keeps this point — versions are named for you, and each intent keeps its own history: every wording you kept, and how many questions that wording catches. When you're ready, Deploy asks once before it happens — it saves what's in effect, stamps it as the setup you stand behind, and ends the round."*

---

## 단어 수·길이

VO **448 단어**(08-23 실측) ≈ 168 s → 목표 **170 s ± 10**. 비트별: B1 61 · B2 33 · B3 69 · B4 75 · B5 87 · B6 68 · B7 55. ⓒ(≈180 s)와 **20 s 이내**(`05_SCRIPT_C_CLAY.md` 참조) — 초 단위로 맞추지 않는다(`01_PLAN` §4 [08-23 완화]). ⓑ는 VO가 화면을 거의 다 덮고, ⓒ는 타이핑 무음이 더 길어 VO가 짧다.

## 이 스크립트에서 찾지 말 것 [08-23]

- **`Types` 피커는 Clay 전용이다** — Slate 가운데 열 헤더에는 렌더되지 않는다(`onPickType`이 null). ⓒ에 대응 비트가 있다고 해서 여기 같은 비트를 넣으려 하지 않는다.
- **소속 diff 색**(빨강/초록)은 클라이언트·서버 양쪽에서 삭제됐다. Apply 뒤 움직이는 것은 소속 칩 · 트리 카운트 알약 · Version history의 `unsaved` 행뿐이다.
- **↺(Revert)**는 카드에 없다. Undo/Redo는 왼쪽 열 **Setup** 헤더에 글자로 있다.
- **`Rewrite` · `Most/Least like these` · `The list below is ordered by these`** — 전부 없는 문자열이다.

## 새로 생겨서 프레임에 잡히는 것 [08-23]

- **Apply의 흔적**: 그 카드의 **Version history** 맨 윗행에 다음 저장이 받을 번호와 오른쪽 칸 **unsaved**(질문 수 알약 포함), 트리의 그 행에도 **unsaved** 칩(툴팁 *Applied, and not in what the next step will read. Deploy keeps it.*). Save를 누르면 같은 행이 **current**가 된다. **사라진 색 신호가 하던 "방금 무엇이 달라졌나"를 이 행과 카운트가 대신한다** — B5·B7에서 여기를 가리킨다.
- **오른쪽 열이 intent 색을 입는다**: 선택된 질문의 링과 새 응답의 왼쪽 막대가 그 질문을 답하는 intent의 색(가운데 리스트의 점과 같은 색). 소속이 바뀌면 색도 따라 바뀐다 — B5에서 소속 변화를 한 프레임에 보여 줄 수 있는 유일한 색 변화다.
- **Starter sets의 카운트**는 이 intent가 **가로챌 더미**로 좁혀져 계산된다(툴팁 문구는 여전히 *in this course*지만 그 뜻이 아니다). 리허설보다 숫자가 작게 나와도 버그가 아니다 — 어차피 읽지 않는다.

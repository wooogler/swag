# ③Ⓒ Clay 워크스루 — 샷리스트

> **한 테이크로 끝까지.** 목표 **4:25 ± 10 s**(타이핑 모델·컷 적용 후 — 산출은 `01_PLAN` §1-2). 시작 상태: `Run demo · Simple Baseline` → 브리핑 **Start** 직후, 경과 0–1분.
>
> **개념은 ①이, 셸은 ②가 이미 가르쳤다.** 이 대본은 **관찰 → 손 → 확인**만 말한다. 화면 라벨을 설명하는 문장이 하나라도 들어가면 그건 ①·②의 몫을 훔친 것이다.
>
> **예외는 셋뿐이다.** ②ⓐ가 가르치는 것은 셸(헤더 · 목록 · 검색 · 대화 뷰어 · 핀 · Deploy)까지다. **준비된 분류(Ⓒ C9)** · **예시 정렬(Ⓢ S4)** · **준비된 세트(Ⓢ S9)** 는 어느 층도 가르치지 않으므로, 그 세 비트에서만 **한 절씩** 그것이 무엇인지 말하는 것을 허용한다. 그 밖에 화면을 설명하는 문장은 0이다. (대안은 ⓐ에 비트를 더해 이 셋을 셸 층으로 되돌리는 것인데, 셋 중 둘이 한쪽 arm에만 있어서 공통 세그먼트에 넣을 수 없다.)
>
> **음성·화면 어디에도 "intent" 금지.** 타이핑 원문·실측 응답·분기표는 `03_SCENARIO` §4–5. 참고 화면 `shots/c*`.
>
> **첫 프레임**(실측): 왼쪽 `Setup` / `Undo` `Redo` → `RULES` `0 / 8000`(플레이스홀더 보임) → `Apply` `Save` → `VERSION HISTORY 1` 의 `v0 Original (as delivered) · showing`. 가운데 `All questions 103 of 103` + `Types` + `Search questions`. 오른쪽 *Pick a question to see the conversation.*

---

## C0 · 타이틀 (0:00–0:03) — 무음

검은 배경, **Clay**. (① 개념 덱이 바로 앞에 붙어 재생되므로 타이틀은 짧게.)

## C1 · 읽다가 하나가 걸린다 (0:03–0:18 · 15 s)

- **화면**: 가운데 목록을 두어 화면 스크롤 → `P19 · 2 how do you spell exaggeration` 클릭. 오른쪽에 대화가 열리고 그 질문에 링. 배달본 한 줄 위 회색 문구에 커서 1초, 답을 읽는다: `The correct spelling is "exaggeration."`
- **VO**: *"A student asks how to spell a word. The answer is one line."*
- **메모**: 배달본 문구를 **설명하지 않는다**(②에서 배웠다). 커서만 스친다.

## C2 · 같은 종류, 다른 모양 (0:18–0:33 · 15 s)

- **화면**: `Search questions` 에 `spell` 타이핑 → 카운트가 `7 of 103` 으로, 행 본문의 `spell` 이 노랗게 물든다. `P29 · 3 spell egregious` 클릭 → 답이 `E-G-R-E-G-I-O-U-S`. 두 답을 번갈아 1초씩. ✕ 로 검색을 지운다.
- **VO**: *"Here is the same kind of question, and here the chatbot spells the word out letter by letter. Same question, two different answers. You want one way."*
- **메모**: 목록에 초안 전체 교정 요청 다섯 개도 섞여 나온다(`03_SCENARIO` §3-2) — **말하지 않는다.** 이 시스템에는 걸러내는 장치가 없고, C4의 문장은 *어떤 질문에 어떤 모양을 줄지*를 말할 뿐이다. 섞임을 언급하면 없는 기능을 암시하게 된다.

## C3 · 고쳐 볼 질문을 손 닿는 데 둔다 (0:33–0:41 · 8 s)

- **화면**: `P19 · 2` 행 호버 → 📌 → 위에 `Kept in view 1` 선반, 목록 헤더에 `· 1 kept above`.
- **VO**: *"Pin that question so it stays nearby and you can check it again while you work."*

## C4 · 규칙을 쓴다 → 지금 판으로 확인 (0:41–1:33 · 52 s — 타이핑 36 + Apply 4 + 스트리밍 12)

- **화면**:
  1. `RULES` 에 문단 1을 **실속도로** 타이핑(180자 ÷ 5자/초 = **36 s**. 램프 없음 — 이 한 번은 실시간이어야 한다). 카운터가 `180 / 8000`.
     `When a student asks for a word — a spelling, a synonym, or how to use a term — answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.`
  2. `Apply` → 오른쪽 줄이 `This reply is under [Now (unsaved)]` 로 바뀌고 그 아래 접힌 상자에 방금 쓴 문서, 새 답이 스트리밍된다(**자르지 않는다**):
     `exaggeration — "She was exaggerating when she said the hill was the tallest in the world."`
  3. 같은 프레임에서 왼쪽 `VERSION HISTORY` 맨 위에 `v1 · {이름} · unsaved` 행이 선다 — 커서만 1초.
- **VO**: *"So you write the rule in the document: a word question receives one or two lines, the word and one example. Try it, and the new answer follows that rule."*

## C5 · 겨냥 안 한 데까지 걸렸다 (1:33–1:51 · 18 s)

- **화면**: 목록을 조금 내려 `P29 · 5 define social anxiety` 클릭 → 같은 문서 아래에서 다시 답이 나온다:
  `social anxiety: intense fear or worry about being judged or embarrassed in social situations.` / `Example: She felt social anxiety before speaking in class.`
  1–2초 읽는다.
- **VO**: *"But this one is not a word question. It asks what a term means. And it now receives the same two lines. You did not write those lines for this kind of question."*

## C6 · 겨냥을 좁혀 본다 → 그래도 안 돌아온다 (1:51–2:20 · 29 s)

- **화면**:
  1. `P29 · 5` 도 📌 → `Kept in view 2`.
  2. `RULES` 첫 문단의 **앞 한 절만** 고쳐 쓴다(90자, 2× 램프 = **9 s**, 커서는 계속 보인다) → `194 / 8000`:
     `When a student asks how to spell a word, whether a spelling is right, or which word to use — answer in one or two lines: …`
  3. `Apply` → 선반의 `P29 · 5` 클릭 → 답:
     `Social anxiety is a strong fear of being judged, embarrassed, or watched by other people in social situations.` / `Example: She felt social anxiety before speaking in front of the class.`
     **여전히 두 줄이다.**
- **VO**: *"You can make the rule narrower, and you do. The answer is still two lines. Nothing in the document says what a definition should receive, so the chatbot copies the format of the sentence that is already there."*
- **메모**: 이 비트의 요점은 **실패가 아니라 논증**이다 — "무엇을 하지 말지"가 아니라 "**무엇을 줄지**"를 써야 한다는 것. 경고 톤 금지.

## C7 · 정의에 무엇을 줄지 쓴다 (2:20–2:54 · 34 s)

- **화면**:
  1. 문서 끝에 **빈 줄 하나** 띄우고 문단 2를 타이핑(155자, 2× 램프 = **16 s**) → `351 / 8000`:
     `When a student asks what a term means, answer in three or four sentences: a plain-language definition, then one example of how the term is used in writing.`
  2. `Apply` → `P29 · 5` 의 답이 세 문장으로 자란다:
     `Social anxiety is a strong fear of being judged, embarrassed, or watched by other people in social situations. It can make things like talking, meeting new people, or speaking in class feel very stressful. In writing, you might say, "Her social anxiety made it hard for her to attend parties."`
  3. **선반의 다른 핀 `P19 · 2` 클릭** → `Exaggeration.` / `"The story was an exaggeration of what really happened."` — 여전히 한두 줄.
- **VO**: *"So you write what a definition should receive: three or four sentences, and one example of the word in use. Now it answers that way. The spelling question you pinned earlier still answers the way you asked. Two paragraphs in one document, and the chatbot reads both every time."*
- **메모**: 마지막 절이 ① 개념 슬라이드 C3의 회수다. **순서를 언급하지 않는다** — 이 시스템에는 순서가 없다.

## C8 · 핀을 놓고, 다시 읽다가 하나 더 (2:54–3:14 · 20 s)

- **화면**: 선반의 📌 두 개를 눌러 해제 → 선반이 사라진다. 목록을 내려 `P29 · 8 Make this succinct "The [OWN DRAFT · 40 words · 24%]"` 클릭 → 답이 **줄여 놓은 재작성본** 하나.
- **VO**: *"Now you continue reading the list. Here a student asks the chatbot to make their own paragraph shorter, and the chatbot writes a shorter version for them."*

## C9 · 그 종류만 남기고 읽는다 → 세 번째 규칙 (3:14–4:10 · 56 s — 타이핑 24가 그 절반)

- **화면**:
  1. 가운데 헤더 `Types ▾` → 메뉴에서 `Reviewing` 아래 **`Shorten / Trim`** 선택 → 목록 제목이 **`Shorten / Trim`**, 카운트 `8 of 103`, **제목 아래에 그 분류의 문장**이 찍힌다. 그 문장에 커서 1–2초 — **이것이 다음 문단의 When이 된다.**
  2. 문서 끝에 빈 줄 하나 띄우고 문단 3을 타이핑(235자, 2× 램프 = **24 s**) → `588 / 8000`:
     `When a student asks the chatbot to shorten or cut something they wrote, do not hand back a rewritten version. Point at the two or three sentences that could go, say in one line why each is the weakest, and let the student make the cut.`
  3. `Apply` → `P29 · 8` 의 답이 바뀐다:
     `Cut "while likely detrimental to some users' communication" — it's the most awkward and least direct part.` / `Cut "(though this can also be viewed as a downside)" — it repeats the idea and weakens the sentence.`
  4. ✕ (`Show every question again`) → `All questions 103 of 103` 로 복귀. **이 동작은 자르지 않는다.**
- **VO**: *"The list can be narrowed to that one kind of request, and the category explains what it includes, so you have words to start from. You write the third rule from them: do not rewrite the text, show which sentences could be removed. Try it, and it does. Then remove the category filter. Choosing a category changed what you were reading, not what you wrote."*
- **메모**:
  - **분류는 읽는 방법이지 쓰는 방법이 아니다.** *"이 분류로 규칙을 만든다"* 류 금지 — 분류가 설정에 들어간다는 뜻이 되어 다른 보드의 기능을 이식하는 설명이 된다. 화면 사실만: **목록에 무엇이 보일지를 바꾼다.**
  - 목록의 여덟 줄 중 `P44 · 5 can the conclusion be longer` 는 오히려 늘려 달라는 요청이다. **분류의 정확성을 주장하지 않는다.**
  - 4번(필터 해제)이 이 비트의 요점이다 — 좁혀 읽었어도 쓴 것은 전 질문에 걸린다.

## C10 · 지점을 남기고, 배포는 한 번 묻는다 (4:10–4:25 · 15 s)

- **화면**:
  1. `Save` → `VERSION HISTORY` 맨 윗행의 상태 칸이 `unsaved` → `current` 로 바뀐다(**행이 새로 생기는 것이 아니다**). Apply·Save가 흐려진다.
  2. 헤더 `Deploy` → 아래 팝오버: *This deploys the setup you have now and ends it. There are a few quick questions next, then you will check what it answers. You will not be able to come back and change it.* · **Not yet** / **Deploy and finish**.
  3. **2초 홀드하고 녹화 종료.**
- **VO**: *"Save keeps this version. And when you are ready, Deploy asks you to confirm once. Confirming ends the round, and from then on your students use the chatbot you set up."*
- ⚠ **`Deploy and finish` 는 누르지 않는다.** 누르면 그 자리에서 블록이 끝나고 `/study/session` 으로 넘어가 보드로 못 돌아온다. 실수로 열렸을 뿐이면 **Not yet**.

---

## 이 대본에서 찾지 말 것

- **`Revert` 버튼** — 화면에 없다. Clay에는 되돌리기가 `Undo`(왼쪽 열 헤더)와 옛 버전 행 클릭 → `Restore` 뿐이고, **이 대본은 둘 다 쓰지 않는다**(Slate S5에서만 쓴다).
- **별도 버전 패널** — 히스토리는 `RULES` 카드 안이고 첫 프레임부터 `v0` 한 행이 있다.
- **버전 이름을 읽는 문장** — 실측에서 같은 문서가 Apply·Save를 거치며 `Clarified word-help request rules` → `Add initial Rules formatting guide` 로 바뀌었다. 이름은 읽지도, 인용하지도 않는다.
- **`working out where questions go`** — Clay에서는 **절대 렌더되지 않는다**(판정이 없다). 대기 중 문구는 오른쪽의 `Working out this reply under …` 뿐이다.

## 단어 수·길이

VO **329단어** ≈ 127 s(TTS 기준). 화면 길이 **265 s(4:25)** — 차이는 타이핑·확인 무음이다(문단 3개 588자 + Apply **4회**(C4·C6·C7·C9) + 응답 생성 6회).
Ⓢ(263 s)와의 차이는 **2 s**로 상한 20 s 안이다. VO 단어 수는 329 대 342로 +4.0 %(상한 ±5 %).
비트별 VO(단어): C1 13 · C2 27 · C3 16 · C4 30 · C5 33 · C6 38 · C7 49 · C8 27 · C9 65 · C10 31. **비트 창 안에 다 들어간다** — 가장 빡빡한 곳이 C10(31단어 = 12.0 s / 창 15 s).

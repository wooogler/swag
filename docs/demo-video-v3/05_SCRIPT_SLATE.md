# ③Ⓢ Slate 워크스루 — 샷리스트

> **한 테이크로 끝까지.** 목표 **4:23 ± 10 s**(타이핑 모델·컷 적용 후 — 산출은 `01_PLAN` §1-2). 시작 상태: `Run demo · Simple SCORE` → 브리핑 **Start** 직후, 경과 0–1분.
>
> **개념은 ①이, 셸은 ②가 이미 가르쳤다.** 이 대본은 **관찰 → 손 → 확인**만 말한다.
>
> **예외는 셋뿐이다.** ②ⓐ가 가르치는 것은 셸(헤더 · 목록 · 검색 · 대화 뷰어 · 핀 · Deploy)까지다. **준비된 분류(Ⓒ C9)** · **예시 정렬(Ⓢ S4)** · **준비된 세트(Ⓢ S9)** 는 어느 층도 가르치지 않으므로, 그 세 비트에서만 **한 절씩** 그것이 무엇인지 말하는 것을 허용한다. 그 밖에 화면을 설명하는 문장은 0이다. (대안은 ⓐ에 비트를 더해 이 셋을 셸 층으로 되돌리는 것인데, 셋 중 둘이 한쪽 arm에만 있어서 공통 세그먼트에 넣을 수 없다.)
>
> 타이핑 원문·실측 결과·분기표는 `03_SCENARIO` §4–5. 참고 화면 `shots/s*`.
>
> **첫 프레임**(실측): 왼쪽 `Setup` / `Undo` `Redo` → `+ New intent` 행 → `Uncategorized` 행(카운트 알약 `103`)이 **이미 선택돼 열려 있고** 그 아래 `THEN` 하나뿐인 편집기 + `Apply` `Save` + `VERSION HISTORY 1`(`v0 Original (as delivered) · showing`). 가운데 `Uncategorized 103 of 103`, **모든 행에 `● Uncategorized` 소속 칩**. 헤더에 `Types` 는 **없다**.

---

## S0 · 타이틀 (0:00–0:03) — 무음

검은 배경, **Slate**.

## S1 · 읽다가 하나가 걸린다 (0:03–0:16 · 13 s)

- **화면**: 목록을 두어 화면 스크롤 → `P19 · 2 how do you spell exaggeration` 클릭 → 배달본 한 줄: `The correct spelling is "exaggeration."`
- **VO**: *"A student asks how to spell a word. The answer is one line."*
- **메모**: Ⓒ C1과 **같은 행·같은 VO**.

## S2 · 같은 종류, 다른 모양 (0:16–0:31 · 15 s)

- **화면**: `Search questions` ← `spell` → `7 of 103`, 하이라이트. `P29 · 3 spell egregious` → `E-G-R-E-G-I-O-U-S`. 두 답을 번갈아 1초씩. ✕ 로 지운다.
- **VO**: *"Here is the same kind of question, and here the chatbot spells the word out letter by letter. Same question, two different answers. You want one way."*
- **메모**: Ⓒ C2와 **같은 VO**.

## S3 · 그 질문에서 시작한다 (0:31–1:16 · 45 s — 타이핑 22 + 판정 10)

- **화면**:
  1. `P19 · 2` 행 호버 → **`+`**(툴팁 `Start an intent — read before “Uncategorized”`) 클릭.
  2. 폼이 리스트의 그 자리에 열린다: `○ New intent` · *Read before “Uncategorized”, so any of its **103** questions can come here. Nothing above it moves.* · `STARTED FROM` 카드(`P19 · 2` + 질문 원문) · `WHEN A QUESTION…`(플레이스홀더 `asks for…`) · `Starter sets ▾` · `THEN` · `Add` / `Cancel`.
     ※ 폼이 열리는 **같은 프레임에서 가운데 선택도 옮겨 간다** — 컷을 여기 맞춘다.
  3. **WHEN 타이핑(실속도 — 이 한 번은 램프 없이. 62자 ÷ 5자/초 = 12 s)**: `asks for a word — a spelling, a synonym, or how to use a term`
  4. **THEN 타이핑(100자, 2× 램프 = 10 s)**: `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.`
  5. `Add` → 리스트 헤더에 *working out where questions go*, 행마다 소속 칩이 붙어 간다. **이 첫 판정은 자르지 않는다**(~30 s는 ≤10 s로만 압축). 왼쪽에 새 행이 서고 제목이 몇 초 뒤 저절로 붙는다.
- **VO**: *"So you start an intent from the question you are reading. You describe the kind: a spelling, a synonym, how to use a term. And you write the rule: one or two lines, the word and one example. Then the tool compares every question in the log with your description."*
- **메모**: `Reuse a rule` 은 이 첫 폼에 **없다**(재사용할 rule이 아직 없다). 없다는 것을 말하지 않는다.

## S4 · 무엇이 걸렸는지 뒤에서부터 본다 (1:16–1:30 · 14 s)

- **화면**: `Add` 직후 카드가 **저절로 열려 있다** — `Examples 1`(시드 `P19 · 2`), 헤더에 `[Closest first | Furthest first]` 와 `Generate examples`. **`Furthest first`** 클릭 → 목록이 뒤집힌다.
- **VO**: *"The questions it collected are ordered by that first example. Reverse the order, and the top row answers a different question: of everything your words collected, which one is least like what you meant?"*

## S5 · 정의 질문이 걸려 있다 → 고쳐 보고, 되돌린다 (1:30–2:09 · 39 s)

- **화면**:
  1. 맨 위 두 줄을 1–2초 읽는다: `P38 · 1 Could you help me define "automation" …` · `P29 · 5 define social anxiety`.
  2. 카드의 **WHEN 끝에 덧붙여 타이핑**(31자, 2× 램프 = 3 s): ` — not asking what a term means` → `Apply`.
  3. 재판정(**컷: ≤3 s**) → 소속 칩이 다시 앉는다. 정의 둘은 빠졌지만 **`P11 · 8` · `P30 · 2` · `P26 · 9` 가 새로 들어와 있다.** 카운트 알약이 움직이고, 트리 행에 `unsaved` 칩, `VERSION HISTORY 2` 에 `v2 · {이름} · unsaved` / `v1 · {이름} · 4m ago`.
  4. **`v1` 행 클릭** → 보드가 그 버전으로 읽기 전용이 되고 히스토리 헤딩 줄에 `Restore` · `Latest` 가 나온다.
  5. **`Restore`** → 확인 줄 `Back to setup 1, dropping what came after?` → **`Restore`** → v2가 사라지고 `VERSION HISTORY 1`, 목록이 원래 16개로 돌아온다.
- **VO**: *"Some of these ask what a term means. Your words collected them too. You can rewrite the description, and you do. But rewriting moves the whole boundary. The definitions leave, and others you did not intend arrive. There is another way, so you return to the wording you had."*
- **메모**: 4–5번이 이 비트의 요점이다. **되돌리는 것이 실패가 아니라 선택지**라는 것. "실수", "잘못" 같은 말 금지.

## S6 · 정의 질문에서, 위에 하나 더 (2:09–2:49 · 40 s — 타이핑 19)

- **화면**:
  1. `P29 · 5` 행 호버 → `+` — 툴팁이 이번엔 **`Start an intent — read before “{단어 intent 제목}”`** 로 바뀐다(제목은 LLM이 붙이므로 런마다 다르다 — 대조하지 않는다). 클릭.
  2. 폼이 **단어 intent 위에** 열린다: *Read before “{단어 intent 제목}”, so any of its **{그 수}** questions can come here, and anything below it this also describes. Nothing above it moves.* — **여기서 문장 형태만 확인하고 이름·숫자는 넘어간다.** · `STARTED FROM` `P29 · 5 define social anxiety` · 이번엔 `Reuse a rule` 도 있다(누르지 않는다).
  3. **WHEN(60자, 2× 램프 = 6 s)**: `asks what a term means — a definition of a word or a concept`
     **THEN(128자, 2× 램프 = 13 s)**: `Give a two or three sentence definition in plain language, then one example of how the term is used in writing. Do not go longer.`
  4. `Add` → 재판정(**컷: ≤3 s**). 새 행이 **위에** 서고, 아래 행의 카운트가 줄어든다.
- **VO**: *"Instead you start an intent from the definition question itself. Because you started from a question the first intent already answers, the new one is placed above it. Above means it is read first. The definitions come here now, and the rest stays where it was."*

## S7 · 확인 (2:49–3:01 · 12 s)

- **화면**: `P29 · 5` 클릭 → `This reply is under [v1 · {이름}]`, 접힌 상자에 방금 쓴 규칙, 답:
  `Social anxiety is a strong fear of being judged, embarrassed, or watched by other people in social situations. It can make someone avoid speaking up, meeting new people, or doing things in front of others.` / `Example: Her social anxiety made it hard for her to talk in class, even when she knew the answer.`
- **VO**: *"And it answers the way you asked."*

## S8 · 남은 것을 읽다가 하나 더 (3:01–3:21 · 20 s)

- **화면**:
  1. 왼쪽 트리의 **`Uncategorized`** 클릭 → `Uncategorized 86 of 103`.
  2. 목록을 내려 `P29 · 8 Make this succinct "The [OWN DRAFT · 40 words · 24%]"` 클릭 → **`This reply is the one that was delivered.`**(아직 아무것도 이 질문을 답한 적이 없다) — 줄여 놓은 재작성본 하나.
  3. 📌 로 고정 → `Kept in view 1`.
  4. `+ New intent` 클릭 → 폼이 열린다. 이번엔 **`STARTED FROM` 카드가 없다**.
- **VO**: *"Then you read the questions that are left. Here a student asks the chatbot to make their own paragraph shorter, and the chatbot writes a shorter version. Pin it, and this time start an intent without choosing a question first."*

## S9 · 준비된 문장을 When으로 가져온다 (3:21–4:10 · 49 s — 타이핑 16)

- **화면**:
  1. `Starter sets ▾` → `Reviewing` 아래 **`Shorten / Trim`** 선택 → **WHEN이 그 세트의 문장으로 채워진다**:
     `asks the chatbot to shorten text or remove some content — for example, "Make this more concise — two sentences only.", "Shorten this paragraph: [paragraph]", or "Remove the part that mentions I'm a CS student."`
  2. **THEN 타이핑(158자, 2× 램프 = 16 s)**: `Do not hand back a rewritten version. Point at the two or three sentences that could go, say in one line why each is the weakest, and let the student make the cut.`
  3. `Add` → 재판정(**컷: ≤3 s**). 선반의 `P29 · 8` 행 칩이 새 intent 색으로 바뀐다. 몇 초 뒤 `Examples 3` 이 **모델이 쓴 가상 질문 3개**(이탤릭)로 채워지고 헤더 버튼이 `Update examples` — 커서 1초, 누르지 않는다.
  4. 선반의 `P29 · 8` 클릭 → 답: `The weakest spots are:` + 자를 후보 세 개와 각각의 이유.
- **VO**: *"The starter sets contain descriptions that are already written. You choose the one for this request, so you only write the rule: do not rewrite the text, show which sentences could be removed. Add it, and the question you pinned is answered by this intent."*
- **메모**:
  - **세트를 고르면 제목도 그 세트의 이름을 받는다** — 이 intent만 이름이 사람이 정한 것이다. **읽지 않는다.**
  - Starter sets의 카운트는 **이 자리가 가로챌 더미** 기준이라 작다(실측 `Shorten / Trim` **7**). 읽지 않는다.

## S10 · 지점을 남기고, 배포는 한 번 묻는다 (4:10–4:23 · 13 s)

- **화면**:
  1. **`Save`** — **이 대본에서는 항상 흐리다**(A·B·C 세 `Add` 가 전부 저장이고, S5의 Restore도 저장된 지점을 tip으로 남긴다). **호버만** 하고 툴팁 *Nothing has changed since the last save* 를 1초 보여 준다. 살아 있다면 계획에 없던 편집이 그 테이크에 들어갔다는 뜻이니 누르고(맨 윗행이 `current` 로) 넘어간다.
  2. 헤더 `Deploy` → 팝오버: *This deploys the setup you have now and ends it. …* · **Not yet** / **Deploy and finish**.
  3. **2초 홀드하고 녹화 종료.**
- **VO**: *"Save keeps this version. And when you are ready, Deploy asks you to confirm once. Confirming ends the round, and from then on your students use the chatbot you set up."*
- **메모**: VO 마지막 문장은 Ⓒ C10과 **글자까지 같다**. Save가 흐려 있어도 이 문장은 그대로 읽는다(사실 진술이다). Ⓢ의 Save 툴팁은 Ⓒ와 문구가 다르다(`01_PLAN` §5) — 화면에 잡히지만 읽지 않는다.
- ⚠ **`Deploy and finish` 는 누르지 않는다.**

---

## 이 대본에서 찾지 말 것

- **`Types` 피커** — Slate 가운데 열 헤더에 렌더되지 않는다. 준비된 분류는 이쪽에서 **`Starter sets`** 로만 만난다(S9).
- **`Revert` 버튼** — 화면에 없다. S5의 되돌리기는 **버전 행 클릭 → `Restore` → 확인**이다.
- **소속 diff 색(빨강/초록)** — 삭제됐다. Apply 뒤 움직이는 것은 소속 칩 · 카운트 알약 · `unsaved` 행뿐이다.
- **`Rewrite` · `Most/Least like these`** — 없는 문자열이다.

## 새로 프레임에 잡히는 것

- **오른쪽 열이 intent 색을 입는다**: 선택된 질문의 링과 새 응답의 왼쪽 막대가 그 질문을 답하는 intent의 색. S6 뒤 소속이 바뀌면 색도 따라 바뀐다.
- **카운트가 두 군데에 있고 값이 다르다**: 트리 행의 알약 = **이 intent가 실제로 답하는 수**, 가운데 목록 헤더의 `n of 103` = **그 목록에 남은 줄 수**(예시 카드로 올라간 질문은 빠지고, 위 intent가 이미 가져간 질문은 다른 색 칩을 단 채 남는다). 실측: `Asking for Term Meaning` 이 트리 8 / 헤더 `7 of 103`(시드 `P29 · 5` 가 예시로 올라갔다), `Shorten / Trim` 이 트리 7 / 헤더 `8 of 103`(`P1 · 3` 이 위 intent 소속인 채로 목록에 남아 있다). **둘 다 읽지 않는다.**

## 단어 수·길이

VO **342단어** ≈ 132 s(TTS 기준). 화면 길이 **263 s(4:23)** — 차이는 타이핑·판정 무음이다(타이핑 539자 + 판정 4회 + 응답 생성 4회).
Ⓒ(265 s)와의 차이는 **2 s**로 상한 20 s 안이다. 단어 수는 329 대 342로 +4.0 %(상한 ±5 %).
비트별 VO(단어): S1 13 · S2 27 · S3 50 · S4 34 · S5 49 · S6 46 · S7 7 · S8 40 · S9 45 · S10 31. **가장 빡빡한 곳이 S4**(34단어 = 13.2 s / 창 14 s) — 여기만 낭독 속도를 165 단어/분 쪽으로 붙인다.

# 내레이션 원고 v3 (녹음용)

> 읽을 것만. 대응 샷은 `02`/`04`/`05`의 같은 번호. **영어**, **다섯 트랙(②ⓐ ①Ⓒ ①Ⓢ ③Ⓒ ③Ⓢ)을 같은 목소리·같은 설정으로** 만든다. ②ⓐ는 v2 원고의 TTS 개정판이다(아래).
>
> 규칙: 분당 155–165 단어 · 평탄한 톤 · 도구 명사(intent, rule, pin)에 강세 금지 · 비트마다 끊고 3초 · 괄호 지시는 읽지 않는다 · 화면 라벨은 대소문자 그대로.
>
> **LLM이 붙이는 이름(intent 제목·버전 이름)은 절대 읽지 않는다** — 매런 다르고, 실측에서 같은 문서가 Apply 두 번 사이에 이름이 바뀌었다.
>
>
> ## TTS로 읽힌다 (ElevenLabs)
>
> 이 원고는 **사람이 아니라 합성 음성이 읽는다**는 전제로 문장부호를 정리했다.
>
> - **em dash(—)를 VO에서 전부 없앴다.** 낭독 엔진이 이걸 예측 불가능한 길이의 정지나 잡음으로 처리하는 일이 잦다. 원래 em dash가 하던 일은 **마침표(독립절)** 또는 **쉼표(가벼운 삽입구)** 로 옮겼다. 뜻과 단어 수는 유지했다.
> - **어휘도 TTS와 비원어민 청자를 함께 겨냥해 정리했다 [2026-08-23].** 뜻이 부분의 합이 아닌 **구동사**(hands back · folds away · goes down · comes in · get back to · flip it · step through)와 **은유**(shape · edge · caught)를 걷어내고, **한 낱말로 뜻이 서는 쉬운 동사**로 바꿨다 — 참가자 중에 영어가 모국어가 아닌 사람이 있을 수 있고, 합성 음성은 어려운 구문을 더 어렵게 만든다. 짧은 낱말을 Latinate 낱말로 바꾼 것이 아니라, **모호한 낱말을 분명한 낱말로** 바꾼 것이다(예: *hands the chatbot to your students* → *your students use the chatbot you set up*).
> - **VO에 남아 있는 문장부호는 여섯 개뿐이다**: `.` `,` `:` `?` `'` `-`(합성어). 세미콜론·괄호·말줄임표·따옴표·**숫자 0개**. 콜론 일곱 곳은 전부 **짧은 동격**을 여는 자리라 낭독에서 짧은 쉼으로 안전하게 읽힌다.
> - ⚠ **`03_SCENARIO` §4의 타이핑 원문과 `04`/`05`의 인용된 rule 문장에는 em dash가 그대로 있다. 그건 화면에 타이핑되는 글자이지 읽는 글자가 아니다 — TTS에 붙여 넣지 않는다.** 실측된 화면 텍스트라 고치면 응답이 달라진다.
>
> **넣는 법**
>
> 0. **손으로 옮겨 붙이지 않아도 된다.** `tts/export.py` 가 이 원고에서 대사만 뽑아 `tts/lines/*.txt` 로 써 둔다 — 마크다운·한글·지문이 섞이지 않고, 글자까지 같은 다섯 쌍은 **한 파일**로 묶여 나온다(비트 35개 → 클립 30개). 목록은 `tts/MANIFEST.md`. **원고를 고쳤으면 `python3 tts/export.py` 를 다시 돌린다.**
> 1. **비트 하나에 클립 하나.** `tts/lines/` 의 파일 하나를 통째로 붙여 넣고 그 이름으로 저장한다. 비트 사이 3초는 **편집에서** 넣는다 — 한 번의 생성 안에 빈 줄을 넣으면 쉼 길이를 통제할 수 없다.
> 2. **붙여 넣지 않는 것**: `**C4**` 같은 비트 표시, 한글 지시문, 괄호 안 지문, 이 안내 블록.
> 3. **다섯 트랙 전부 같은 목소리·같은 설정.** 두 조건이 같게 들려야 한다는 것이 패리티의 절반이고, 덱 사이에 설정을 바꾸면 그 자체가 조건 차이가 된다.
> 4. **글자까지 같은 줄은 한 번만 생성해 두 덱에 같은 파일을 쓴다** — ①의 `C1`/`S1`(프레임)·`C5`/`S5`(사이클), ③의 `C1`/`S1` · `C2`/`S2` · `C10`/`S10`. 두 번 생성하면 억양이 미세하게 갈리고, 그건 두 번 찍을 이유가 없는 차이다.
> 5. **받고 나서 들어 볼 것**: 소문자 `when` / `then`(①S2·S3·S4에서 개념어로 또렷이 들려야 한다) · `intent`의 강세 · ①의 마지막 문장에서 `That ends the round` 가 앞 절에 붙어 뭉개지지 않는지.
> 6. 쉼이 더 필요하면 **문장부호로** 해결한다. SSML 태그를 쓸 거면 **양 덱에 똑같이** 넣는다.
>
> **v3에서 달라진 규율:** 워크스루 트랙(③)은 **화면을 설명하지 않는다.** "왼쪽 열은…", "이 버튼은…", "…라고 부릅니다"가 한 번이라도 나오면 다시 녹음한다. 개념은 ①이, 셸은 ②가 이미 말했다.
>
> **예외는 셋뿐이다** — ②ⓐ가 안 가르치는 표면이라 각각 **한 절**만 허용한다: **C9**(준비된 분류) · **S4**(예시 정렬) · **S9**(준비된 세트). 지금 원고에서 그 세 절은 각각 *"The list can be narrowed to that one kind of request…"* · *"The questions it collected are ordered by that first example."* · *"The starter sets contain descriptions that are already written."* 이고, **여기서 더 늘리지 않는다.**

---

## ②ⓐ Getting around (213단어 ≈ 82 s · 화면 75 s) — **v2 원고의 TTS 개정판**

> v2(`docs/demo-video-simple/06_NARRATION.md` ⓐ)의 다섯 비트를 그대로 옮기되 **em dash 세 곳을 없애고**(A2·A4·A5) 축약형을 풀었다. 나머지 트랙과 **같은 목소리로 새로 만든다** — 영상은 기존 것을 쓰지만 소리는 전부 한 세션에서 나와야 네 층이 한 사람 목소리로 들린다.
>
> A5의 마지막 문장만 뜻이 바뀌었다: *The next video shows…* → *What comes next shows…*. 세그먼트를 한 파일로 합치면 "다음 영상"이 아니라 "다음 부분"이 되기 때문이고, 합치지 않아도 참인 문장이다.
>
> ⚠ **213단어는 느린 낭독(155 단어/분)에서 82 s다. 기존 ⓐ 영상은 75 s다.** 편집에서 그림을 늘리거나(정지 프레임 1–2 s), 낭독을 165 단어/분 쪽으로 붙인다.

**A1**
> This is the Chatbot Studio. It starts with a short briefing: your task for this round, the assignment the students were given, and the prompt the chatbot began with. You can open it again any time from Your task, in the header.

**A2**
> The middle column lists every question students asked the chatbot. One row for each question, with the student's ID and which turn it was. Text the student pasted in is marked. The search box shows only the questions that contain the words you type.

**A3**
> Click a question and the whole conversation opens on the right, with that question highlighted. A line above the reply marks the answer the student actually received. Pasted text is hidden until you open it, and these arrows move to the student's other questions.

**A4**
> Pin a question to keep it visible. It moves to a separate area above the list, and it stays there no matter what you select or change later. Click the pin again to remove it.

**A5**
> And at the top: how many minutes you have worked in this round, and Deploy, which sends your setup to the student chat and ends the round, when you decide it is ready. It asks you to confirm first. The next part shows how to build a setup.

> ⓐ는 **한 번 만들어 두 블록-1 영상에 같은 파일**을 쓴다 — 그림(보드별 테이크)만 다르고 소리는 같다.

---

## ①Ⓒ Concept · Clay (192단어 ≈ 70–74 s · 덱 81 s)

**C1**
> Students in this course wrote with a chatbot. You do not answer their questions. You write the instructions for the chatbot that answers them, the way you would instruct a teaching assistant who works without you in the room. What you write decides what students receive.

**C2**
> In Clay, your instructions are a single document, written in your own words. There are no forms and no fields. You write sentences, and those sentences are the whole setup.

**C3**
> Whatever a student asks, the chatbot reads your whole document. Not a selected part of it. The whole document, every time. Nothing narrows it to the kind of question that has arrived.

**C4**
> So a paragraph you write for one kind of question is also read when a different kind of question arrives. Nothing selects which paragraph applies. All of them are present, all of the time.

**C5**
> You work in a loop. Write, try it, and read the answer it now gives to a question students already asked. Save any version you might want later. When you are ready, you deploy. That ends the round, and from then on your students use the chatbot you set up.

---

## ①Ⓢ Concept · Slate (199단어 ≈ 72–77 s · 덱 85 s)

**S1**
> Students in this course wrote with a chatbot. You do not answer their questions. You write the instructions for the chatbot that answers them, the way you would instruct a teaching assistant who works without you in the room. What you write decides what students receive.

**S2**
> In Slate, your instructions are a list of intents. An intent has two parts: a description of one kind of question, and the rule for answering that kind. A when, and a then.

**S3**
> Before it answers, the chatbot checks your list from top to bottom. Each question belongs to exactly one intent: the first description that matches it. The rest are not used, and the rule of that intent writes the reply.

**S4**
> The last place in the list holds every question that did not belong to any intent above it. It has a rule but no description, so it answers everything that remains.

**S5**
> You work in a loop. Write, try it, and read the answer it now gives to a question students already asked. Save any version you might want later. When you are ready, you deploy. That ends the round, and from then on your students use the chatbot you set up.

> ⚠ ①의 **C1 과 S1**(누가 무엇을 하는가), **C5 와 S5**(사이클)는 **글자까지 같다.** 각각 한 번 만들어 두 트랙에 같은 파일을 얹는다.

---

## ③Ⓒ Walkthrough · Clay (329단어 ≈ 127 s · 화면 265 s)

**C1**
> A student asks how to spell a word. The answer is one line.

**C2**
> Here is the same kind of question, and here the chatbot spells the word out letter by letter. Same question, two different answers. You want one way.

**C3**
> Pin that question so it stays nearby and you can check it again while you work.

**C4**
> So you write the rule in the document: a word question receives one or two lines, the word and one example. Try it, and the new answer follows that rule.

**C5**
> But this one is not a word question. It asks what a term means. And it now receives the same two lines. You did not write those lines for this kind of question.

**C6**
> You can make the rule narrower, and you do. The answer is still two lines. Nothing in the document says what a definition should receive, so the chatbot copies the format of the sentence that is already there.

**C7**
> So you write what a definition should receive: three or four sentences, and one example of the word in use. Now it answers that way. The spelling question you pinned earlier still answers the way you asked. Two paragraphs in one document, and the chatbot reads both every time.

**C8**
> Now you continue reading the list. Here a student asks the chatbot to make their own paragraph shorter, and the chatbot writes a shorter version for them.

**C9**
> The list can be narrowed to that one kind of request, and the category explains what it includes, so you have words to start from. You write the third rule from them: do not rewrite the text, show which sentences could be removed. Try it, and it does. Then remove the category filter. Choosing a category changed what you were reading, not what you wrote.

**C10**
> Save keeps this version. And when you are ready, Deploy asks you to confirm once. Confirming ends the round, and from then on your students use the chatbot you set up.

---

## ③Ⓢ Walkthrough · Slate (342단어 ≈ 132 s · 화면 263 s)

**S1**
> A student asks how to spell a word. The answer is one line.

**S2**
> Here is the same kind of question, and here the chatbot spells the word out letter by letter. Same question, two different answers. You want one way.

**S3**
> So you start an intent from the question you are reading. You describe the kind: a spelling, a synonym, how to use a term. And you write the rule: one or two lines, the word and one example. Then the tool compares every question in the log with your description.

**S4**
> The questions it collected are ordered by that first example. Reverse the order, and the top row answers a different question: of everything your words collected, which one is least like what you meant?

**S5**
> Some of these ask what a term means. Your words collected them too. You can rewrite the description, and you do. But rewriting moves the whole boundary. The definitions leave, and others you did not intend arrive. There is another way, so you return to the wording you had.

**S6**
> Instead you start an intent from the definition question itself. Because you started from a question the first intent already answers, the new one is placed above it. Above means it is read first. The definitions come here now, and the rest stays where it was.

**S7**
> And it answers the way you asked.

**S8**
> Then you read the questions that are left. Here a student asks the chatbot to make their own paragraph shorter, and the chatbot writes a shorter version. Pin it, and this time start an intent without choosing a question first.

**S9**
> The starter sets contain descriptions that are already written. You choose the one for this request, so you only write the rule: do not rewrite the text, show which sentences could be removed. Add it, and the question you pinned is answered by this intent.

**S10**
> Save keeps this version. And when you are ready, Deploy asks you to confirm once. Confirming ends the round, and from then on your students use the chatbot you set up.

---

## 대체 문장 (분기 대비 — 같은 세션에서 미리 녹음)

| 언제 | 대체할 곳 | 읽을 문장 |
|---|---|---|
| Ⓒ C5 — 문단 1 뒤에도 정의가 한 문단으로 나온다 | C5 전체 | *"But this one is not a word question. It asks when a phrase is used. And it now gets the same two lines. That is not the shape you wrote those lines for."* (앵커를 `P29 · 6` 로 바꾼다, `03_SCENARIO` §5-3) |
| 〃 — 같은 분기의 C6 | C6 후반 | *"It still comes back in two lines. Nothing in the document says what a usage question should get, so it follows the shape of the sentence that is there."* |
| 〃 — 같은 분기의 C7 | C7 첫 절 | *"So you say what a usage question should get: three or four sentences and one use of the phrase."* (뒤 두 절은 그대로) |
| 〃 — 같은 분기의 Ⓢ S6 | S6 첫 절 | *"Instead you start one from the usage question itself"* (나머지 그대로 — intent B의 When도 `03_SCENARIO` §5-3대로 바꾼다) |
| Ⓒ C6 — When을 좁혔더니 정의가 실제로 길어진다 | C6 후반 | *"Narrowing what the rule is about gives the definition its length back. But nothing yet says what a definition should get."* |
| Ⓢ S4/S5 — Furthest first 맨 위가 정의 질문이 아니다 | S4 마지막 절 + S5 첫 문장 | *"…what is least like what you meant? And searching the log for definitions shows the same thing. These are answered by the intent you just wrote."* |
| Ⓢ S5 — 수정 Apply가 아무것도 안 바꾼다 | S5 가운데 두 절 | *"You could fix that by rewriting the description. There is another way, so you leave the wording as it is."* (Restore 비트 생략) |
| Ⓢ S9 — Examples 3이 안 채워진다 | S9 마지막 절 | (그대로 읽고 예시 언급 없이 끝낸다 — VO는 예시를 지칭하지 않는다) |
| Ⓒ C9 — Shorten / Trim 목록이 비었다 | C9 첫 절 | *"The list can be narrowed to the requests to revise your own writing, and what that covers is spelled out for you…"* (상위 `Reviewing` 사용) |

---

## 검수 체크 (녹음 후)

- [ ] ③Ⓒ·③Ⓢ 길이 차 ≤ 20 s · ①Ⓒ·①Ⓢ 길이 차 ≤ 5 s(단어 수는 155 대 155로 같다)
- [ ] **VO 전체에 em dash 0개** — `grep -c "—"` 로 세되 한글 지시문은 빼고 `> ` 줄만 본다
- [ ] 글자까지 같은 **다섯 쌍**(①C1/S1 · ①C5/S5 · ③C1/S1 · ③C2/S2 · ③C10/S10)에 **같은 오디오 파일**을 썼다 — `tts/lines/shared-*.txt` 다섯이 그것이다
- [ ] `tts/export.py` 를 원고 수정 뒤에 다시 돌렸다(안 돌리면 오래된 대사를 읽게 된다)
- [ ] **③ 트랙에 화면 설명 문장 0회** — "the left column", "the middle column", "this button", "called", "labelled", "under the title" 검색해서 0. **예외 세 절(C9·S4·S9)만 허용**하고 그 이상 늘지 않았다
- [ ] **Ⓒ 트랙(①·③ 둘 다)에 "intent" 0회**
- [ ] ①의 **C1/S1**(프레임)과 **C5/S5**(사이클)가 글자까지 같다 · ③의 C10 과 S10 이 글자까지 같다
- [ ] ③의 C1·C2 와 S1·S2 가 글자까지 같다(관찰의 패리티) · C8·S8의 관찰 절도 같은 사실을 말한다
- [ ] **Ⓢ ③ 트랙이 "intent" 를 한 번은 말한다**(S3) — ① 덱이 붙인 이름을 ③이 한 번도 회수하지 않으면 대명사가 가리킬 것이 없어진다
- [ ] SCORE / baseline / treatment / control / Prolific / 연구팀 0회
- [ ] 비교급·가치어 0회 · 기준(몇 개, 좋은 rule) 0회 · 이름 뜻 설명 0회
- [ ] LLM이 붙인 제목·버전 이름을 읽지 않았다 · **숫자(103 제외)를 읽지 않았다**
- [ ] **구동사·은유 0회** — hands/folds/goes down/comes in/get back to/flip/step through/shape/edge/caught 로 검색해서 0
- [ ] "warning" 계열·"실수/잘못" 계열 0회 — 사실 진술만. 가치 부사(*just* = 고작, *only*, *simply*)도 0회 — 다만 **범위를 뜻하는 *just*("narrowed to just that kind")는 허용**한다
- [ ] ① 트랙에 화면 라벨 0회 — **대소문자 구분**해서 센다. 소문자 *setup* / *rules* / *deploy* 는 허용(`02_CONCEPT_SLIDES.md` 규율의 예외), 대문자 `Setup` / `RULES` / `Deploy` 와 "the Deploy button" 은 위반

# ③ 시나리오 — 데모 유저의 생각, 실측 재료, 타이핑 원문, 분기표

> 워크스루 두 편의 절반이 이 문서다. **§3의 응답문은 전부 2026-08-23 실측**이다 — 원본 응답은 DB에서, 규칙 적용 후 응답은 실제 데모 클론에서 그대로 받아 적었다. 이 문서를 읽고 나면 촬영자는 화면에 무엇이 나올지 이미 알고 있어야 한다.

---

## 1. 데모 유저

대학 글쓰기 수업 교수자. 과제 *Intelligent Machines* 의 학생–챗봇 로그(20명 · 103문항)를 처음 연다. 실무적이고, 눈에 띈 것을 고치고, 고친 것이 무슨 일을 했는지 확인하고 넘어간다. **개념은 이미 슬라이드에서 들었다** — 그래서 이 사람은 설명하지 않고 그냥 한다.

## 2. 생각의 흐름 (양 시스템 공통 — 갈라지는 것은 손뿐이다)

1. **읽는다.** 목록을 위에서 아래로 훑다가 `P19 · 2 how do you spell exaggeration` 을 연다. 답은 한 줄이다.
2. **관찰 ①.** 이런 질문이 더 있나 싶어 `spell` 로 검색한다. 7개가 남는다. `P29 · 3 spell egregious` 를 열어 본다 — 이번엔 `E-G-R-E-G-I-O-U-S`. **같은 종류인데 답의 모양이 다르다.** 하나로 맞추고 싶다.
3. **손 ①.** 단어 질문에 대한 규칙을 쓴다. (Clay: 문서에 문단 하나 / Slate: 그 질문에서 시작한 intent 하나)
4. **관찰 ② — 예상 못 한 데까지 걸렸다.** `P29 · 5 define social anxiety` 는 원래 한 문단짜리 설명을 받았는데, 지금은 단어 질문과 같은 두 줄로 나온다. **정의 질문까지 같이 짧아졌다.** 이건 원한 게 아니다.
5. **손 ② — 여기서 두 시스템이 갈라진다.**
   - **Clay**: 첫 문단의 When을 좁혀 본다 → **그래도 정의는 짧은 채다**(문서가 정의에 대해 아무 말도 안 했으니 앞 문단의 형식이 그대로 번진다). 그래서 **정의 질문에 무엇을 줄지를 문서에 직접 쓴다** — 문단 둘째. 두 문단 사이에 순서는 없다.
   - **Slate**: 그 intent의 When을 좁혀 Apply해 본다 → 정의는 빠졌지만 **엉뚱한 질문 셋이 들어왔다**. 설명을 고치면 경계가 통째로 움직인다. 그래서 **되돌리고**(옛 버전 → Restore), 대신 **정의 질문에서 새 intent를 파서 단어 intent 위에 놓는다.** 위가 먼저 읽히므로 정의는 정의 규칙이 답한다.
6. **관찰 ③.** 목록으로 돌아와 읽다가 `P29 · 8 Make this succinct "…"` 를 만난다. 학생이 자기 글을 줄여 달라고 했고 챗봇이 **그냥 줄여서 돌려줬다.** 이건 학생이 직접 해야 하는 판단이다.
7. **손 ③ — 준비된 분류를 각자의 자리에 쓴다.**
   - **Clay**: 가운데 열의 분류 피커에서 **Shorten / Trim** 을 골라 **목록을 그 종류만 남기고 읽는다.** 그러고 문서에 문단 셋째를 쓴다. (분류는 읽는 방법일 뿐 설정에 아무것도 들어가지 않는다.)
   - **Slate**: 맨땅에서 새 intent를 시작하고, **Starter sets에서 Shorten / Trim 을 골라 그 문장을 When 원문으로 가져온다.** Then만 직접 쓴다.
8. **마무리.** 간직할 지점을 남기고, Deploy가 한 번 묻는 것을 확인하고 끝낸다(**누르지 않는다**).

## 3. 재료 — 실측 (Run demo 클론, 2026-08-23)

### 3-1. 앵커 질문 네 개와 **배달된** 응답

| 역할 | 라벨 | 질문 | 학생이 실제로 받은 답 |
|---|---|---|---|
| 관찰 ① 앵커 | **P19 · 2** | how do you spell exaggeration | `The correct spelling is "exaggeration."` (39자) |
| 관찰 ① 대조 | **P29 · 3** | spell egregious | `E-G-R-E-G-I-O-U-S` (17자) |
| 관찰 ② 앵커 | **P29 · 5** | define social anxiety | `Social anxiety is a mental health condition characterized by intense fear, nervousness, and self-consciousness in social situations. People with social anxiety may feel excessively anxious about being judged by others…` (366자, 한 문단) |
| 관찰 ③ 앵커 | **P29 · 8** | Make this succinct "The increasing presence of automation…" `[OWN DRAFT · 40 words · 24%]` | `The rise of automation in traditionally human-dependent fields, such as customer service, may benefit those who struggle with communication, despite potential drawbacks for some users.` (줄인 재작성본) |

**같은 종류의 다른 답들**(검색·목록에서 눈에 들어오는 것들, 클릭은 안 해도 된다): `P1 · 5 convinience is that correct` → 한 줄 · `P29 · 4 is egregious spelt correctly` → 한 줄 · `P29 · 6 when is i.e. used` → 163자 · `P29 · 7 sysnonyms for "for example"` → 불릿 4개 · `P56 · 4 a word for understanding that something should be slow` → **453자 한 문단**.

**세 관찰이 P29 한 스레드에 모여 있다** (P29 · 3·4·5·6·7·8). 목록을 순서대로 읽는 동선이 실제로 성립한다.

### 3-2. 검색 `spell` — **7 of 103** (실측)

`P1 · 3 Can you please spell check the response?` · `P1 · 4 Please spell check this [OWN DRAFT · 313 words · 99%]…` · `P19 · 2` · `P29 · 3` · `P43 · 1` · `P43 · 2` · `P56 · 5`
→ 짧은 단어 질문 둘과 **초안 전체 교정 요청 다섯**이 섞여 나온다. 이 섞임 자체가 "무엇을 잡을지 문장으로 정해야 한다"의 재료다. (`P29 · 4 is egregious spelt correctly` 는 `spelt`라서 안 걸린다 — 검색은 글자 그대로다.)

### 3-3. 준비된 분류의 카운트 (실측, 모델 호출 0회)

Clay의 `Types` (로그 전체 기준):

| Planning **42** | Translating **46** | Reviewing **54** | Drafting **29** |
|---|---|---|---|
| Answer a Topic Question 35 · Provide Examples 10 · Factual Lookup 13 · Essay Structure 2 · Expand an Idea 15 · Recommend Topics 4 · Interpret the Prompt 9 · Compare Viewpoints 8 | Paragraph from Idea 19 · Complete Text 9 · Sentence from Idea 11 · Word Choice 12 | Proofread 19 · Spelling/Grammar Q&A 11 · Give Feedback 28 · **Shorten / Trim 8** · Rewrite to Spec 18 · Improve the Essay 33 · Check vs. Prompt 11 | Write Full Essay (from prompt) 12 · Write Conclusion 7 · Regenerate with Feedback 14 · Write a Section 23 · Write Full Essay (from idea) 6 · Resize Generated Text 9 · Write Introduction 3 |

합이 103을 넘는 것은 **한 질문이 여러 분류에 들 수 있기 때문**이다(준비된 판정이 분류마다 따로 붙는다). 정상이다.

`Shorten / Trim` 을 고르면 **`Shorten / Trim · 8 of 103`** 이 되고, 제목 아래 그 분류의 정의문이 찍히며 목록은 이 여덟 줄이 된다:
`P1 · 3` · `P1 · 4` · `P26 · 2` · **`P29 · 8`** · `P44 · 5 can the conclusion be longer` · `P44 · 6 a little shorter` · `P44 · 7 one paragraph` · `P50 · 1`
※ `P44 · 5`는 오히려 길게 해 달라는 요청이고 `P1 · 3·4`는 교정 요청이다. **분류가 완벽하지 않다는 것도 화면의 사실**이다 — 내레이션은 이 목록을 "이 종류의 요청들"이라고만 말하고 정확성을 주장하지 않는다.

Slate의 `Starter sets` 는 **같은 라이브러리**인데 카운트가 **그 자리가 가로챌 더미** 기준이라 더 작다. 실측(위 intent 둘이 이미 자리를 잡은 뒤, 남은 86개 기준): Reviewing 47 · **Shorten / Trim 7** · Spelling/Grammar Q&A 5 · Word Choice 4. **숫자는 읽지 않는다.**

### 3-4. Slate — Furthest first 맨 위 (실측)

단어 intent(16개)를 만들고 Examples 정렬을 `Furthest first`로 뒤집으면 맨 위가 이렇게 선다(**찍을 것은 1·2위 두 줄**):

1. **`P38 · 1`** Could you help me define "automation" in terms of machines replacing human jobs?
2. **`P29 · 5`** define social anxiety
3. `P42 · 6` historical data
4. `P5 · 3` Include how the passion is lost when we replace machines with humans

→ **정의 질문 두 개가 나란히 1·2위**다. 관찰 ②가 여기서 화면에 잡힌다.

## 4. 타이핑 원문 — 바꾸지 말 것

**같은 문장이 양 조건에 들어간다.** Clay에서는 한 문서의 세 문단으로, Slate에서는 세 intent의 When/Then으로. **이 재배치가 조작 그 자체다.**

### Ⓒ Clay — RULES 문서 하나, 세 문단 (문단 사이 빈 줄 하나)

| 사이클 | 덧붙이는 문단 | 누적 |
|---|---|---|
| 1 | `When a student asks for a word — a spelling, a synonym, or how to use a term — answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` | `180 / 8000` |
| 1′ (When 좁히기) | 첫 문단의 앞부분을 이렇게 **고쳐 쓴다**: `When a student asks how to spell a word, whether a spelling is right, or which word to use — answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` | `194 / 8000` |
| 2 | `When a student asks what a term means, answer in three or four sentences: a plain-language definition, then one example of how the term is used in writing.` | `351 / 8000` |
| 3 | `When a student asks the chatbot to shorten or cut something they wrote, do not hand back a rewritten version. Point at the two or three sentences that could go, say in one line why each is the weakest, and let the student make the cut.` | `588 / 8000` |

### Ⓢ Slate — intent 세 개

| intent | 자리 | WHEN A QUESTION… | THEN |
|---|---|---|---|
| **A** 단어 | `P19 · 2` 행의 `+` (Uncategorized 위) | `asks for a word — a spelling, a synonym, or how to use a term` | `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` |
| A′ (되돌릴 수정) | A의 When 끝에 덧붙임 | ` — not asking what a term means` | (그대로) |
| **B** 정의 | `P29 · 5` 행의 `+` (**A 위**) | `asks what a term means — a definition of a word or a concept` | `Give a two or three sentence definition in plain language, then one example of how the term is used in writing. Do not go longer.` |
| **C** 줄이기 | `+ New intent` (맨땅, Uncategorized 위) | **Starter sets → Shorten / Trim 이 채워 준다**: `asks the chatbot to shorten text or remove some content — for example, "Make this more concise — two sentences only.", "Shorten this paragraph: [paragraph]", or "Remove the part that mentions I'm a CS student."` | `Do not hand back a rewritten version. Point at the two or three sentences that could go, say in one line why each is the weakest, and let the student make the cut.` |

**제목은 치지 않는다.** A·B의 제목은 저장 뒤 시스템이 붙인다(실측 "Word spelling and usage", "Asking for Term Meaning" — 매런 다르다). **C만 예외로 사람이 정한 이름을 갖는다**: Starter set을 고르면 그 세트의 이름 `Shorten / Trim` 이 제목으로 들어간다. 이 사실은 화면에 보이지만 **내레이션은 이름을 읽지 않는다.**

## 5. 실측 결과와 분기표

### 5-1. Clay — Apply마다 무엇이 나왔나 (실측 응답 원문)

| 시점 | 연 질문 | 나온 답 | 성립 조건 / 안 맞으면 |
|---|---|---|---|
| 문단 1 Apply 후 | `P19 · 2` | `exaggeration — "She was exaggerating when she said the hill was the tallest in the world."` | 한두 줄이면 성립. 문단이 나오면 문구를 손보고 다시 Apply — 그 자체가 사이클이다 |
| 〃 | `P29 · 5` | `social anxiety: intense fear or worry about being judged or embarrassed in social situations.` / `Example: She felt social anxiety before speaking in class.` | **정의가 짧아지면 성립**(관찰 ②). 안 짧아지면 §5-3 대체 경로 |
| 문단 1′(When 좁힘) Apply 후 | `P29 · 5` | `Social anxiety is a strong fear of being judged, embarrassed, or watched by other people in social situations.` / `Example: She felt social anxiety before speaking in front of the class.` | **여전히 두 줄**이면 성립 — "좁히는 것만으로는 돌아오지 않는다" |
| 문단 2 Apply 후 | `P29 · 5` | `Social anxiety is a strong fear of being judged, embarrassed, or watched by other people in social situations. It can make things like talking, meeting new people, or speaking in class feel very stressful. In writing, you might say, "Her social anxiety made it hard for her to attend parties."` | 세 문장 + 용례면 성립 |
| 〃 | `P19 · 2` (핀) | `Exaggeration.` / `"The story was an exaggeration of what really happened."` | **여전히 한두 줄**이면 성립 — 문단 둘이 서로를 안 밟는다 |
| 문단 3 Apply 후 | `P29 · 8` | `Cut "while likely detrimental to some users' communication" — it's the most awkward and least direct part.` / `Cut "(though this can also be viewed as a downside)" — it repeats the idea and weakens the sentence.` | 재작성본이 아니라 **무엇을 자를지**가 나오면 성립 |

### 5-2. Slate — Add / Apply마다 무엇이 나왔나 (실측)

| 시점 | 화면 | 성립 조건 / 안 맞으면 |
|---|---|---|
| intent A `Add` 직후 | 리스트 헤더 *working out where questions go* → 행마다 소속 칩. 카드가 저절로 열려 `Examples 1`(시드 `P19 · 2`) · `[Closest first \| Furthest first]` · `Generate examples`. 제목이 몇 초 뒤 저절로. 최종 **A 16 · Uncategorized 87** | 5개 이상 잡으면 성립. 미만이면 When을 §4대로 정확히 다시 쓰고 Apply |
| `Furthest first` | 맨 위 `P38 · 1` → `P29 · 5`(§3-4) | **정의 질문이 1·2위**면 성립. 아니면 §5-3 |
| A′ Apply 후 | **A 16 → 15**, 소속 칩 재정착, 트리 행에 `unsaved` 칩, `VERSION HISTORY 2`: `v2 · {이름} · 15 · unsaved` / `v1 · {이름} · 16 · 4m ago`. 정의 둘은 빠졌지만 `P11 · 8` · `P30 · 2` · `P26 · 9` 가 새로 들어왔다 | **엉뚱한 게 들어오면 성립**(그게 되돌릴 이유다). 아무것도 안 들어오면 내레이션 대체문(`06_NARRATION` 대체표) |
| `v1` 행 클릭 | 보드 전체 읽기 전용 — Undo/Redo·Apply/Save가 사라지고 `Restore` · `Latest` 등장. `v1 … showing` / `v2 … unsaved` | 항상 |
| `Restore` | 확인 줄 `Back to setup 1, dropping what came after?` + `Restore` / `Cancel` → 확인하면 **v2가 사라지고** `VERSION HISTORY 1`, A는 다시 16 | 항상. **v2가 남아 있으면 촬영 중단**(버그) |
| `P29 · 5` 행의 `+` | 툴팁이 `Start an intent — read before “{A의 제목}”`, 폼의 위치 문장이 *…so any of its **{A의 수}** questions can come here, and anything below it this also describes…* | **문장 형태는 항상**(결정론). 제목은 LLM이, 숫자는 판정이 정하므로 **런마다 다르다 — 대조하지 않는다**(실측은 "Word spelling and usage" / 16이었다) |
| intent B `Add` 후 | **B 8**(A 위) · **A 16 → 9** · **Uncategorized 86**. B의 목록에 `P29 · 1` · `P56 · 4` 같은 단어 선택 질문도 딸려 온다 | 경계가 움직이는 것은 성립 — "위가 먼저 읽힌다"의 증거다. 내레이션은 숫자를 안 읽는다 |
| `P29 · 5` 열기 | `This reply is under [v1 · {이름}]`, 접힌 상자에 **B의 Then**, 답은 두 문장 + `Example: …` | 성립 |
| `Uncategorized` 선택 | `Uncategorized 86 of 103`, 편집기는 `THEN` 만(When 없음) + `Reuse a rule`, 히스토리 `v0 · Original (as delivered) · showing` | 항상 |
| `P29 · 8` 열기 | **`This reply is the one that was delivered.`** — 드롭다운이 **없다**(아직 아무 설정도 이 질문을 답한 적이 없다) | 항상 |
| `Starter sets → Shorten / Trim` | WHEN이 그 세트의 문장으로 **자동으로 채워진다**(§4 C행), 제목도 세트 이름을 받는다 | 항상(모델 호출 0회) |
| intent C `Add` 후 | 제목이 **`Shorten / Trim`**, **C 7** · **Uncategorized 79**, 핀 행의 칩이 `● Shorten / Trim` 로, `Examples 3`이 **모델이 쓴 가상 질문 3개**(이탤릭)로 채워지고 헤더 버튼이 `Update examples` | Examples가 안 뜨면 예시 0개 — 다른 행을 눌렀다 다시 선택. 카드는 떴는데 비면 `Generate examples`(*Writing…* 약 15 s) |
| `P29 · 8` 열기 | `The weakest spots are:` + 자를 후보 세 개와 각각의 이유 | 재작성본이 아니면 성립 |

### 5-3. 대체 경로

| 안 맞는 것 | 대체 |
|---|---|
| Clay: 문단 1 Apply 뒤에도 정의가 한 문단으로 나온다 | 관찰 ②를 **`P29 · 6 when is i.e. used`** 로 바꾼다(용법 질문 — 같은 규칙에 더 확실히 걸린다). 비트 구조는 그대로. **단, 문단 2의 When만 `When a student asks how a term or phrase is used` 로 바꾸고, C6·C7 VO의 "a definition" 을 "a usage question" 으로 바꾼다** — 안 그러면 문단 2가 새 앵커를 안 덮는다. Slate도 intent B의 When을 같은 방향으로 바꾼다(패리티) |
| Slate: Furthest first 맨 위가 정의 질문이 아니다 | 검색창에 `define` 을 쳐서 `P29 · 5` / `P38 · 1` 을 직접 부르고, **그 행의 소속 칩이 단어 intent**임을 1–2초 짚는다. Examples 정렬 비트는 그대로 두되 "가장 안 닮은 것부터"만 보여 주고 넘어간다 |
| Slate: A′ Apply가 아무것도 안 바꾼다 | A′를 건너뛰고 곧장 Restore 없이 B 생성으로 간다. 대체 VO 사용(`06_NARRATION`) |
| Clay: 분류를 골랐는데 목록이 비었다 | 하위 `Shorten / Trim` 대신 상위 **`Reviewing`** 을 고른다 |
| 양쪽: Save가 안 눌린다 | 버그가 아니다 — 상자에 적용 안 된 편집이 있다. **순서는 언제나 타이핑 → Apply → Save** |
| 양쪽: Deploy 아래 앰버 상자가 뜬다 | 촬영 중단하고 버그로 처리 |

## 6. 비트별 학습 목표 (내레이션 체크리스트)

층이 셋이므로 **무엇을 어디서 가르치는지**가 고정된다. 워크스루가 아래 "①·② 몫" 칸의 내용을 말하면 그건 대본 위반이다.

| 알아야 할 것 | 가르치는 층 |
|---|---|
| 설정의 모양(문서 하나 / When–Then 여러 개), 한 질문에 무엇이 걸리는가, 순서 의미론, 사이클과 Deploy | **① Concept** |
| 세 열, 행 읽는 법, 검색, 대화 뷰어와 배달본 한 줄, 붙여넣기 접힘, 핀, 경과 칩, Deploy 버튼의 위치 | **② Getting around** |
| 답이 제각각이라는 관찰 · 규칙을 쓰는 손 · Apply 뒤 무엇을 보고 확인하는가 · 의도 밖까지 걸렸을 때 각 시스템에서 무엇을 하는가 · 준비된 분류를 각자 어디에 쓰는가 | **③ Walkthrough** |

# ① Concept — 개념 슬라이드 두 덱

> 슬라이드 + 보이스오버. **화면 녹화가 아니다.** 목표 **각 66 s**(무음 타이틀 3 s + VO 155단어). 낭독을 느린 쪽(155 단어/분)으로 잡으면 VO가 60 s라 60 s 덱에는 안 들어간다. 두 덱 길이 차 **≤ 5 s**(단어 수는 155 대 155로 같다).
>
> 이 층이 존재하는 이유: 워크스루에서 개념 설명을 걷어내기 위해서다. 여기서 말하지 않은 개념은 참가자가 영영 못 듣는다 — 그러니 **여기서 다 말하고, 여기서만 말한다.**
>
> 두 덱은 **같은 템플릿·같은 장 수·같은 순서**다. 배경 흰색, 본문 검정, 강조 한 색(덱마다 다른 색을 쓰지 않는다 — 시스템에 색 인상을 주지 않는다), 화면 스크린샷 **금지**(그건 ②의 몫), 애니메이션은 도형이 순서대로 등장하는 정도.
>
> **열 장 다 이미 그려져 있다** — 소스는 `slides/build.py` → `slides/slides.html`, 렌더는 **`slides/png/*.png`(3840×2160)**. 만드는 법과 규율 점검은 `slides/README.md`. 아래 각 장의 **화면** 항목 끝에 대응 파일명을 적어 두었다. 문구를 고치면 **이 문서를 먼저 고치고** `slides/build.py` 를 따라 고친 뒤 다시 렌더한다.

---

> **파트 카드 세 장은 이 덱 바깥에도 쓰인다.** 합친 영상은 층이 셋이라 이음매가 필요하다 — 개념 앞에 `1-how-it-works`, Getting around 앞에 `2-getting-around`, 워크스루 앞에 `3-worked-example`. 첫 장이 곧 이 덱의 C0/S0이고, 나머지 둘은 편집에서 각 층 앞에 끼운다. 흰 배경·강조색 짧은 선·작은 시스템 이름·큰 파트 이름, 그게 전부다. **번호도 진행 막대도 없다** — 블록 1은 세 파트, 블록 2는 두 파트라 카운터를 달면 같은 층에 두 장이 필요해진다.

## 규율 — 슬라이드가 하지 않는 것

- **화면 라벨을 쓰지 않는다.** `Apply` · `Version history` · `Starter sets` · `Types` · `Kept in view` 같은 글자가 슬라이드에 있으면 안 된다. 개념만 말하고 이름은 ②·③이 화면에서 준다.
  - **예외는 소문자 보통명사·동사뿐이다**: *setup* · *rules* · *deploy* · *when* · *then* · *intent*(Slate 덱에서만 — Clay 덱은 여전히 0회). 개념 자체에 이름이 필요해서 쓰는 것이고, 대문자 라벨(`Setup` · `RULES` · `Deploy` · `When a question…` · `Then`)로 쓰거나 "the Deploy button" 처럼 컨트롤을 가리키면 그 순간 위반이다. **슬라이드 그래픽의 글자도 같은 규칙을 받는다** — 카드 안 라벨도 소문자다. 녹음 후 린트는 **대소문자를 구분해서** 돌린다.
- **스크린샷·목업 금지.** 도형과 글자만. 실제 화면을 보여 주는 순간 두 덱의 표면적 차이가 슬라이드로 새어 나온다.
- **비교 금지.** "Clay와 달리…", "이쪽이 더 …" 류 0회. 각 덱은 상대 시스템의 존재를 모른다.
- **이름 뜻 금지.** Clay/Slate가 왜 그 이름인지 말하지 않는다.
- **기준 금지.** "보통 3–5개를 만듭니다" 류 0회.
- **Clay 덱에 "intent" 0회.**
- 마지막 장(공통 문장)은 **두 덱이 글자까지 같다.**

---

## Ⓒ Clay — 5장 + 타이틀

### C0 · 파트 카드 (0:00–0:03) — 무음

흰 배경. 강조색 짧은 선 아래 작게 `CLAY`, 그 아래 큰 글씨 **How it works**. 영상의 첫 프레임이자 이 덱의 첫 장. → `slides/png/clay-part-1-how-it-works.png`

### C1 · 누가 무엇을 하는가 (0:03–0:21 · 18 s) — **양 덱 공통, 글자까지 동일**

- **화면**: 왼쪽부터 사람 하나(당신) → 문서 → 말풍선(챗봇) → 학생 다섯. 앞 두 화살표는 한 방향, 챗봇과 학생 사이만 **양방향**이다. 캡션 **"you brief it. they talk to it."** → `slides/png/clay-1-brief.png`(= `slate-1-brief.png`, 같은 그림)
- **VO** (46단어, **Slate와 글자까지 동일**):
  > *"Students in this course wrote with a chatbot. You do not answer their questions. You write the instructions for the chatbot that answers them, the way you would instruct a teaching assistant who works without you in the room. What you write decides what students receive."*
- **메모**: 말풍선이지 얼굴이 아니다. 눈·입을 그리면 이 도구에 없는 인격을 약속하게 되고, 이 덱의 일은 그 반대다. 마지막 관계절(*who will answer without you in the room*)이 비유의 안전장치다 — 되물을 사람이 없으니 쓴 문장이 혼자 서야 한다는 사실이고, 바로 다음 장이 그 제약을 시스템별로 못 박는다.

### C2 · 브리핑은 문서 하나다 (0:21–0:33 · 12 s)

- **화면**: 가운데에 세로로 긴 흰 상자 하나, 안에 회색 줄 열한 개. 캡션 **"one document"**. → `slides/png/clay-2-document.png`
- **VO** (30단어):
  > *"In Clay, your instructions are a single document, written in your own words. There are no forms and no fields. You write sentences, and those sentences are the whole setup."*

### C3 · 무엇을 묻든 브리핑 전체가 걸린다 (0:33–0:47 · 14 s)

- **화면**: 왼쪽 문서에서 화살표가 나가고, 오른쪽에 **점 103개**가 격자로 깔린다. 격자 전체를 강조색 테두리가 감싼다. 캡션 **"every question"**. → `slides/png/clay-3-every-question.png`
- **VO** (32단어):
  > *"Whatever a student asks, the chatbot reads your whole document. Not a selected part of it. The whole document, every time. Nothing narrows it to the kind of question that has arrived."*

### C4 · 그래서 한 문단이 전부에 걸린다 (0:47–1:01 · 14 s)

- **화면**: 문서 안의 줄 하나가 강조색이 되고, 그 줄에서 나온 얇은 선 열 가닥이 격자의 **흩어진 점들**에 닿는다. 캡션 **"a rule you write for one kind of question is read for all of them"**. → `slides/png/clay-4-read-for-all.png`
- **VO** (34단어):
  > *"So a paragraph you write for one kind of question is also read when a different kind of question arrives. Nothing selects which paragraph applies. All of them are present, all of the time."*

### C5 · 사이클 (1:01–1:21 · 20 s) — 50단어라 가장 긴 장이다

- **화면**: 가로로 네 단계 — **write → see what it answers → keep a point → deploy, once**. 앞 세 단계 아래로 되돌아오는 화살표가 있고, 네 번째만 강조색·자물쇠로 떨어져 있다. **그 아래로 화살표 하나가 내려가 학생 셋에게 닿는다** — 루프가 손을 놓는 자리다. 캡션 없음. → `slides/png/clay-5-loop.png`
- **VO** (50단어, **Slate와 글자까지 동일**):
  > *"You work in a loop. Write, try it, and read the answer it now gives to a question students already asked. Save any version you might want later. When you are ready, you deploy. That ends the round, and from then on your students use the chatbot you set up."*

**Clay 덱 VO 192단어 ≈ 70–74 s · 덱 전체 81 s**(무음 타이틀 3 s + 여백).

---

## Ⓢ Slate — 5장 + 타이틀

### S0 · 파트 카드 (0:00–0:03) — 무음

흰 배경. 작게 `SLATE`, 그 아래 **How it works**. → `slides/png/slate-part-1-how-it-works.png`

### S1 · 누가 무엇을 하는가 (0:03–0:21 · 18 s) — **Clay C1과 같은 그림·같은 문장**

- **화면**: C1과 동일. → `slides/png/slate-1-brief.png`
- **VO** (46단어, **Clay와 글자까지 동일**):
  > *"Students in this course wrote with a chatbot. You do not answer their questions. You write the instructions for the chatbot that answers them, the way you would instruct a teaching assistant who works without you in the room. What you write decides what students receive."*

### S2 · 브리핑은 when–then 여러 개다 (0:21–0:35 · 14 s)

- **화면**: 세로로 쌓인 카드 세 장. 각 카드가 위아래 두 칸으로 갈라져 있고 위 칸에 **when**, 아래 칸에 **then**(소문자 — 화면 라벨이 아니라 개념어다). 캡션 **"several intents"**. → `slides/png/slate-2-intents.png`
- **VO** (33단어):
  > *"In Slate, your instructions are a list of intents. An intent has two parts: a description of one kind of question, and the rule for answering that kind. A when, and a then."*

### S3 · 위에서부터, 처음 걸린 하나 (0:35–0:51 · 16 s)

- **화면**: 왼쪽에서 점선이 들어와 첫째 카드의 **when 을 짚고**(화살표가 카드 앞에서 멈춘다) 아래로 내려가, 둘째 카드의 when 자리에 점이 **앉는다**. 둘째 카드만 강조색, 셋째 카드는 흐리다. 캡션 **"the first one that matches"**. → `slides/png/slate-3-first-match.png`
- **VO** (39단어):
  > *"Before it answers, the chatbot checks your list from top to bottom. Each question belongs to exactly one intent: the first description that matches it. The rest are not used, and the rule of that intent writes the reply."*
- **메모**: 이 장이 C1의 TA 비유를 제한하는 자리다. 사람 조교는 첫 매치로 일하지 않는다 — 그래서 여기서는 비유를 쓰지 않고 **기계적 사실만** 말한다.

### S4 · 위의 어디에도 속하지 않은 질문 (0:51–1:05 · 14 s)

- **화면**: 같은 스택 아래에 회색 카드가 한 장 더 붙는다 — 위 칸은 **점선만 있고 비어 있고**, 아래 칸에만 **then** 이 있다. 점선이 세 카드의 when 을 차례로 짚고 지나 그 카드의 then 자리에 점이 앉는다. 캡션 **"whatever is left"**. → `slides/png/slate-4-leftover.png`
- **메모**: 문장의 주어가 *설명이 없다*가 아니라 **위의 어느 intent에도 속하지 않은 질문들**이다. 보드에서 이 자리의 이름은 `Uncategorized` 지만 슬라이드는 화면 라벨을 부르지 않는다 — 소속으로만 말한다.
- **VO** (31단어):
  > *"The last place in the list holds every question that did not belong to any intent above it. It has a rule but no description, so it answers everything that remains."*

### S5 · 사이클 (1:05–1:25 · 20 s) — 50단어라 가장 긴 장이다

- **화면**: Clay C5와 **같은 그림, 같은 캡션**(파일도 바이트까지 같다). → `slides/png/slate-5-loop.png`
- **VO** (50단어, **Clay와 글자까지 동일**):
  > *"You work in a loop. Write, try it, and read the answer it now gives to a question students already asked. Save any version you might want later. When you are ready, you deploy. That ends the round, and from then on your students use the chatbot you set up."*

**Slate 덱 VO 199단어 ≈ 72–77 s · 덱 전체 85 s**(무음 타이틀 3 s + 여백).

---

## 두 덱 대조 (녹음 전 체크)

| 장 | Clay | Slate | 단어 |
|---|---|---|---|
| 1 | **누가 무엇을 하는가(동일 그림·동일 문장)** | 〃 | 46 / 46 |
| 2 | 지시는 문서 하나 | 지시는 when–then 여러 개 | 30 / 33 |
| 3 | 무엇을 묻든 문서 전체를 읽는다 | 위에서부터, 처음 걸린 하나 | 32 / 39 |
| 4 | 한 문단이 전부에 걸린다 | 위 어디에도 속하지 않은 것은 맨 아래로 | 34 / 31 |
| 5 | **사이클(동일 문장, 배포 뒤 학생에게)** | 〃 | 50 / 50 |
| | | **합계** | **192 / 199** |

- [ ] 두 덱에 화면 라벨 0회(**대소문자 구분** — 소문자 예외는 위 규율 참조)
- [ ] 렌더가 최신이다 — `slides/build.py` 를 고쳤으면 `python3 build.py && node render.mjs` 를 다시 돌렸다
- [ ] **1장과 5장이 두 덱에서 글자까지 같다** — 오디오도 한 번만 만들어 두 덱에 같은 파일을 쓴다
- [ ] 스크린샷 0장
- [ ] Clay 트랙에 "intent" 0회
- [ ] 비교급·가치어 0회 · 기준 0회 · 이름 뜻 0회
- [ ] 파트 카드 세 장이 두 시스템에 다 있다(`*-part-1/2/3`)
- [ ] 길이 차 ≤ 5 s — Clay **81 s**(3+18+12+14+14+20) · Slate **85 s**(3+18+14+16+14+20)
- [ ] VO에 em dash 0개(`06_NARRATION` TTS 규율)

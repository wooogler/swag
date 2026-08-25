# 데모 영상 기획 v3 — 개념 슬라이드 + 워크스루 (Simple)

> 작성 2026-08-23. **Simple family(`simple_score` = Slate / `simple_baseline` = Clay) 전용.** 시스템 사양의 진실은 `docs/SCORE_SIMPLE_DESIGN.md`이고, **화면의 진실은 화면**이다 — 이 문서의 라벨·수치·응답문은 전부 2026-08-23에 `Run demo · Simple Baseline`(clone `28764ad8…`)과 `Run demo · Simple SCORE`(clone `497c21bd…`)를 끝까지 돌려 실측했다.
>
> **v2(`docs/demo-video-simple/`)와 무엇이 다른가.** v2는 한 편의 영상이 개념·UI·조작을 다 가르쳤다. v3은 그것을 **세 층으로 쪼갠다**: ① 개념은 슬라이드가, ② 공통 셸 UI는 기존 영상이, ③ 워크스루는 **오직 사용자의 생각과 그에 따른 손**만. 워크스루 내레이션에서 "이 버튼은 무엇이다" 류의 설명이 사라진다 — 그건 ①·②가 이미 했다.
>
> v2 문서는 지우지 않는다. ⓐ Getting around 영상 두 편은 **그대로 재사용**하므로 `docs/demo-video-simple/03_SCRIPT_A_COMMON.md`가 계속 그 편의 진실이다. v3이 대체하는 것은 v2의 `04_SCRIPT_B_SLATE.md` / `05_SCRIPT_C_CLAY.md`뿐이다.
>
> 이 폴더: `01_PLAN`(이 문서) → `02_CONCEPT_SLIDES`(개념 덱 두 개) → `03_SCENARIO`(데모 유저의 생각·실측 재료·타이핑 원문·분기표) → `04_SCRIPT_CLAY` / `05_SCRIPT_SLATE`(워크스루 샷리스트) → `06_NARRATION`(녹음 원고) → `README`(촬영 런북). 참고 화면은 `shots/`.

---

## 1. 세 층 구조

| 층 | 무엇 | 매체 | 편수 |
|---|---|---|---|
| ① **Concept** | 그 시스템이 무엇을 어떻게 하는 물건인가 | **슬라이드 + 보이스오버** (화면 녹화 아님) | 2 (Clay / Slate) |
| ② **Getting around** | 세 열·검색·대화 뷰어·핀·헤더 — **양 조건 공통 셸** | 화면 녹화 (**그림은 기존 영상 그대로, 소리는 새로**) | 2 테이크(보드별), VO 1 |
| ③ **Walkthrough** | 한 교수자가 로그를 읽고 설정을 고쳐 나가는 한 사이클 | 화면 녹화 (**전면 재촬영**) | 2 (Clay / Slate) |

층을 쪼갠 이유는 하나다. **워크스루에서 UI를 가르치지 않기로 했기 때문이다.** v2의 워크스루는 "이 열은 Setup이고, 이 버튼은 Apply이고…"를 조작과 섞어 말했다. v3은 그 문장을 전부 ①·②로 옮긴다. 남은 워크스루는 이렇게만 말한다 — *무엇이 눈에 띄었나 → 그래서 무엇을 했나 → 무엇이 달라졌나.*

### 1-1. 재생 순서와 배선 [2026-08-23 구현 완료]

요청한 순서는 **Concept → 기본 UI → Walkthrough** 다. 세그먼트 목록으로는 개념을 공통 세그먼트 **앞에** 둘 수 없어서(슬롯이 두 개뿐이다), **영상을 밖에서 합치고 하니스는 블록당 하나만 재생하도록** 바꿨다.

**네 파일이 전부다.** 축은 블록(1·2) × 시스템(Clay·Slate) 둘뿐이고, 참가자의 순서는 "어느 시스템이 블록 1에 오느냐"로 이미 표현된다 — Clay 먼저인 사람은 `block1-clay` → `block2-slate`, Slate 먼저인 사람은 `block1-slate` → `block2-clay`.

| 파일 | 안에 든 것 | 환경변수 |
|---|---|---|
| `block1-clay.mp4` | Clay 개념 → Getting around(Clay 보드) → Clay 워크스루 | `NEXT_PUBLIC_STUDY_DEMO_BLOCK1_SIMPLE_BASELINE` |
| `block1-slate.mp4` | Slate 개념 → Getting around(Slate 보드) → Slate 워크스루 | `NEXT_PUBLIC_STUDY_DEMO_BLOCK1_SIMPLE_SCORE` |
| `block2-clay.mp4` | Clay 개념 → Clay 워크스루 | `NEXT_PUBLIC_STUDY_DEMO_BLOCK2_SIMPLE_BASELINE` |
| `block2-slate.mp4` | Slate 개념 → Slate 워크스루 | `NEXT_PUBLIC_STUDY_DEMO_BLOCK2_SIMPLE_SCORE` |

**넣는 것은 유튜브 링크 그대로면 된다.** watch URL · Share 버튼의 `youtu.be` 링크(`?si=` 붙어 있어도 된다) · `/embed/` · `/shorts/` · 열한 글자 id — 전부 받는다(`youtubeId`, `src/lib/study/config.ts`). 넣고 **서버를 재시작**한다.

**설정이 비어 있으면** 그 블록의 자리는 **BLOCK 변수 이름을 대며** 비어 있다고 말한다. **값은 있는데 id를 못 읽으면** 앰버 상자로 그 값을 되비추며 말한다 — 예전에는 이 경우에 죽은 플레이어가 떠서 "영상이 깨졌다"로 보였다(§8 참조).

**옛 세그먼트 경로는 살아 있다.** BLOCK 변수를 비워 두면 `demoSegmentsFor` 가 예전대로 블록 1에 두 개, 블록 2에 하나를 돌려준다 — 풀 버전(`score`/`baseline`)의 기존 id들이 그대로 동작한다.

⚠ **"기본 UI 설명은 Clay에 넣고 Slate에선 건너뛴다"는 조건이 아니라 블록에 걸린다.** Clay에만 걸면 Slate가 첫 블록인 참가자 절반이 셸을 못 배운 채 25분을 시작한다. 네 파일 구성이 이미 그렇게 되어 있다 — 블록 1 두 파일에만 Getting around가 들어간다.

### 1-2. 길이 — 예산을 넘는다, 알고 넘긴다

**타이핑 모델(대본의 시계는 전부 여기서 나온다).** 실속도 **300자/분 = 5자/초**(≈60 wpm — 화면에서 읽히는 속도), 램프 **2× = 10자/초**. **첫 타이핑 구간만 실속도, 그다음부터 전부 램프.** 램프 중에도 커서는 계속 보인다.

| 세그먼트 | 컷·램프 전 | **대본 기준** | VO |
|---|---|---|---|
| ① Concept (각) | 81–85 s | **81 s(Ⓒ) / 85 s(Ⓢ)** | 192 / 199 단어 (VO 70–77 s + 무음 타이틀 3 s + 여백) |
| ② Getting around | 75 s | **82 s(소리 기준)** | 213 단어 (그림은 그대로, VO는 TTS 개정판 — `06_NARRATION` ②ⓐ). **그림 75 s보다 7 s 길다** |
| ③ Clay Walkthrough | ~355 s | **265 s (4:25)** | 328 단어 |
| ③ Slate Walkthrough | ~330 s | **263 s (4:23)** | 342 단어 |

→ **블록 1 ≈ 7:08(Clay 먼저) / 7:10(Slate 먼저) · 블록 2 ≈ 5:46 / 5:48.**

v2 설계 예산은 블록 1 = 4분, 블록 2 = 3분이었고 **v2도 이미 4:15였다**(75 + 180). v3이 더한 ~2:53은 세 가지 값이다:

- **+1:21 = 개념 층(①).** 빼면 워크스루가 개념을 다시 설명해야 한다 — v2로 돌아가는 것이다. 다섯 장 중 첫 장(누가 무엇을 하는가)은 **양 덱 동일**이라 조건 차를 만들지 않는다.
- **+0:50 = 세 번째 관찰.** 관찰이 둘에서 셋으로 늘었다.
- **+0:35 = 정직해진 타이핑 시계.** v2의 180 s 추정은 588자를 치는 시간을 실제로 계산하지 않았다. 이 판에서는 넣었다.

**흡수 순서(위에서부터, 양 조건에 동일하게 적용).** 1–3은 이미 위 표의 "대본 기준"에 반영돼 있다:

1. **첫 구간을 뺀 모든 타이핑 구간을 2× 램프.** Clay는 네 구간(C4·C6·C7·C9) 중 C4만, Slate는 여섯 구간(S3 WHEN·S3 THEN·S5·S6 WHEN·S6 THEN·S9) 중 S3 WHEN만 실속도다. → 양쪽 ~60 s
2. **Slate의 첫 판정(S3)만 살리고 나머지 셋(S5·S6·S9)은 ≤3 s로 컷.** S3도 실측 ~30 s를 ≤10 s로 압축한다 — 판정이 도는 것을 보는 게 그 비트의 내용이라 0으로 만들지는 않는다. → ~35 s
3. **응답 스트리밍은 첫 두 번만 살리고 이후 ≤3 s.** → ~30 s
4. (미반영) **마지막 "확인" 클릭 하나씩** — Clay C7의 두 번째 핀 확인, Slate S7 — 을 뺀다. → 양쪽 ~10 s

**그래도 4분에는 못 맞춘다.** 선택지는 넷이고 **결정은 연구자 몫이다**:

| 선택 | 블록 1 | 잃는 것 |
|---|---|---|
| **A. 예산을 7분으로 옮긴다** (권장) | ~7:08 | 없음. 대신 25분 블록의 ~4 %가 영상이 된다 |
| **D. 타이핑 원문을 줄인다** (A와 함께 쓸 수 있다) | ~6:23 | 없음 — 다만 **문장이 바뀌면 응답이 바뀐다.** `03_SCENARIO` §5의 실측 표를 다시 채워야 한다. Clay 588자 → ~330자, Slate 539자 → ~300자면 양쪽 ~45 s가 준다 |
| B. 세 번째 관찰(줄이기)을 뺀다 | ~5:52 | 준비된 분류를 두 시스템이 **서로 다른 자리**에 쓰는 것을 보여 줄 자리가 없어진다 |
| C. 두 번째 관찰(정의)을 뺀다 | ~5:47 | **두 시스템의 차이가 화면에서 사라진다.** 이 개편의 이유가 없어진다 — 권하지 않는다 |

---

## 2. 각 층이 말하는 것과 말하지 않는 것

### ① Concept — 개념만. 화면 라벨을 부르지 않는다.

슬라이드는 **버튼 이름을 하나도 말하지 않는다.** "왼쪽 열", "Apply", "Version history" 같은 말이 슬라이드에 들어가면 ②가 할 일을 뺏고, 두 덱의 길이가 시스템의 표면적 차이만큼 벌어진다. 슬라이드가 말하는 것은 딱 이것뿐이다:

| | Clay | Slate |
|---|---|---|
| **누가 무엇을 하는가** | **두 덱 동일**: 학생이 이미 물은 질문들이고, 답하는 것은 챗봇이며, 그 챗봇을 브리핑하는 것이 보는 사람이다. *당신이 없는 자리에서 답할 조교*라는 한정이 비유의 안전장치다 | 〃(같은 그림·같은 문장) |
| 설정의 모양 | **규칙 문서 하나** | **When–Then 짝 여러 개** |
| 한 질문에 걸리는 것 | 문서 **전체**가 늘 걸린다 | **정확히 하나**의 intent |
| 고르는 방법 | 고르지 않는다 — 전부 함께 읽힌다 | **위에서부터** 판별, **처음 걸린 것**의 Then |
| 안 걸린 질문 | 없다(문서는 늘 있다) | **목록 맨 아래 자리**의 Then (라벨 이름은 슬라이드에서 부르지 않는다) |
| 공통 | 쓴다 → 지금 판으로 확인한다 → 간직할 지점을 남긴다 → 마지막에 한 번 배포하고 끝낸다 | 〃 (**같은 문장**) |

### ② Getting around — 그림은 그대로, 소리는 다시

샷리스트는 `docs/demo-video-simple/03_SCRIPT_A_COMMON.md`가 여전히 진실이고 **재촬영하지 않는다**. 다만 **내레이션은 다시 만든다** — 나머지 네 트랙과 같은 목소리로 나와야 네 층이 한 사람으로 들리기 때문이고, 원고는 v3의 `06_NARRATION` §②ⓐ(em dash를 없앤 TTS 개정판)다. 204단어라 느린 낭독에서 79 s이므로 75 s 그림을 1–2 s 늘리거나 낭독을 붙인다. 다만 v3에서 한 가지가 달라진다: ⓐ가 이제 **셸의 유일한 선생**이다(v2에서는 워크스루가 셸을 다시 설명해 줬다). 그래서 **핀(Kept in view)·검색·뷰어의 배달본 한 줄은 ⓐ에서 반드시 살아 있어야 한다** — 워크스루는 이 셋을 설명 없이 쓴다.

### ③ Walkthrough — 생각과 손만

문장의 골격이 고정된다. 비트마다 **① 무엇이 눈에 띄었나(관찰) → ② 그래서 무엇을 했나(행동) → ③ 무엇이 달라졌나(확인)**, 그 이상은 말하지 않는다. 특히:

- **금지**: "왼쪽 열은 …입니다", "이 버튼을 누르면 …", "…라고 부릅니다" (전부 ①·②의 몫)
- **허용**: "이 답이 저 답과 다르다", "그래서 이렇게 썼다", "이제 이렇게 나온다"
- **예외 셋**: ②ⓐ가 가르치는 것은 셸까지다. **준비된 분류(Ⓒ C9)** · **예시 정렬(Ⓢ S4)** · **준비된 세트(Ⓢ S9)** 는 어느 층도 안 가르치므로 그 세 비트에서만 **한 절씩** 허용한다. 셋 중 둘이 한쪽 arm에만 있어 공통 세그먼트로 올릴 수 없기 때문이다
- 여전히 금지(v2 계승): SCORE/baseline/treatment/control/Prolific · 두 버전 비교·추천 · 이름 뜻 풀이 · 기준("몇 개쯤이 좋다") · 스터디 절차 · 경고 톤
- **Clay 트랙에 "intent" 0회**(보드가 그 단어를 렌더하지 않는다 — 08-23 재확인)

---

## 3. 재료 — 관찰 세 개, 시스템 두 개, 같은 질문

세 관찰 전부 **실측 로그에서 나왔다**(상세 표는 `03_SCENARIO` §2–3).

| # | 관찰 | 앵커 질문 | 배달된 응답 |
|---|---|---|---|
| ① | 단어 질문에 답의 **모양이 제각각**이다 | `P19 · 2` how do you spell exaggeration | `The correct spelling is "exaggeration."` |
| | 〃 | `P29 · 3` spell egregious | `E-G-R-E-G-I-O-U-S` |
| ② | ①을 고치면 **정의 질문까지 같이 짧아진다** | `P29 · 5` define social anxiety | (원본) 366자 한 문단 |
| ③ | 자기 글을 **줄여 달라는 요청**에 챗봇이 그냥 줄여서 돌려준다 | `P29 · 8` Make this succinct "…" | 한 문장짜리 재작성본 |

세 질문이 **모두 P29 한 학생의 스레드 안에 있다**(P29 · 3·4·5·6·7·8). 데모 유저가 목록을 위에서 아래로 읽다가 세 관찰을 연달아 만나는 동선이 실제로 성립한다 — 억지로 찾아다니는 그림이 안 나온다.

### 3-1. 두 시스템이 갈라지는 자리 (= 조작 그 자체)

| 관찰 | Clay가 하는 일 | Slate가 하는 일 |
|---|---|---|
| ① | 문서에 When–Then 문장 **한 문단** | 그 질문에서 **intent 하나** (행의 `+`) |
| ② | 첫 문단의 When을 좁히고, **문단을 하나 더** 붙인다 (순서 없음 — 둘 다 늘 읽힌다) | 그 intent의 When을 좁혀 보고 → **되돌린 뒤**, 정의 질문에서 **spell intent 위에 intent 하나 더** (순서가 답을 정한다) |
| ③ | 준비된 분류로 **목록을 좁혀 읽고**, 문단을 하나 더 붙인다 | 준비된 분류를 **When 원문으로 가져와** intent 하나 더 |

**같은 문장을 다른 자리에 놓는다** — 이 재배치가 조작이다. 문장을 바꾸지 말 것(`03_SCENARIO` §4).

---

## 4. 패리티 규칙

| 축 | 규칙 |
|---|---|
| 층 | 두 시스템 다 ①+③. ②는 **블록 1에서만**(시스템과 무관) |
| 비트 | 워크스루 **각 10비트**. **같은 관찰이 같은 번호에** 온다(C1·C2 = S1·S2 관찰 ① · C5 = S5 관찰 ② · C8 = S8 관찰 ③ · C10 = S10 마무리). 그 사이 비트(3·4·6·7·9)는 **손이 시스템마다 다르므로 자리만 맞추고 내용은 맞추지 않는다** — 그 차이가 조작이다. 핀도 자리가 다르다: Clay는 C3에서 먼저 걸고, Slate는 S8에서 처음 건다 |
| 재료 | 같은 앵커 질문 4개(P19·2, P29·3, P29·5, P29·8), 같은 rule 문장 |
| 타이핑 | 양쪽 다 실시간. 램프(2×)를 **같은 자리에** 건다(첫 구간은 양쪽 다 실속도) |
| 대기 | 컷 규칙을 양쪽에 같이 적용(§1-2). 한쪽만 잘라 길이를 맞추지 않는다 |
| 내레이션 | 문장 골격 동일, 명사만 교체(rule/문서 ↔ intent/When·Then). 단어 수 ±5%. **TTS로 읽으므로 VO에 em dash를 쓰지 않는다**(`06_NARRATION` TTS 규율) — 화면에 타이핑되는 rule 원문은 예외로 그대로 둔다 |
| 길이 | 전체 차 **≤ 20 s**. 초 단위로 맞추지 않는다 |
| LLM 산출물 | intent 제목·버전 이름은 **매런 다르다** → 내레이션이 절대 읽지 않는다. **08-23 실측에서 같은 문서를 두 번 Apply했더니 이름이 `Clarified word-help request rules` → (Save 후) `Add initial Rules formatting guide` 로 바뀌었다** — 이름은 화면 인용으로도 쓰지 않는다 |
| 숫자 | 판정 결과 수(16/8/9/7 …)는 런마다 ±2. **읽지 않는다** |

**한 군데의 비대칭은 남긴다.** Slate에서는 `Add`가 곧 저장이라(새 intent가 `v1 · current`로 태어난다) 마지막에 누를 Save가 없을 수 있고, Clay는 문서를 반드시 Save해야 한다. 이건 실제 차이라 숨기지 않는다 — 대신 **"Apply는 지금 판, Save는 간직할 지점"이라는 문장은 ① 슬라이드에서 양쪽에 똑같이** 말하고, 워크스루에서는 각자 실제로 일어나는 것만 보여 준다(`05_SCRIPT_SLATE` S10의 분기).

---

## 5. 어휘 — 화면 라벨 (2026-08-23 실측)

> 이 목록이 대본의 인용을 지배한다. 화면과 다르면 **화면이 진실**이고 스크립트를 고친다. v2 `01_PLAN` §5에서 **바뀐 것만 굵게** 표시했다.

**헤더(양 arm 동일)**: **`Chatbot Studio · Clay` / `Chatbot Studio · Slate` 가 h1 한 줄, 그 아래 작은 줄에 과제 제목 `Intelligent Machines`** · ⓘ `Your task` · `n / 25 min` · `Deploy` · `Participant DEMO`

**Deploy 팝오버(양 arm 동일, 08-23 재확인)**:
> *This deploys the setup you have now and ends it. There are a few quick questions next, then you will check what it answers. You will not be able to come back and change it.*
> **Not yet** · **Deploy and finish**

**왼쪽 열(양 arm 동일)**: `Setup`(열 헤더) · `Undo` / `Redo`(오른쪽, 아이콘+글자) · `Apply` · `Save` · `VERSION HISTORY` `n` · 행 = `v{n}` + 이름 + 질문 수 알약 + 오른쪽 상태 칸 `unsaved` / `current` / `showing` / `4m ago` · 바닥 행 `v0` `Original (as delivered)`
- Apply 툴팁: 살아 있을 때 *Put this into effect and see what it answers* / 죽어 있을 때 *Nothing written here that is not already in effect*
- Save 툴팁: *Apply these edits first — Save keeps what is in effect* / **Ⓒ** *Keep this as a version you can come back to* · **Ⓢ** *Keep the whole configuration as a version you can come back to* / *Nothing has changed since the last save* (`SimpleStudio.tsx:1293` vs `:1838`)
- **옛 버전 행을 클릭하면 보드 전체가 읽기 전용**이 된다: Undo/Redo·Apply/Save가 사라지고 VERSION HISTORY 헤딩 줄에 **`Restore` · `Latest`** 가 나온다. `Restore`를 누르면 확인 줄 **`Back to setup {n}, dropping what came after?`** + **`Restore`** / **`Cancel`**. 확인하면 **그 뒤 버전은 사라진다**(실측: v2가 목록에서 없어지고 `VERSION HISTORY 1`로 돌아왔다).
- **화면에 `Revert`라는 글자는 없다.** 이 기획서에서 "revert"라고 부르는 동작은 전부 위의 **행 클릭 → Restore**다.

**가운데 열(양 arm 동일)**: 목록 제목 · `n of 103` · `· n kept above` · `Search questions`(플레이스홀더) · **검색어가 행 본문에서 노란색으로 하이라이트된다** · 빈 결과 시 *No question here contains "{검색어}".* + *{n} elsewhere in the log.* · `Keep this one in view` / `Stop keeping this one here`(행 호버 📌) · `Kept in view` `n` + *Stays here whatever you have selected* · `show pasted text` / `hide pasted text` · 붙여넣기 태그 `[OWN DRAFT · 316 words · 100%]` / `[ASSIGNMENT PROMPT · 91%]` / `[BOT REPLY · 128 words · 100%]`
※ 목록 제목: Clay는 `All questions` 또는 고른 분류 이름 / Slate는 `Uncategorized` 또는 열린 intent의 제목.

**오른쪽 열(양 arm 동일)**: `Conversation` · *Pick a question to see the conversation.* · **`This reply is the one that was delivered.`**(비교할 것이 없을 때 — 드롭다운 자체가 없다) · `This reply is under [ ]` / `Working out this reply under [ ]` · 응답 아래 접힌 룰 상자(툴팁 *Show the whole rule* / *Show less*) · 질문 옆 `⌃ n/m ⌄`
- 드롭다운 내용(실측): Clay = `Now (unsaved)` → `v{n} · {이름}` → **맨 아래** `v0 · Original (as delivered)` / Slate = **그 질문을 답하는 intent의** 버전 목록(`v1 · {이름}` → `v0 · Original (as delivered)`)

> **`Types` 와 `Starter sets` 는 같은 물건이다.** 한 컴포넌트(`StarterPicker`)가 두 arm에서 다른 라벨로 렌더된다 — Clay에서는 가운데 열의 `Types`(목록을 좁힌다), Slate에서는 폼 안의 `Starter sets`(고른 세트의 문장이 WHEN에 들어간다). 같은 taxonomy, 같은 순서, 같은 준비된 판정. **카운트만 다르게 센다**(§7 마지막 줄). 대본은 이 사실을 화면에서만 보여 주고 **말하지 않는다** — 말하면 한쪽 기능을 다른 쪽에 이식하는 설명이 된다.

**Clay만**: `RULES` · `n / 8000` · 플레이스홀더 *What the chatbot should do, in your own words. If you tell it not to do something, say what it does instead.*(**두 문장이다** — 08-23 화면 재확인) (**실측: 데모 클론의 첫 프레임은 `0 / 8000`으로 비어 있다 — 다만 이건 보드의 성질이 아니라 마스터에서 물려받은 값이다.** 첫 프레임의 문서는 `emptySnapshot` 이 `seedPrompt = assignmentBasePrompt(assignment)` 로 채운다: 마스터의 `custom_system_prompt` 가 비어 있어서 비어 보이는 것이고, 거기에 글이 들어가면 **첫 프레임부터 글이 든 상자**가 되고 C4의 타이핑·카운터가 전부 달라진다) · 가운데 열 헤더의 **`Types` ▾** · 고른 뒤 옆에 ✕ **`Show every question again`** · 고르면 제목이 분류 이름, 카운트가 `n of 103`, **제목 아래에 그 분류의 정의문 한 문단**

**Slate만**: `New intent`(리스트 행, 글리프 `+`) · 행 호버 `+` = **`Start an intent — read before “{현 소유자}”`**(따옴표는 컬리) · 행 호버 ✨ = **`Use as an example — it orders the list, it does not move the question`** · 행 호버 📌 · 폼 제목 줄 `New intent`(앞에 ○) · 위치 문장 두 변형:
  - 아래에 다른 intent가 없을 때: *Read before “Uncategorized”, so any of its **103** questions can come here. Nothing above it moves.*
  - 있을 때: *Read before “{앞에 놓일 intent의 제목}”, so any of its **{그 intent의 질문 수}** questions can come here, and anything below it this also describes. Nothing above it moves.* (실측 예: "Word spelling and usage" / 16 — **제목과 숫자는 런마다 다르다**)
  · `STARTED FROM` 카드(`P19 · 2` + 질문 원문; 맨땅 폼에는 **없다**) · `WHEN A QUESTION…`(플레이스홀더 `asks for…`) · `Starter sets` ▾ · `THEN`(플레이스홀더 *What the chatbot should do with those questions. If you tell it not to do something, say what it does instead.*) · `Reuse a rule` ▾(**설정 어딘가에 비어 있지 않은 rule이 하나라도 있을 때만 나온다** — 첫 폼에는 없었다) · `Add` / `Cancel` · 소속 칩(● 색점 + 제목) · `Examples` `n` · 2분할 토글 **`Closest first` | `Furthest first`** · **`Generate examples`**(<3) / **`Update examples`**(≥3) / *Writing…* · intent 행의 `↑`(툴팁 `Answer earlier`) `↓`(`Answer later`) · 제목 옆 연필(툴팁 `Rename`) · `Uncategorized`(When 없이 `THEN`만)

---

## 6. 산출물

**발행하는 것은 네 파일**(§1-1). 그 안에 들어가는 조각은 여섯이고, 편집에서 합쳐진다:

| 조각 | 길이 | 출처 |
|---|---|---|
| Clay 개념 / Slate 개념 | 81 s / 85 s | `slides/png/*.png` + `tts/studio/*-concept.txt` |
| Getting around (Clay 보드 / Slate 보드) | 82 s | 기존 영상 + `tts/studio/getting-around.txt`(소리는 새로) |
| Clay 워크스루 / Slate 워크스루 | 265 s / 263 s | `07_SHOOTING_ACTIONS.md` 로 재촬영 |

`.env` 에 네 줄:

```
NEXT_PUBLIC_STUDY_DEMO_BLOCK1_SIMPLE_SCORE="…"      # block1-slate
NEXT_PUBLIC_STUDY_DEMO_BLOCK1_SIMPLE_BASELINE="…"   # block1-clay
NEXT_PUBLIC_STUDY_DEMO_BLOCK2_SIMPLE_SCORE="…"      # block2-slate
NEXT_PUBLIC_STUDY_DEMO_BLOCK2_SIMPLE_BASELINE="…"   # block2-clay
```

유튜브는 Unlisted · **임베드 허용**(Private은 재생되지 않는다) · 제목은 화면 라벨("Clay" / "Slate") · 설명란에는 **챕터 타임스탬프**를 넣는다(한 파일이 7분이라 되짚을 수 있어야 한다).

확인은 simple family 참가자로 `/study/session`. 슬롯이 비어 있으면 **필요한 변수명을 그대로** 표시하고, 값이 잘못되면 **그 값을 되비춘다**.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| **블록 1이 4분 예산을 ~3:08 넘는다** | 흡수 1→3은 이미 대본에 반영돼 ~7:08이다. 더 줄이려면 타이핑 원문을 줄이거나(D) 관찰을 빼야 한다(B/C) — §1-2 표에서 **연구자가 고른다**. 기본값은 **A**(예산을 7분으로), 5분대가 필요하면 **A+D** |
| Slate 판정이 30 s 가까이 걸린다(실측) | 첫 판정만 살리고 나머지는 컷(§1-2). **예열은 듣지 않는다** — 판정 캐시 키는 `(assignment_id, def_hash, message_id)`, 응답 캐시 키는 `(message_id, rule_hash)` 인데 `Run demo` 는 매번 클론을 새로 만들어 message id까지 새로 발급한다. 리허설 클론에서 데운 것은 본 촬영 클론에 없다 |
| 판정이 잡는 집합이 매런 다르다 | 숫자를 읽지 않는다. `03_SCENARIO` §5 분기표의 **성립 조건만** 확인 |
| **Slate에서 Furthest first 맨 위에 정의 질문이 안 온다** | 이 기획의 척추다. 08-23 실측은 1위 `P38 · 1`, 2위 `P29 · 5`였다. 안 오면 `03_SCENARIO` §5의 대체 경로(검색 `define`으로 정의 질문을 직접 찾아 그 행의 소속 칩이 spell intent임을 보이기)로 간다 |
| Clay에서 When을 좁혀도 정의 응답이 안 길어진다 | **그것이 실측 결과다**(좁혀도 두 줄로 나왔다) — 그래서 둘째 문단이 필요하다는 논증이 성립한다. 반대로 길어져 버리면 C6의 확인 문장만 바꾸고(`03_SCENARIO` §5) 진행 |
| 버전·intent 이름이 매런 다르고 Apply마다 바뀐다 | 이름을 읽지도, 화면 인용으로 쓰지도 않는다(§4) |
| `Deploy and finish`를 실수로 누른다 | 그 데모 런은 끝이다(`/study/session`으로 넘어가고 보드로 못 돌아온다). 재촬영은 `Run demo`를 새로 — assignment id가 바뀐다. 실수로 팝오버만 열렸으면 **Not yet** |
| **유튜브 링크를 넣었는데 재생이 안 된다** | 08-23에 고쳤다. 원인은 `embed/` 뒤에 값을 그대로 이어 붙인 것 — 전체 URL을 넣으면 `…/embed/https://youtu.be/ID` 라는 **유효한 URL**이 되어 iframe은 뜨고, 유튜브가 "https:"라는 영상을 찾다 빈 화면을 보였다. 이제 링크에서 id를 뽑고(`youtubeId`), 못 뽑으면 앰버 상자로 그 값을 되비춘다. 그래도 안 나오면 남은 원인은 셋이다 — **Private**(→ Unlisted로) · **임베드 비허용** · **`.env` 편집 후 서버 미재시작** |
| Starter sets의 카운트가 Types와 다르다 | 버그가 아니다. Types는 **로그 전체**에 대해 세고(Shorten / Trim **8**), Starter sets는 **그 폼이 읽히기 직전인 더미**에 대해 센다 — `+ New intent` 폼에서는 Uncategorized 더미(실측 86)라 같은 항목이 **7**, 행 `+` 폼에서는 **그 행을 지금 소유한 intent의 질문들만**이라 더 작다(`takeableFrom`). 숫자는 읽지 않는다 |

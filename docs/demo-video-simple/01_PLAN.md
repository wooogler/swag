# 데모 영상 기획 v2 — Simple 스터디용 (Slate / Clay)

> 작성 2026-08-22, **개정 2026-08-23**. **Simple family(`simple_score`/`simple_baseline`) 전용** — 스터디는 당분간 이 조건 쌍으로만 돈다(08-21 확정, 풀 버전 코드는 보존). 시스템 사양은 `docs/SCORE_SIMPLE_DESIGN.md`가 진실이다.
>
> **개정 이유**: 08-22 11:32(`17ac1c3`) 이후 53커밋이 이 문서가 찍는 화면을 갈아엎었다 — Deploy가 블록을 끝내는 되돌릴 수 없는 한 번이 되었고(`I'm done` 소멸), 소속 diff 색이 사라졌고, 정렬·예시 버튼 이름이 바뀌었고, 두 arm의 버전 UI가 하나로 합쳐졌고, Clay 가운데 열에 `Types` 피커가 새로 생겼다. 라벨은 08-23에 HEAD 소스에서 다시 채집했다.
>
> **`shots/`는 08-23에 실제 데모 워크스페이스를 돌려 1920×1080으로 다시 찍었다**(23장, `shots/README.md`에 색인). §5의 라벨은 그 화면에서 확인한 것이다.
>
> 구 문서 세트(`docs/demo-video/`)는 **풀 버전의 영상용**이다 — AI 보조(후보 생성·제안·fold·Rewrite)가 화면에서 사라졌으므로 그 대본은 이 UI에 적용되지 않는다. 문서 구조와 패리티 규율은 그대로 계승한다.
>
> 이 폴더: `01_PLAN`(이 문서) → `02_SCENARIO`(데모 유저의 생각·재료·타이핑 원문·분기표) → `03/04/05_SCRIPT_*`(세그먼트별 AV 스크립트) → `06_NARRATION`(녹음 원고) → `README`(촬영 런북). 참고 화면은 `shots/`.

---

## 1. 이 영상이 하는 일

참가자는 두 버전(Slate/Clay)을 모두 쓴다. 각 블록 전에 영상으로 도구의 **작동 방식**을 배운다. 영상은 한 사이클 — 질문을 읽고 → 설정을 쓰고 → **Apply로 그 자리에서 확인**하고 → Save로 지점을 남기고 → **Deploy로 선언**한다 — 를 끝까지 보여 준다.

Simple에서 달라진 전제 셋이 영상의 성격을 정한다:

1. **설정 텍스트는 전부 사용자가 쓴다.** AI 후보·제안·수정 에이전트가 없다. 그래서 영상의 중심은 "무엇을 눌러 무엇을 받아내나"가 아니라 **"쓰면 → 무슨 일이 일어나는지를 어디서 확인하나"**다.
2. **원페이지 대시보드.** 워크벤치·생성 모달이 없다 — 카메라가 화면을 떠나지 않으므로 컷이 거의 없다.
3. **저장·확인이 빠르다.** LLM 대기를 잘라내는 편집이 거의 필요 없다. 판정 스트리밍("working out where questions go")은 오히려 **보여 줄 대상**이다.

영상이 하지 않는 일(전과 동일): 두 버전 비교·추천 금지, 이름 뜻 설명 금지, 기준(몇 개나, 좋은 rule) 금지, 스터디 절차 설명 금지.

## 2. 모듈 구조 — 3편, 순서가 섞여도 되게 (전과 동일)

| 세그먼트 | 내용 | 목표 길이 | 재생 |
|---|---|---|---|
| ⓐ **Getting around** (공통, **보드별 2테이크**) | 브리핑 → 질문 리스트(flat)·검색 → 대화 뷰어(*This reply is the one that was delivered.* · 붙여넣기 접힘 · 이동 화살표) → **Pin(Kept in view)** → 헤더(경과 · Deploy와 그 팝오버) | **75 s ± 5** | 블록 1, 자기 버전 앞 |
| ⓑ **Slate** (`simple_score`) | intent 리스트 소개 → **경로 ② 쿼리에서 intent** → 판정·소속 칩 → **Examples 정렬**(Closest first / Furthest first · 예시 추가) → 경계 읽고 When 수정 → **경로 ① 맨땅 intent**(모델 예시 3) → Save·Version history → Deploy | **170 s ± 10** | 블록 1 또는 2 |
| ⓒ **Clay** (`simple_baseline`) | Rules 문서 소개 → 질문 읽기 → **Pin으로 고정** → **사이클 1**(쓰기→Apply→확인) → **사이클 2**(**Types**로 좁혀 읽기→덧붙이기→Apply→**필터 해제 후 핀에서 확인**) → Save·Version history·버전별 열람 → Deploy | **180 s ± 10** | 블록 1 또는 2 |

- 블록 1 = ⓐ + 자기 버전, 블록 2 = 다른 버전만. **08-23 재계산으로 예산이 빠듯해졌다**: 블록 1 = 75 + 180 = **~4분 15초**(설계 §5.1 예산 4분을 ~15 s 초과), 블록 2 = **~3분**(예산 3분에 딱). ⓒ가 길어진 것은 Types 비트(§2-1)와 타이핑 분량 때문이다. 흡수 순서 — ① 편집에서 5 s 초과 대기 컷을 엄격히(≤2 s), ② ⓐ A3의 붙여넣기 태그 시연 생략(~6 s), ③ ⓒ C6의 버전 드롭다운 비교를 한 번만(~8 s). ①로 안 되면 ②를 쓴다.
- **ⓐ를 따로 두는 이유가 08-23에 하나 늘었다.** Deploy가 되돌릴 수 없어졌으므로(누르면 그 자리에서 블록이 끝나고 `/study/session`으로 넘어간다) 버전 세그먼트는 **끝까지 가야만 끝나는 테이크**다. ⓐ를 합치면 한 테이크가 ~4분이 되고 3분 30초 지점의 오타가 4분을 날린다. 촬영 횟수는 어차피 보드별로 따로 찍으므로 합쳐도 줄지 않는다.
- ⓐ를 **두 보드에서 두 번** 찍고 보이스오버는 한 번 녹음한다(왼쪽 열이 모든 프레임에 들어간다). **다만 "두 테이크가 같은 프레임"이라는 전제는 08-23에 폐기했다** — ⓑ는 리스트 제목이 `Uncategorized`이고 모든 행에 소속 칩이 붙고, ⓒ는 `All questions`에 헤더의 `Types` 버튼이 하나 더 있다. 맞추는 것은 프레임이 아니라 **클릭·타이핑·멈춤**이고, VO는 리스트 제목도 헤더 버튼도 부르지 않는다. 발행 변수는 `NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_SCORE` / `…_COMMON_SIMPLE_BASELINE`(폴백 `…_COMMON_SIMPLE`), 버전 세그먼트는 `…_SIMPLE_SCORE` / `…_SIMPLE_BASELINE`. `.env.example`에 이미 있다.
- 각 세그먼트는 혼자 완결("아까 본 것처럼" 금지).

### 2-1. 사용자 지정 기능의 배치

요청: *"Clay는 Pin과 cycle, Slate는 두 경로의 intent 생성과 example 기반 정렬."* 배치는 이렇게 한다:

- **Pin은 ⓐ에서 가르친다.** Pin(§3.5)은 **양 조건 공통** 셸 기능이다. ⓒ에서만 가르치면 Slate가 첫 블록인 절반이 핀을 모른 채 25분을 시작한다 — 공통 기능은 공통 세그먼트에서 가르치는 것이 셸 패리티다. **ⓒ는 핀을 사이클 안에서 실제로 쓴다**(고치는 질문을 선반에 고정하고 Apply마다 들여다본다) — 가르침은 ⓐ, 체득은 ⓒ.
- **Slate의 Examples는 ⓑ에서만.** 예시 집합·정렬은 SCORE 전용 표면이라 ⓒ에 대응물이 없고, 이 비대칭은 조작의 일부다(숨기지 않는다).
- **Clay의 Types는 ⓒ에서만 [08-23 결정].** 준비된 분류로 로그를 좁혀 읽는 피커(`d47c44c`)는 **baseline arm에만** 렌더된다 — intent arm은 이미 intent로 목록이 갈려 있어 두 번째 슬라이서를 주지 않는다. 위의 Examples와 **같은 규칙을 그대로 적용한다**: 한쪽에만 있는 표면은 그쪽 세그먼트에서 가르치고 숨기지 않는다. 안 가르치면 Clay 참가자 절반이 설명 없는 버튼을 25분 내내 프레임에 두게 된다.
  - **비트를 늘리지 않고 사이클 2(ⓒ5) 안에 접는다.** 분류로 좁혀 읽고 → 그 관찰로 문서에 문단을 덧붙이고 → Apply → **필터를 지우고(`Show every question again`) 핀해 둔 단어 질문으로 돌아가** 거기도 새 문서 아래서 답이 다시 나온 것을 본다. "좁혀 읽었지만 **쓴 것은 전 질문에 걸린다**"가 한 비트 안에서 화면으로 증명된다 — 이 조건의 핵심 사실을 말이 아니라 동작이 말하게 하는 자리다.
  - **말해도 되는 것과 안 되는 것.** 화면 사실만: 목록에 무엇이 보일지를 바꾼다. *"이 분류로 규칙을 만든다"* 류는 금지 — 분류가 설정에 들어간다는 뜻이 되어 ⓑ의 기능을 ⓒ에 이식하는 설명이 된다. 보드는 `intent`라는 단어를 렌더하지 않으므로 금지어 규율 자체는 깨지지 않는다.
- **cycle(쓰기→Apply→확인→Save)은 양쪽 다** 보여 준다 — 같은 동사 행(**Apply · Save**)이 양 arm의 에디터에 있다(설계 §3.3). Undo/Redo는 08-23 현재 양쪽 다 왼쪽 열 맨 위 **Setup** 헤더로 올라갔다. ⓒ는 사이클을 **두 번** 돌려 "수정은 항상 문서 전체·전 질문에" 적용된다는 사실을 화면이 말하게 한다.
  - **손 순서가 고정됐다: 타이핑 → Apply → Save.** Save는 상자에 적용 안 된 편집이 남아 있으면 dim이고 호버하면 *Apply these edits first — Save keeps what is in effect* 라고 말한다. 타이핑하고 곧장 Save로 가는 테이크는 죽은 버튼을 찍는다. 양 arm 동일한 게이트라 패리티에는 영향이 없다.

## 3. 시나리오 요약 (상세는 `02_SCENARIO`)

- 데모 유저: 같은 교수자, 같은 재료(NIRVANA 데모 세트 20명·103문항 — flat 리스트로 보인다).
- 눈에 띈 것 두 가지: ① **짧은 단어 질문**(철자·동의어·용법)에 답이 들쭉날쭉하다 ② **통째로 써 달라는 요청**(에세이·문단)에 챗봇이 그냥 써 준다.
- Slate: ①을 **쿼리에서 시작한 intent**로(경로 ②), ②를 **맨땅 intent**로(경로 ①) 만든다. 두 경로가 곧 두 비트다.
- Clay: 같은 두 관찰을 **한 문서에 두 문단**으로, 두 사이클에 나눠 쓴다 — 문서가 자라는 모습이 곧 이 조건의 작동 방식이다.
- rule 내용은 전과 같은 원칙: 교육 철학 없는 사무적 형식 규칙(§5.1) + 에세이 대필 거절(과제 안내문이 실제로 금지하는 행동이라 중립).

## 4. 패리티 규칙 (ⓑ vs ⓒ)

전과 동일한 규율에 Simple 특유의 것을 더한다:

| 축 | 규칙 |
|---|---|
| 구조 | 같은 7비트 수, 같은 비트 순서. **길이는 상한만 둔다: 전체 차 ≤ 20 s [08-23 완화]** |
| 재료 | 같은 앵커 질문(P19 · 2 "how do you spell exaggeration"), 같은 두 관찰, **같은 rule 문장**(ⓑ는 두 intent의 Then으로, ⓒ는 한 문서의 두 문단으로 — 이 재배치가 조작 그 자체) |
| 타이핑 | **양쪽 다 화면에서 실시간 타이핑.** AI가 써 주는 것이 없으므로 타이핑이 곧 콘텐츠다 — 속도를 맞춘다(분당 ~200타). 긴 문장은 리허설로 손에 익힌다 |
| 대기 | 판정 스트리밍·응답 스트리밍은 **자르지 않는다**(도구의 실제 속도가 이 버전의 주장이다). 5 s를 넘는 구간만 ≤2 s로 |
| 내레이션 | 문장 골격 동일, 명사만 교체(intent/rules · 소속/전체). 단어 수 ±5% |
| 금지어 | 전과 동일: SCORE/baseline/treatment/Prolific/비교급·가치어/이름 뜻/기준. **ⓒ 음성·화면에 "intent" 금지**(보드가 렌더하지 않는 것을 확인함) |
| LLM 산출물 | 버전 이름·intent 제목은 **매런 다르다** — 내레이션이 특정 이름을 읽지 않는다("the tool names it for you" 수준) |

**길이 패리티를 완화한 이유 [08-23].** 두 도구의 표면적은 실제로 다르고 — 그 차이가 곧 조작이다 — 길이를 초 단위로 맞추려면 없는 내용을 넣거나 있는 내용을 빼야 한다. 둘 다 참가자가 보는 것을 왜곡한다. 그래서 패리티를 **구조(같은 비트 수·순서)·문장 골격·금지어**에 걸고, 길이에는 상한만 둔다. 실제로 ⓒ에 Types 비트가 접히면서 두 편은 다시 165 s 근처로 모인다.

**7비트 대응표**

| # | ⓑ Slate | ⓒ Clay | 길이 |
|---|---|---|---|
| 1 | 왼쪽 열: **Setup** 헤더(오른쪽에 Undo · Redo) → intent 리스트(위→아래) → `+ New intent` → 맨 아래 Uncategorized | 왼쪽 열: **Setup** 헤더(Undo · Redo) → RULES 문서 하나 → 같은 카드 안 **Version history**(첫 프레임부터 `v0 · Original (as delivered)` 한 행) | ~15 s |
| 2 | 단어 질문 열고 원래 응답 확인 | 단어 질문 열고 원래 응답 확인 | ~15 s |
| 3 | **경로 ②**: 행의 `+` → 그 자리 폼(Started from·Starter sets 점) → When·Then 타이핑 → Add | **Pin**: 선반에 고정 → RULES에 첫 문단 타이핑 | ~30 s |
| 4 | 판정 스트리밍 → 소속 칩 → **Add 직후 카드가 이미 열려 있다**: **Examples**(시드) + Closest/Furthest 토글 + 헤더의 When 원문 | **사이클 1**: Apply → "Working out this reply under [Now (unsaved)]" → 새 응답 → 핀된 행에서 확인 | ~30 s |
| 5 | **Examples 다듬기**: 예시 추가(정렬만 바꾼다) → **Furthest first** → 경계 읽기 → When 고쳐 Apply(소속 칩·카운트가 다시 앉는다 — **색 신호는 없다**) | **사이클 2**: **Types**로 대필 분류를 골라 좁혀 읽기 → 둘째 문단 덧붙여 Apply → **필터 해제 → 핀된 단어 질문에서 확인** | ~35 s |
| 6 | **경로 ①**: `+ New intent` → 타이핑 → Add → **모델 예시 3**(헤더 버튼은 **Update examples**) → 제목이 저절로 | Save → 카드 안 **Version history**(`v{n} · {이름} · current`) → 뷰어 드롭다운에서 **버전별 응답 열람**(맨 아래 **v0 · Original (as delivered)**) | ~30 s |
| 7 | Save → 카드 히스토리(`v{n} · unsaved` → `current`) → **Deploy** → 팝오버 한 문장 + **Not yet / Deploy and finish** → **누르지 않고** 2 s 홀드 | Save → Version history → **Deploy** → 팝오버 한 문장 + **Not yet / Deploy and finish** → **누르지 않고** 2 s 홀드 | ~15 s |

비트 4·5의 내용이 갈리는 것(Examples vs 두 번째 사이클)은 조작이 표면에 드러나는 자리다 — 길이만 맞추고 내용은 각자의 사실을 중립적으로 말한다.

## 5. 어휘 — 화면 라벨 (2026-08-23 HEAD 소스에서 재채집, 촬영 당일 재확인)

> 이 목록이 대본의 인용을 지배한다. 화면과 다르면 **화면이 진실**이고 스크립트를 고친다.

**공통 — 셸**: Chatbot Studio · Slate / Clay(h1, 그 아래 줄에 과제 제목) · ⓘ **Your task** → 모달 **What you're working from**(YOUR TASK IN THIS ROUND · THE ASSIGNMENT STUDENTS WERE GIVEN · THE CHATBOT'S STARTING PROMPT · *Reopen this any time from **Your task** in the header.* · **Start**) · `n / 25 min`(툴팁 *This part of the session is about 25 minutes. Your facilitator keeps the time — nothing stops on its own.*) · **Deploy**

**공통 — Deploy [08-23 전면 교체]**: 참가자·데모 헤더의 Deploy는 **항상 활성**이고 **옆에 상태 문구가 없다**. 누르면 아래에 팝오버가 열린다:
> *This deploys the setup you have now and ends it. There are a few quick questions next, then you will check what it answers. You will not be able to come back and change it.*
> **Not yet** · **Deploy and finish**

`Deploy and finish`는 배포 + 블록 종료 + `/study/session` 이동을 한 번에 한다. **누르지 않는다**(§6). 실패는 버튼 아래 앰버 상자로만 나온다(*That did not go through — tell your facilitator.* / *You have not deployed yet. Press Deploy — the next step is about the setup you deploy.*).
~~Not deployed yet / Deployed vN / Changed since vN / I'm done~~ — **데모 화면에 없다.** 앞 둘은 연구자 `?view=` 프리뷰 전용이고 문구도 `Deployed setup N` / `Changed since setup N`이며, `I'm done`은 simple 보드에서 삭제됐다(`blockDone={null}`).

**공통 — 왼쪽 열(양 arm 동일)**: **Setup**(열 헤더) · **Undo** / **Redo**(그 오른쪽, 아이콘 + 글자. 툴팁 *Undo (⌘Z) — {무엇이 되돌려지는지}*) · **Apply** · **Save**(적용 안 된 편집이 있으면 dim, 호버 시 *Apply these edits first — Save keeps what is in effect*; 바뀐 게 없으면 *Nothing has changed since the last save*) · **Version history** `n` · 행 = `v{n}` + 이름 + 질문 수 알약 + 오른쪽 상태 칸 **unsaved** / **current** / **showing** / `4m ago` · 바닥 행 **v0 · Original (as delivered)**(ⓒ의 Rules 문서와 ⓑ의 **Uncategorized**에만 — 개별 intent는 첫 문구 이전에 존재하지 않았으므로 바닥이 없다) · 옛 버전을 연 동안에만 **Restore** / **Latest**(*Back to setup {n}, dropping what came after?*) · 트리·문서 행의 **unsaved** 칩(*Applied, and not in what the next step will read. Deploy keeps it.*)
※ 최근 **3행**이 늘 펼쳐져 있고 4행 이상일 때만 헤딩이 접는 버튼이 된다. **Revert는 화면에 없다.**

**공통 — 가운데 열**: `n of 103` · `· n kept above` · **Search questions**(placeholder) · *working out where questions go*(리스트 헤더, 판정 중) · *working it out*(판정 중인 행의 자리표시) · **Keep this one in view** / **Stop keeping this one here**(행 호버 📌) · **Kept in view** · *Stays here whatever you have selected* · **show pasted text** / **hide pasted text**(붙여넣기 접힘 토글) · 본문의 붙여넣기 태그 `[OWN DRAFT · 316 words · 100%]`(툴팁 *… — click to reveal* / 펼치면 *Pasted material — … — click to collapse*)
※ **목록 제목은 arm마다 다르다**: ⓑ는 선택에 따라 **Uncategorized**(시작 상태) 또는 열린 intent의 제목, ⓒ는 **All questions** 또는 고른 분류의 이름. 공통 VO는 제목을 읽지 않는다.

**공통 — 오른쪽 열**: **Conversation** · *Pick a question to see the conversation.* · **This reply is the one that was delivered.**(비교할 버전이 없을 때 — **드롭다운 자체가 없다**) · **This reply is under [ ]** / **Working out this reply under [ ]** / **This reply is [ ]**(바닥을 고른 상태) · 드롭다운 = **Now (unsaved)**(이름 없음) → `v{n} · {LLM 이름}`(최신순) → **v0 · Original (as delivered)**(**맨 아래**) · *Working out which rule applies to this question.* · (드롭다운은 네이티브 `<select>`다 — 열면 OS 메뉴가 뜬다) · 응답 아래 접힌 룰 상자(두 줄, 툴팁 *Show the whole rule* / *Show less*) · 선택된 질문의 링과 새 응답의 왼쪽 막대가 **그 질문을 답하는 intent의 색**(ⓑ만)
~~*— nothing here has been changed yet*~~ — 삭제됐다.

**ⓑ만**: `+ New intent`(리스트 행, 글리프는 `+` 하나) · 행 호버 `+` = **Start an intent — read before "{현 소유자}"** · 폼 제목 줄 **○ New intent** · *Read before "Uncategorized", so any of its **n** questions can come here. Nothing above it moves.*(아래에 다른 intent가 있을 때만 *…can come here, **and anything below it this also describes**. Nothing above it moves.*) — **n은 그 자리가 가로챌 더미**라 첫 intent는 103, 둘째는 88처럼 줄어든다 · **STARTED FROM** 카드(`P19 · 2` + 질문 원문) · **When a question…** · **Then** · **Starter sets** ▾(첫 열기 *Loading…*; 시드가 든 행은 배경이 물들고 제목 왼쪽에 ●, 뜻은 그 행 호버 시 옆 패널에 *marks the sets the question you started from is in.* — **상단 범례 줄 없음**) · **Reuse a rule** ▾(THEN 옆) · **Add** / **Cancel** · **Uncategorized** · 소속 칩(● 색점 + 제목) · **Examples** · 헤더의 2분할 토글 **Closest first** | **Furthest first** · **Generate examples**(예시 <3) / **Update examples**(≥3) / *Writing…*(~15 s) · 행 호버 ✨ · ↑ ↓ · 🗑(확인을 묻는다) · ✏
~~The list below is ordered by these · Rewrite · Most like these / Least like these~~ — 전부 삭제됐다.

**ⓒ만**: **RULES** · `n / 8000` · *What the chatbot should do, in your own words.* · **Types** ▾(가운데 열 헤더; 준비된 분류 — Planning · Translating · Reviewing · Drafting과 그 하위) · 고른 뒤 옆에 ✕ **Show every question again** · 고르면 목록 제목이 분류 이름으로, 카운트가 `n of 103`으로, 제목 아래에 그 분류의 정의문
~~*Saved versions will appear here.*~~ — 별도 버전 패널이 통째로 삭제됐다. ⓒ도 ⓑ와 같은 **Version history**를 RULES 카드 안에서 쓴다.

## 6. 촬영 형식 (전과 동일한 것은 생략)

- 1920×1080 · F11 전체화면 · 줌 100% · 커서 하이라이트 · 무음 녹화 + 별도 VO.
- **프로덕션 빌드 필수** — dev는 "N" 배지가 프레임에 박히고 첫 화면마다 컴파일로 멈칫한다.
- 계정은 `Run demo · Simple SCORE` / `· Simple Baseline` — 헤더 `Participant DEMO`, 경과 0분부터.
- **한 세그먼트 한 테이크**(경과 칩 단조 증가). 판정·응답 스트리밍은 살린다(§4).
- **`Deploy and finish`는 절대 누르지 않는다 [08-23].** 마지막 프레임은 팝오버가 열린 상태로 2 s 홀드하고 녹화를 끝낸다. 실수로 눌리면 그 데모 런은 끝이고(phase gate가 `/studio/{id}`를 `/study/session`으로 돌린다) 재촬영은 `Run demo`를 새로 돌려야 한다 — 브리핑 모달도 다시 열리고 assignment id도 바뀐다. A5에서도 Deploy는 **호버만** 한다; 실수로 팝오버가 열렸으면 **Not yet**으로 닫고 다시 찍는다.

## 7. 산출물과 발행

1. 파일 4개: `getting-around-simple-slate.mp4` · `getting-around-simple-clay.mp4` · `simple-slate.mp4` · `simple-clay.mp4`.
2. YouTube Unlisted, 임베드 허용, 제목은 화면 라벨("Getting around" / "Slate" / "Clay"), 설명 비움.
3. `.env`:
   ```
   NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_SCORE="…"
   NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_BASELINE="…"
   NEXT_PUBLIC_STUDY_DEMO_SIMPLE_SCORE="…"
   NEXT_PUBLIC_STUDY_DEMO_SIMPLE_BASELINE="…"
   ```
   `NEXT_PUBLIC_`은 빌드 타임 — 넣은 뒤 재빌드. 확인은 simple family 참가자(또는 데모 계정을 `not_started`로)로 `/study/session`.

## 8. 위험과 대응

| 위험 | 대응 |
|---|---|
| LLM 제목·버전 이름이 매런 다르다 | 내레이션이 이름을 읽지 않는다. 화면 인용은 "{LLM 이름}" 자리로 |
| 판정이 잡는 집합이 매런 다르다(±2) | 내레이션이 숫자를 읽지 않는다. 분기표(`02_SCENARIO` §5)의 성립 조건만 확인 |
| Slate에서 경계 질문이 안 잡히거나 이상한 것이 잡힌다 | **그대로 둔다** — "이 문장이 이걸 잡았네"는 이 보드가 보여 주기로 한 사실이고, When을 고쳐 Apply하는 것이 곧 비트 5다. 잡힌 것이 전부 맞으면 Examples 헤더의 **Furthest first**에서 경계를 읽는 쪽으로 |
| 판정·응답이 예상보다 느리다 | 5 s 초과 구간만 컷. 반복되면 촬영 전 같은 워크스페이스에서 한 번 예열(캐시가 텍스트 키라 같은 문장은 히트) |
| Deploy 아래 앰버 상자가 뜬다 | 데모 보드의 Deploy는 `PhaseAdvance`라 **비활성 상태가 없다** — 도는 동안만 *Working…*. 대신 앰버 상자(*That did not go through …*)가 뜨면 촬영 중단하고 버그로 |
| Types 분류의 카운트가 리허설과 다르다 | 준비된 판정을 읽는 것이라 런마다 같아야 하지만, 클론이 새로 만들어지므로 확인은 한다. 숫자는 내레이션이 읽지 않는다 |
| ⓑ에서 Examples 카드가 안 보인다 | 예시가 0개면 카드째 렌더되지 않는다 — 누를 버튼도 없다. 다른 행을 눌렀다가 그 intent를 다시 선택해 목록을 다시 받는다 |
| Save가 눌리지 않는다 | 버그가 아니다 — 상자에 적용 안 된 편집이 있다. **Apply 먼저**(순서: 타이핑 → Apply → Save) |

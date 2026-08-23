# 데모 영상 기획 v2 — Simple 스터디용 (Slate / Clay)

> 작성 2026-08-22. **Simple family(`simple_score`/`simple_baseline`) 전용** — 스터디는 당분간 이 조건 쌍으로만 돈다(08-21 확정, 풀 버전 코드는 보존). 시스템 사양은 `docs/SCORE_SIMPLE_DESIGN.md` v2.2가 진실이고, 화면 라벨은 2026-08-22에 실제 데모 워크스페이스를 끝까지 돌려 채집했다(`shots/`).
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
| ⓐ **Getting around** (공통, **보드별 2테이크**) | 브리핑 → 질문 리스트(flat)·검색 → 대화 뷰어(Original·붙여넣기 접힘·이동 화살표) → **Pin(Kept in view)** → 헤더(경과·Deploy) | **70 s ± 5** | 블록 1, 자기 버전 앞 |
| ⓑ **Slate** (`simple_score`) | intent 리스트 소개 → **경로 ② 쿼리에서 intent** → 판정·소속 칩 → **Examples 정렬**(Most/Least like these·예시 추가) → 응답 확인·Then 수정 → **경로 ① 맨땅 intent**(모델 예시 3) → Save·버전 → Deploy | **165 s ± 7** | 블록 1 또는 2 |
| ⓒ **Clay** (`simple_baseline`) | Rules 문서 소개 → 질문 읽기 → **Pin으로 고정** → **사이클 1**(쓰기→Apply→확인) → **사이클 2**(다른 질문에서 확인→덧붙이기→Apply) → Save·버전·버전별 열람 → Deploy | **165 s ± 7** | 블록 1 또는 2 |

- 블록 1 = ⓐ + 자기 버전(~4분), 블록 2 = 다른 버전만(~2.75분). 설계 §5.1 예산(4/3분) 안.
- ⓐ를 **두 보드에서 두 번** 찍고 보이스오버는 한 번 녹음하는 이유·방법은 전과 동일(왼쪽 열이 모든 프레임에 들어간다). 발행 변수는 `NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_SCORE` / `…_COMMON_SIMPLE_BASELINE`(폴백 `…_COMMON_SIMPLE`), 버전 세그먼트는 `…_SIMPLE_SCORE` / `…_SIMPLE_BASELINE`. `.env.example`에 이미 있다.
- 각 세그먼트는 혼자 완결("아까 본 것처럼" 금지).

### 2-1. 사용자 지정 기능의 배치

요청: *"Clay는 Pin과 cycle, Slate는 두 경로의 intent 생성과 example 기반 정렬."* 배치는 이렇게 한다:

- **Pin은 ⓐ에서 가르친다.** Pin(§3.5)은 **양 조건 공통** 셸 기능이다. ⓒ에서만 가르치면 Slate가 첫 블록인 절반이 핀을 모른 채 25분을 시작한다 — 공통 기능은 공통 세그먼트에서 가르치는 것이 셸 패리티다. **ⓒ는 핀을 사이클 안에서 실제로 쓴다**(고치는 질문을 선반에 고정하고 Apply마다 들여다본다) — 가르침은 ⓐ, 체득은 ⓒ.
- **Slate의 Examples는 ⓑ에서만.** 예시 집합·정렬은 SCORE 전용 표면이라 ⓒ에 대응물이 없고, 이 비대칭은 조작의 일부다(숨기지 않는다).
- **cycle(쓰기→Apply→확인→Save)은 양쪽 다** 보여 준다 — 같은 동사 행(Apply·Save·↺)이 양 arm의 에디터에 있다(설계 §3.3). ⓒ는 사이클을 **두 번** 돌려 "수정은 항상 문서 전체·전 질문에" 적용된다는 사실을 화면이 말하게 한다.

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
| 구조 | 같은 7비트 수, 비트별 길이 차 ≤ 3 s, 전체 ≤ 15 s(목표 7 s) |
| 재료 | 같은 앵커 질문(P19 · 2 "how do you spell exaggeration"), 같은 두 관찰, **같은 rule 문장**(ⓑ는 두 intent의 Then으로, ⓒ는 한 문서의 두 문단으로 — 이 재배치가 조작 그 자체) |
| 타이핑 | **양쪽 다 화면에서 실시간 타이핑.** AI가 써 주는 것이 없으므로 타이핑이 곧 콘텐츠다 — 속도를 맞춘다(분당 ~200타). 긴 문장은 리허설로 손에 익힌다 |
| 대기 | 판정 스트리밍·응답 스트리밍은 **자르지 않는다**(도구의 실제 속도가 이 버전의 주장이다). 5 s를 넘는 구간만 ≤2 s로 |
| 내레이션 | 문장 골격 동일, 명사만 교체(intent/rules · 소속/전체). 단어 수 ±5% |
| 금지어 | 전과 동일: SCORE/baseline/treatment/Prolific/비교급·가치어/이름 뜻/기준. **ⓒ 음성·화면에 "intent" 금지**(보드가 렌더하지 않는 것을 확인함) |
| LLM 산출물 | 버전 이름·intent 제목은 **매런 다르다** — 내레이션이 특정 이름을 읽지 않는다("the tool names it for you" 수준) |

**7비트 대응표**

| # | ⓑ Slate | ⓒ Clay | 길이 |
|---|---|---|---|
| 1 | 왼쪽 열: intent 리스트(위→아래), 맨 아래 Uncategorized | 왼쪽 열: Rules 문서 하나 + 아래 버전 자리 | ~15 s |
| 2 | 단어 질문 열고 원래 응답 확인 | 단어 질문 열고 원래 응답 확인 | ~15 s |
| 3 | **경로 ②**: 행의 `+` → 그 자리 폼(Started from·Starter sets 점) → When·Then 타이핑 → Add | **Pin**: 선반에 고정 → RULES에 첫 문단 타이핑 | ~30 s |
| 4 | 판정 스트리밍 → 소속 칩 → intent 열기: **Examples**(시드) + 정렬 + 헤더의 definition | **사이클 1**: Apply → "Working out this reply under …" → 새 응답 → 핀된 행에서 확인 | ~30 s |
| 5 | **Examples 다듬기**: 예시 추가(정렬만 바꾼다) → **Least like these** → 경계 읽기 → When 고쳐 Apply(±diff) | **사이클 2**: 성격 다른 질문(에세이 요청) 열기 → 같은 문서가 여기도 답한다 → 둘째 문단 덧붙여 Apply | ~35 s |
| 6 | **경로 ①**: `+ New intent` → 타이핑 → Add → **모델 예시 3**(Rewrite) → 제목이 저절로 | Save → 버전 리스트(이름·시각) → 뷰어에서 **버전별 응답 열람**(Original 포함) | ~30 s |
| 7 | Save → 버전·카드 히스토리 → **Deploy** → Deployed vN → I'm done | **Deploy** → Deployed vN → I'm done | ~15 s |

비트 4·5의 내용이 갈리는 것(Examples vs 두 번째 사이클)은 조작이 표면에 드러나는 자리다 — 길이만 맞추고 내용은 각자의 사실을 중립적으로 말한다.

## 5. 어휘 — 화면 라벨 (2026-08-22 채집, 촬영 당일 재확인)

**공통**: Chatbot Studio · Slate/Clay · Your task · `n / 25 min` · Not deployed yet / **Deployed vN** / Changed since vN · Deploy · I'm done · All questions · `n of 103` · Search questions · Conversation · *Pick a question to see the conversation.* · **Keep this one in view** / Stop keeping this one here · **Kept in view** · *Stays here whatever you have selected* · `n kept above` · show/hide pasted text · **This reply is under [ ]** / **Working out this reply under [ ]** · **Original (as delivered)** · *— nothing here has been changed yet* · **Now (unsaved) · {LLM 이름}** · Apply · Save · ↺(Undo) · Version history · Revert

**ⓑ만**: `+ ○ New intent`(리스트 행) · **Start an intent — read before "{현 소유자}"**(행 호버 `+`) · *Read before "Uncategorized".* · *Started from: "{질문}"* · WHEN A QUESTION… (`asks for…`) · THEN (*What the chatbot should do with those questions.*) · **Starter sets** ▾ (*● the question you started from is in this set*) · Add / Cancel · Uncategorized · *working out where questions go* · 소속 칩(● 색점+이름) · **Examples** · *The list below is ordered by these* · **Rewrite** · **Use as an example — it orders the list, it does not move the question**(행 호버 ✨) · **Most like these / Least like these** · ↑ ↓(순서) · 🗑(삭제) · ✏(제목)

**ⓒ만**: RULES · `n / 8000` · *What the chatbot should do, in your own words.* · *Saved versions will appear here.*

## 6. 촬영 형식 (전과 동일한 것은 생략)

- 1920×1080 · F11 전체화면 · 줌 100% · 커서 하이라이트 · 무음 녹화 + 별도 VO.
- **프로덕션 빌드 필수** — dev는 "N" 배지가 프레임에 박히고 첫 화면마다 컴파일로 멈칫한다.
- 계정은 `Run demo · Simple SCORE` / `· Simple Baseline` — 헤더 `Participant DEMO`, 경과 0분부터.
- **한 세그먼트 한 테이크**(경과 칩 단조 증가). 판정·응답 스트리밍은 살린다(§4).

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
| Slate에서 경계 질문이 안 잡히거나 이상한 것이 잡힌다 | **그대로 둔다** — "이 문장이 이걸 잡았네"는 이 보드가 보여 주기로 한 사실이고, When을 고쳐 Apply하는 것이 곧 비트 5다. 잡힌 것이 전부 맞으면 Least like these에서 경계를 읽는 쪽으로 |
| 판정·응답이 예상보다 느리다 | 5 s 초과 구간만 컷. 반복되면 촬영 전 같은 워크스페이스에서 한 번 예열(캐시가 텍스트 키라 같은 문장은 히트) |
| Deploy가 Save 직후 비활성 | 2026-08-22 수정 완료(리로드 없이 활성화) — 재발하면 촬영 중단하고 버그로 |

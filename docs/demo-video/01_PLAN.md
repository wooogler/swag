# 데모 영상 기획 — Chatbot Studio 워크스루 (Slate / Clay)

> 작성 2026-08-19. 설계 근거는 `docs/SCORE_USER_STUDY_DESIGN.md` §5.1(튜토리얼 = 데모 영상 3편), §3.1(명칭), §6.1(진행자 발화), §13(불변식). 촬영 재료는 `/study/admin/curation?ds=nirvana`에서 격리한 **NIRVANA 학생 20명 · 103문항**의 데모 워크스페이스(`Run demo · SCORE` / `Run demo · Baseline`)다.
>
> 이 폴더의 문서: `01_PLAN`(이 문서) → `02_SCENARIO`(데모 유저의 생각·재료·입력 원문) → `03/04/05_SCRIPT_*`(세그먼트별 샷리스트 + 내레이션, AV 스크립트) → `06_NARRATION`(보이스오버 녹음용 원고만 모은 것) → `README`(촬영 런북·체크리스트·발행). 참고 스크린샷은 `shots/`(2026-08-19 기준 화면 — UI는 촬영 전까지 바뀔 수 있으니 **라벨은 촬영 당일 화면을 기준**으로 한다).

---

## 1. 이 영상이 하는 일

참가자는 세션에서 **두 버전(Slate / Clay)을 모두** 쓴다. 각 블록의 작업 전에 이 영상을 보고, 도구가 **어떻게 동작하는지**(어디에 무엇이 있고, 무엇을 누르면 무엇이 일어나는지)를 배운다. 영상은 **한 사이클** — 질문을 읽고 → 질문 묶음을 만들고 → 챗봇의 응답 방식을 고치고 → 미리 보고 → 배포 — 을 끝까지 보여 준다.

영상이 **하지 않는** 일:

- 두 버전을 비교하거나 한쪽을 추천하지 않는다. 이름(Slate/Clay)의 뜻을 설명하지 않는다.
- 도구의 모든 기능을 훑지 않는다. 다만 **rule을 바꾸는 세 경로는 전부 다룬다**(§4-1) — 안 가르친 경로는 "우연히 발견했는가"가 측정값에 실린다.
- "좋은 설정"이 무엇인지, 몇 개를 읽고 몇 개를 고쳐야 하는지 말하지 않는다(경계만, 기준은 말하지 않는다 — §5.2).
- 스터디 절차(블록 테스트·설문·인터뷰)를 다루지 않는다. 영상의 대상은 **시스템**이다. 참가자용 UI 중 보드 위에 있는 것(브리핑 모달 "Your task", 경과 시간 칩, Deploy, "I'm done")은 참가자가 실제로 보는 프레임이므로 그대로 담되, 절차 설명은 진행자 발화(§6.1)에 맡긴다.

## 2. 모듈 구조 — 3편, 순서가 섞여도 되게

카운터밸런싱 때문에 참가자마다 Slate가 먼저일 수도 Clay가 먼저일 수도 있다. 그래서 **세그먼트를 독립 모듈로** 만든다(`src/lib/study/config.ts` `demoSegmentsFor`).

| 세그먼트 | 내용 | 목표 길이 | 재생 시점 |
|---|---|---|---|
| ⓐ **Getting around** (공통) | 브리핑 모달 → 가운데 질문 목록·검색·정렬 → 오른쪽 대화 뷰어 → 왼쪽 네 유형 → 헤더(경과 시간·Deploy) | **60–75 s** | 블록 1 (자기 버전 세그먼트 앞에) |
| ⓑ **Slate** | 왼쪽 열 소개 → 보고 있는 질문으로 **intent** 만들기 → 교정(out) → Update definition → Save → Edit Rule → **피드백**으로 rule 제안 → 예제 추가(Preview across intent) → **Rewrite**로 두 번째 수정 → Save rule → Deploy | **160 s ± 7** | 블록 1 또는 2 |
| ⓒ **Clay** | 왼쪽 열 소개 → 보고 있는 질문으로 **filter** 만들기 → 설명 수정 → Run → Save filter → Revise rules → **피드백**으로 rules 제안 → 예제 추가(Preview across the log) → **Rewrite**로 두 번째 수정 → Save rules → Deploy | **160 s ± 7** | 블록 1 또는 2 |

- 블록 1 = ⓐ + 자기 버전 세그먼트(약 4분). 블록 2 = 다른 버전 세그먼트만(약 2.7분). 설계 §5.1의 예산(블록 1 ~4분 / 블록 2 ~3분) 안이다.
- **ⓑ와 ⓒ의 길이 차는 15초 이내**(§5.1). 각 비트(beat)의 길이도 맞춘다 — 아래 §4.
- **런마다 달라지는 것에 대본을 걸지 않는다.** intent 멤버십·후보 이름·제안 문구는 전부 LLM이 정하므로 특정 질문 이름을 대본에 박으면 그 질문이 안 나오는 런에서 촬영이 막힌다(2026-08-19에 실제로 막혔다). 대본은 **자리**로 말한다 — "탭 2", "체크 안 된 첫 행" — 그리고 칠 문구는 `02_SCENARIO` §4-1에서 고르거나 리허설에서 미리 적는다.
- 각 세그먼트는 **혼자서 완결**되어야 한다: "아까 본 것처럼"이나 "다른 버전에서는"이라는 말을 쓰지 않는다(어느 쪽이 먼저 재생될지 모른다).

### ⓐ는 두 번 찍는다 (같은 내레이션, 보드만 다르게)

ⓐ의 주제는 가운데·오른쪽 열(두 버전이 문자 그대로 같은 화면)이지만, **왼쪽 열은 모든 프레임에 들어간다.** 한 버전의 보드에서만 찍으면, 첫 블록이 다른 버전인 참가자 절반이 첫 1분 동안 **다른 팔의 왼쪽 열**(intent 트리 또는 Rules 패널)을 보게 된다 — 블라인딩·프라이밍 문제. 그래서:

- **화면 녹화는 Slate 보드에서 한 번, Clay 보드에서 한 번**(같은 클릭, 같은 순서).
- **보이스오버는 한 번만 녹음**해서 두 녹화에 똑같이 얹는다 — 교육은 글자 그대로 같다.
- 업로드는 두 개 id → `.env`의 `NEXT_PUBLIC_STUDY_DEMO_COMMON_SCORE` / `…_COMMON_BASELINE`(2026-08-19에 추가; `…_COMMON` 하나만 두면 둘 다 그것을 쓴다). 블록 1은 곧 열 보드에서 찍은 테이크를 튼다.

## 3. 한 가지 이야기, 두 가지 도구 — 시나리오 요약

자세한 것은 `02_SCENARIO.md`. 요지는:

- **데모 유저**: 이 수업(에세이 과제 "Intelligent Machines")의 교수자. 학생–챗봇 로그를 처음 훑는다.
- **알아챈 것**: Planning 유형에 **짧은 단어 질문**이 여럿 있다 — 철자("how do you spell exaggeration"), 동의어("give me a synonym for the nuclear option"), 뜻에 맞는 단어, 용법("when is i.e. used"). 챗봇의 답은 들쭉날쭉하다 — 한 단어만 주기도 하고(P29), 한 문단을 쓰기도 한다(P56).
- **하고 싶은 것(사무적·형식 규칙)**: *"이런 질문엔 한두 줄로 — 단어나 철자, 그리고 짧은 예문 하나. 문단은 쓰지 말 것."* 교육 철학이 실리지 않은 형식 규칙이다(§5.1 "데모 rule의 내용은 사무적인 것").
- **같은 이야기를 두 버전에서 같은 순서로** 한다. 다른 것은 도구의 명사(intent/filter, rule/rules, Preview across intent / Preview across the log)와 3번째 비트의 도구(Slate: 교정→Update definition / Clay: 설명 수정→Run)뿐이다.
- 재료는 **데모 세트 안에만** 있다(P19·P29·P38·P56). 이 subtype(Word Choice·Spelling/Grammar Q&A)은 참가자 검토 세트(NIRVANA review: Word Choice 1개)에 거의 없다 — 데모가 실전 재료에 그대로 적용될 수 없다는 §4-1의 취지에 맞는다.

## 4. 패리티 규칙 (ⓑ vs ⓒ) — 편집 때 지킬 것

| 축 | 규칙 |
|---|---|
| 구조 | 같은 7비트, 같은 순서(아래 표). 비트별 길이 차 ≤ 3 s, 전체 ≤ 15 s |
| 재료 | 같은 앵커 질문 **P19 · Turn 2**(양쪽 다 뷰어의 `Revise rule ›`/`Revise rules ›`로 들어가므로 보장된다), 같은 피드백 문장(비트 5). **비트 6의 Rewrite 대상은 탭 2 — 질문 정체는 양쪽이 다르고, 그 차이가 곧 조작 변인이다**(`02_SCENARIO` §4-1) |
| 제목 | 두 버전 모두 묶음 이름을 **"Word lookups"**로 고쳐 입력(Title/Name 필드가 편집 가능함을 보여 주면서 이름을 맞춘다) |
| 내레이션 | 문장 골격 동일, 명사만 교체. 단어 수 ±10% |
| 대기 시간 | LLM 대기(후보 생성·판정·제안·프리뷰)는 **같은 단계에 같은 길이**로 자른다(각 ≤ 2 s). 한쪽만 길게 기다리는 것처럼 보이면 그 자체가 차이가 된다 |
| 자막·타이틀 | 2초 타이틀 카드만(세그먼트 라벨과 같은 글자: "Getting around" / "Slate" / "Clay"). 본문 자막 없음 — 넣는다면 두 편에 같은 자리·같은 문구(명사만 교체) |
| 커서·템포 | 같은 커서 하이라이트, 같은 말 속도, 같은 마이크·세션에서 녹음 |

### 4-1. rule을 바꾸는 세 경로 — 전부 다뤄야 하는 이유

시스템에는 rule을 바꾸는 길이 셋이고, **셋 다 양 조건에 조건 분기 없이** 있다(2026-08-19 확인).

| | 진입 | 무엇을 하나 | 영상에서 |
|---|---|---|---|
| ① **피드백** | 오른쪽 *"What's wrong with this response?"* | 문제를 **말로 설명** → 3안 제안 | 비트 5에서 **시연** |
| ② **Rewrite** | 응답 헤더 `✎ Rewrite instead` | 응답을 **원하는 대로 고쳐 씀** → 에이전트가 rule 변경을 역추론(확인 단계 경유) | 비트 6에서 **시연** |
| ③ **직접 편집** | rule 상자 클릭 → 에디터 → `Apply edit` | rule 텍스트를 **직접** 씀 | 비트 5 VO에서 **한 절로 지목**(커서만 지나감) |

**왜 ②를 반드시 넣는가.** ① 안 가르치면 쓸지 말지가 "pane 헤더의 작은 버튼을 알아챘는가"에 달리고, 그 분산이 주 측정값에 그대로 실린다(설계 §5.2가 과제 배너에 대해 편 논증과 같다 — "초반 헤맴은 RQ1의 신호가 아니라 노이즈"). ② ①은 **원칙을 말하는 것**, ②는 **결과를 보여 주고 원칙을 추론시키는 것**으로 의도 표현의 종류가 다르다 — 한쪽만 가르치면 RQ1이 관찰하는 저작 방식이 부분적으로 영상의 산물이 된다. ③ rewrite는 *한 질문에 대한* 원하는 출력을 시연하는 것이라, Slate에서는 스코프된 rule로 Clay에서는 전역 문서로 떨어진다 — **간섭 기제가 가장 세게 물리는 자리**이므로 여기를 안 가르치면 연구가 자기 가설의 최강 사례를 과소 표집한다.

③(직접 편집)만 시연을 생략하는 이유: rule 상자가 화면 왼쪽에 늘 떠 있고 `✎ Edit`라고 쓰여 있어 발견 비용이 사실상 0이다.

**7비트**

| # | 비트 | ⓑ Slate | ⓒ Clay | 길이 |
|---|---|---|---|---|
| 1 | 왼쪽 열이 무엇인가 | 유형 안의 intent = 설명 + 자기 rule; 어디에도 안 걸리면 유형의 기본 rule | Rules 문서 하나 + 유형 안의 filter = 저장된 검색(rule 없음) | ~8 s |
| 2 | 보고 있는 질문으로 묶음 만들기 | 뷰어 `+ New intent` → 후보(Specific/Broader/Reframed) → Title 수정 → Create intent | 뷰어 `+ New filter` → 후보 → Name 수정 → Create filter | ~20 s |
| 3 | 묶음 다듬기 | 워크벤치: In this intent / Potential → `out` + 이유 → `Update definition` → 검토(before/after) → Apply → `Save` | 워크벤치: In this filter → `Edit` 설명 넓히기 → `Run` → `Save filter` | ~30 s |
| 4 | 보드로 | 트리에 intent · 카운트; 선택 → When/Then 확인 → **질문 열고 `Revise rule ›`** | 트리에 filter · 카운트; 선택 → 질문 목록; **질문 열고 `Revise rules ›`** | ~12 s |
| 5 | 응답 방식 고치기 | 룰 워크벤치: **탭 3개**(anchor + intent 안에서 가장 먼 2개) · 원래 응답 → 피드백 입력 → "Pick how far the revision goes" → Use this rule → 새 응답 | 룰 워크벤치: **탭 3개**(anchor + 로그에서 가장 먼 2개) · 원래 응답 → 피드백 → 3안 → Use → 새 응답 | ~30 s |
| 6 | **Rewrite** + 프리뷰로 확인 | 탭 2에서 **`✎ Rewrite instead`** → 응답 고쳐 쓰기 → 확인 단계 → Use → `Add example`(Preview across intent) 훑기 → `Save rule` | 탭 2에서 **`✎ Rewrite instead`** → 응답 고쳐 쓰기 → 확인 단계 → Use → `Add example`(Preview across the log) 훑기 → `Save rules` | ~32 s |
| 7 | 보드 확인 → 배포 | intent의 rule 표시, 뷰어 "This reply is under the rule v2" → `Deploy` → "Students receive v1" → `I'm done` 등장 | Rules 패널에 문서, 뷰어 동일 → `Deploy` → 동일 | ~12 s |

## 5. 어휘 — 영상(음성·화면)에 들어가면 안 되는 것 / 들어가는 것

**금지** (§6 문구 원칙, §13 불변식 2·7)

- `SCORE`, `baseline`, `treatment`/`control`, `Prolific`, 연구팀·논문 언급.
- ⓒ(Clay) 영상 안에서 "intent"라는 단어 — 음성·자막·화면 어디에도. (Clay 보드는 렌더하지 않는다; 내레이션이 쓰지 않으면 된다.)
- "first/second version", "the other version", "the new one".
- 가치어: better, easier, smarter, powerful, simple, flexible, precise 등. 비교급 전부.
- Slate/Clay 이름의 뜻. 물으면 *"They're just labels so we can tell the two apart."*
- 기준(criterion): "read a few", "make two or three", "a good rule looks like…".

**사용** — 화면의 라벨을 **글자 그대로**: Chatbot Studio · Slate/Clay, Your task, Deploy, New intent / New filter, Create intent / Create filter, In this intent / In this filter, Potential questions, Update definition, Save, Edit Rule, Revise rules, Add example, Preview across intent / Preview across the log, Use this rule, Save rule / Save rules, Students receive v1, I'm done. 공통 발화에서는 "setup"/"configuration"(진행자 발화와 같은 중립어).

## 6. 촬영 형식

- **해상도** 1920×1080, 30 fps, 브라우저 **전체화면(F11)** — 주소창·탭·북마크가 프레임에 없다. 줌 100%(세 열이 다 들어가는지 확인; 글자가 작아 보이면 110%까지 시험).
- **서버는 프로덕션 빌드로**(`README` §2). 개발 서버는 (1) 처음 여는 화면마다 컴파일로 멈칫하고 (2) 왼쪽 아래 **"N" 개발 배지**가 프레임에 찍힌다.
- **계정은 데모 참가자** — 헤더에 `Participant DEMO`, 경과 시간 칩은 0분부터(Run demo가 시계를 새로 시작한다). 연구자 UI(뒤로가기 화살표·버전 드롭다운·리뷰 모달)는 데모에 없다(2026-08-19 정리).
- **오디오**: 화면 녹화는 무음, 보이스오버는 따로 녹음해서 편집에서 맞춘다(패리티를 맞추기 쉽다). 시스템 소리 없음.
- **커서 하이라이트** 켜기(참가자는 클릭을 따라온다). 클릭 소리 없음.
- **편집**: 대기는 자른다(§4), 줌인·화살표 같은 후처리는 최소(넣으면 두 편에 동일하게). 마지막 프레임에 2초 홀드.

## 7. 산출물과 발행

1. 파일 4개: `getting-around-slate.mp4`, `getting-around-clay.mp4`, `slate.mp4`, `clay.mp4`.
2. YouTube **Unlisted**(검색 불가, 링크로만), 임베드 허용, 챕터·엔드스크린·카드 없음. 제목은 화면 라벨과 같게("Getting around", "Slate", "Clay"), 설명란 비움.
3. `.env`: `NEXT_PUBLIC_STUDY_DEMO_COMMON_SCORE`, `…_COMMON_BASELINE`, `…_SCORE`, `…_BASELINE` = 각 영상 id(`?v=` 뒤). 서버 재시작(`NEXT_PUBLIC_`은 빌드 타임).
4. `/study/session`(not_started · break)의 TutorialStep에서 재생 확인 — youtube-nocookie 임베드, `rel=0`. Zoom 공유 시 "컴퓨터 소리 공유" ON(§5.1).

## 8. 알려진 위험과 대응

| 위험 | 대응 |
|---|---|
| LLM 출력이 매번 다르다(후보 이름, 판정 수, 제안 문구) | `02_SCENARIO` §5 분기표: 각 비트의 "계속 진행해도 되는 조건"과 대체 경로. 안 맞으면 그 비트만 재촬영 |
| 제안 에이전트가 요청하지 않은 장치("visibly incomplete example", 빈칸 `___`)를 끼워 넣을 수 있다 | 그대로 두어도 된다(도구의 실제 동작). 화면의 응답이 이상하면 `Edit`로 rule 문구를 손보거나 피드백을 다시 보낸다. 내레이션은 특정 문구에 의존하지 않게 썼다 |
| 개발 서버 컴파일 멈춤 | 프로덕션 빌드, 또는 촬영 전 전 경로를 한 번 밟아 워밍업 |
| 헤더 `n / 25 min`이 테이크마다 다르다 | Run demo마다 0에서 시작. 비트 사이를 자르면 숫자가 튈 수 있으니 **한 세그먼트는 한 테이크로** 끝까지 찍는 것을 기본으로 하고, 실패하면 Run demo부터 다시 |
| UI가 촬영 전까지 바뀐다 | 스크립트는 라벨을 인용하므로 촬영 당일 `README` §5 체크리스트로 라벨을 대조한다 |

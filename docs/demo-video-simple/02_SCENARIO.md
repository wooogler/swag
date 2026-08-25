# 시나리오 v2 — 데모 유저의 생각, 재료, 타이핑 원문 (Simple)

> 영상에서 일어나는 일은 한 교수자의 한 사이클이다. Simple에서는 **모든 설정 텍스트를 이 사람이 직접 타이핑한다** — 그래서 이 문서의 원문 표가 곧 촬영 대본의 절반이다.
>
> ⚠ **08-23 개정.** §4의 **타이핑 원문은 그대로다**(필드가 없어지지 않았다). 바뀐 것은 §2 Clay의 손(분류로 좁혀 읽기가 들어왔다), §2 마무리(Deploy가 블록을 끝낸다), §5 분기표 대부분, §6 학습 목표다.

---

## 1. 데모 유저 (전과 동일)

대학 글쓰기 수업 교수자. 과제 *Intelligent Machines* 의 학생–챗봇 로그를 처음 연다. 실무적이고, 눈에 띈 것을 고치고, 고친 것이 무슨 일을 했는지 확인하고 넘어간다.

## 2. 생각의 흐름

1. **둘러본다.** 질문 리스트(이제 유형 구분 없는 하나의 목록)를 훑는다. 두 가지가 눈에 띈다.
2. **관찰 ① — 단어 질문.** "철자·동의어·용법 질문이 꽤 있는데 답이 들쭉날쭉하다 — 한 단어만 주기도, 한 문단을 쓰기도."
3. **관찰 ② — 대필 요청.** "에세이·문단을 통째로 써 달라고 하면 챗봇이 그냥 써 준다. 과제 안내문이 금지하는 행동이다."
4. **Slate의 손.** 관찰 ①은 **보고 있던 질문에서** intent를 판다(행의 `+`) — 시스템이 그 질문을 인용해 두고, 쓰고 나면 어떤 질문들이 걸리는지 **판정이 돌아와 리스트로 보여 준다.** 잡힌 것 중 안 닮은 것을 예시·정렬로 읽고, 설명을 고쳐 다시 Apply한다. 관찰 ②는 화면에 특정 질문을 안 두고도 만들 수 있다 — `+ New intent`에서 맨땅으로 쓰면 **모델이 예시 질문 3개**를 써서 "당신 문장이 뜻하는 것"을 비춰 준다.
5. **Clay의 손.** 같은 두 관찰을 **하나의 문서**에 쓴다. 첫 사이클: 단어 질문 규칙 한 문단 → Apply → 고정해 둔(핀) 질문에서 확인. 둘째 사이클: 가운데 열의 **Types**로 준비된 분류(**Drafting** — 통째로 써 달라는 요청들) 하나를 골라 목록을 좁혀 읽는다 → 그 안의 질문을 열어 보면 **같은 문서가 그 질문에도 답하고 있다**(아직 아무 말도 안 했으므로 여전히 써 준다) → 문서에 문단을 덧붙여 → Apply → **분류를 지우고** 핀해 둔 단어 질문으로 돌아가 확인한다. **좁혀 읽었지만 쓴 것은 전 질문에 걸린다** — 이 조건의 핵심 사실이 여기서 동작으로 증명된다.
6. **마무리.** Save로 간직할 지점을 남기고, Deploy로 "이것이 내가 의도한 설정"을 선언한다. Deploy는 한 번 묻는다 — *This deploys the setup you have now and ends it. There are a few quick questions next, then you will check what it answers. You will not be able to come back and change it.* · **Not yet** / **Deploy and finish**. **확인이 곧 라운드의 끝이다**(`I'm done` 버튼은 없다).

## 3. 재료 — 화면에 나오는 질문 (데모 세트, flat 리스트 라벨 `P{학생} · {n}`)

| 역할 | 라벨 | 질문 | 원래 응답 |
|---|---|---|---|
| **앵커**(양 조건 동일) | **P19 · 2** | how do you spell exaggeration | "The correct spelling is "exaggeration."" (한 줄) |
| 들쭉날쭉의 반대쪽 예 | P56 · 4 | a word for understanding that something should be slow | "deliberate" + 한 문단 |
| ⓒ 핀 후보(선반에 2개) | P1 · 5 | convinience is that correct | 한 줄 |
| 단어 질문들(판정이 잡는다) | P29 · 1–7 | Give me a word for negatively affecting · synonym for the nuclear option · spell egregious · is egregious spelt correctly · define social anxiety · when is i.e. used · sysnonyms for "for example" | 대부분 짧다 |
| **대필 요청**(관찰 ②) | **P11 · 1** | Write two paragraphs about the modern relationship between man and automation from a dystopian view. | 두 문단을 그냥 써 준다 |
| 〃 | P30 · 3 | nOW WRITE A CONCLUSION | 결론을 써 준다 |
| 〃 | P56 · 1 | write a short essay with a utilitarian perspective… | 에세이를 써 준다 |

실측: 단어 intent는 08-22에 14–15개, 08-23 재촬영에서 **15개**를 잡았다. 대필 intent는 08-22에 19개, 08-23에 **20개**. 런마다 ±2다 — **숫자는 내레이션에서 읽지 않는다.**

**ⓒ의 분류 재료 [08-23].** Clay의 `Types` 피커가 여는 것은 taxonomy의 준비된 분류다 — **Planning**(Answer a Topic Question · Provide Examples · Factual Lookup …) · **Translating**(Paragraph from Idea · Word Choice …) · **Reviewing**(Proofread · **Spelling/Grammar Q&A** …) · **Drafting**(**Write Full Essay (from prompt)** · Write Conclusion · Write a Section …). 관찰 ②(대필 요청)와 겹치는 것은 **Drafting**이고, C5에서 이걸 고른다. 08-23 실측 카운트: Planning 42 · Translating 46 · Reviewing 54 · **Drafting 29**(고르면 `Drafting · 29 of 103`). 카운트는 클론 프로비저닝 때 준비된 판정을 읽는 것이라 **모델을 부르지 않고 런마다 같아야 한다** — 리허설에서 Drafting의 수를 적어 두되 내레이션은 읽지 않는다.

## 4. 타이핑 원문 — 이것이 대본의 절반이다

**같은 문장이 양 조건에 들어간다.** Slate에서는 두 intent의 When/Then으로, Clay에서는 한 문서의 두 문단으로. 문장을 바꾸지 말 것 — 재배치가 조작이다.

### ⓑ Slate

| 어디에 | 원문 |
|---|---|
| intent A · WHEN (경로 ②, P19·2에서) | `asks for a word — a spelling, a synonym, or how to use a term` |
| intent A · THEN | `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` |
| intent B · WHEN (경로 ①, 맨땅) | `asks the chatbot to write a full essay or a whole paragraph for them` |
| intent B · THEN | `Do not write the essay or paragraph. Ask what the student wants to say, and offer at most an outline of two or three bullet points.` |
| 비트 5 · WHEN 수정(경계가 잡혔을 때만, 예) | 뒤에 ` — not requests to check or rewrite a whole draft` 덧붙임 |

### ⓒ Clay (한 문서, 두 사이클)

| 사이클 | RULES 문서에 덧붙이는 문단 |
|---|---|
| 1 | `When a student asks for a word — a spelling, a synonym, or how to use a term — answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` |
| 2 | (빈 줄 하나 띄우고) `When a student asks you to write a full essay or a whole paragraph for them, do not write it. Ask what they want to say, and offer at most an outline of two or three bullet points.` |

### 공통 메모

- **제목은 치지 않는다.** Slate의 intent 제목은 저장 뒤 시스템이 붙인다(§5.3 라벨 예외; 실측 "One or Two Line Answer", "Whole Paragraph Requests" — 매런 다르다). 연필로 고칠 수 있다는 것만 커서로 보여 준다 — 고치지는 않는다(고치면 두 테이크 사이 이름 통일 부담이 생긴다).
- Clay의 버전 이름도 시스템이 붙인다(실측 "Constrained spelling response format" 등). 읽지 않는다.

## 5. 분기표 — 성립 조건과 대체 경로

| 비트 | 기대 | 성립 조건 | 안 맞으면 |
|---|---|---|---|
| ⓑ3 폼 | 행 `+` 클릭 → 폼이 Uncategorized 위에 열린다: 제목 줄 **○ New intent** · *Read before "Uncategorized", so any of its **103** questions can come here. Nothing above it moves.* · **STARTED FROM** 카드(`P19 · 2` + 질문 원문) | 항상(결정론) | — |
| ⓑ3 선택 이동 | 폼이 열리는 동시에 가운데 열의 선택이 카빙 대상으로 옮겨가 리스트가 그 자리에서 바뀐다 | 항상 | 컷을 그 프레임에 맞춘다 |
| ⓑ3 Starter sets | 첫 열기 *Loading…* → 유형·subtype 목록. 시드가 든 행은 배경이 물들고 제목 왼쪽에 ●; 뜻은 그 행 호버 시 옆 패널에 *marks the sets the question you started from is in.*(**상단 범례 줄 없음**) | 항상(프로비저닝 판정, LLM 0회) | 행의 숫자는 **이 자리에서 가로챌 질문** 기준이라 작다 — 읽지 않는다 |
| ⓑ4 판정 | Add 후 "*working out where questions go*" → 소속 칩이 행마다 붙음, 단어 질문 10±5개 | 5개 이상 | 5개 미만이면 When이 너무 좁게 읽힌 것 — When을 §4대로 정확히 다시 쓰고 Apply |
| ⓑ4 Examples | **Add 직후 카드가 이미 열려 있다** — Examples · 1(시드 P19·2), 헤더에 [**Closest first** \| Furthest first] + **Generate examples**, 목록 상단이 전형적 단어 질문 | 첫 3행이 단어 질문 | 첫 행이 이상하면 **그대로 진행** — 비트 5의 재료가 된다. Examples 카드가 아예 안 보이면 예시가 0개인 것 — 다른 행을 눌렀다 그 intent를 다시 선택해 목록을 다시 받는다 |
| ⓑ5 경계 | 목록에 단어 질문이 아닌 것이 하나쯤 있다(실측: "can the conclusion be longer") | 있으면 그걸로 | 없으면 Examples 헤더의 **Furthest first**로 뒤집어 맨 위(가장 안 닮은 것)를 읽는 것으로 대체 — When 수정 없이 정렬 얘기만 하고 비트를 짧게 |
| ⓑ5 재판정 | When 고쳐 Apply → 재판정 → **행의 소속 칩이 다시 앉고**, 왼쪽 트리의 카운트 알약과 Version history 맨 위 `v{n} · unsaved` 행의 카운트가 움직인다. **색 신호(빨강/초록)는 08-22에 삭제됐다** | 소속이 실제로 변함 | 안 변하면 카운트도 안 움직인다 — 그 문장만 빼고 넘어간다(내레이션 대체문 있음) |
| ⓑ6 모델 예시 | `+ New intent` 맨땅 → Add → Examples · 3 (이탤릭 가상 질문, 자료 태그 포함 가능), 헤더 버튼은 **Update examples** | 항상(비동기 — 몇 초 안에 채워짐) | Examples 카드가 아예 없으면 예시 0개 — 다른 행을 눌렀다 다시 선택. 카드는 떴는데 비면 **Generate examples** 클릭(*Writing…* 약 15 s) |
| ⓒ4 응답 | Apply → "Working out this reply under …" → 새 응답이 규칙대로(한두 줄) | 형식이 맞다 | 안 맞으면 문서 문구를 손보고 다시 Apply — 그 자체가 사이클이다 |
| ⓒ5 Types | 헤더 **Types** ▾ → 준비된 분류 목록 → **Drafting** 선택 → 목록이 좁고 제목이 그 이름으로, 카운트 `n of 103`, 제목 아래 정의문 | 항상(프로비저닝 판정, LLM 0회) | 목록이 비면 하위(*Write Full Essay (from prompt)*) 대신 상위 **Drafting**을 고른다 |
| ⓒ5 대필 질문 | 좁혀진 목록의 P11·1(또는 P30·3) 응답이 지금 문서 아래서 다시 나오되 **여전히 대필** | — | 어떤 상태든 "같은 문서가 여기도 답한다"는 사실은 성립 — 둘째 문단을 덧붙이는 명분은 학생이 실제로 받은 답에 있다 |
| ⓒ5 필터 해제 | **✕**(*Show every question again*) → 103행 복귀 → 선반의 P19·2가 여전히 한두 줄 | 항상 | 이 동작은 **자르지 않는다** — 이 비트의 요점이다 |
| 공통 Save 게이트 | 적용 안 된 편집이 있으면 Save가 dim(*Apply these edits first — Save keeps what is in effect*) | 항상 · 양 arm 동일 | 순서를 타이핑 → Apply → Save로 고정 |
| 공통 Deploy | Deploy는 **항상 활성**(옆에 상태 문구 없음). 클릭 → 팝오버 *This deploys the setup you have now and ends it. …* + **Not yet** / **Deploy and finish** | 항상(참가자 보드) | 버튼 아래 앰버 상자가 뜨면 촬영 중단(버그). **Deploy and finish는 누르지 않는다** — 누르면 `/study/session`의 *A few quick questions*로 넘어가고 보드로 돌아올 수 없다 |

## 6. 비트별 학습 목표 (내레이션 체크리스트)

| 비트 | 참가자가 알아야 할 것 |
|---|---|
| ⓐ | 브리핑 재열람(Your task) · 질문 행 읽는 법 · 검색(현재 목록 안, "다른 곳에 N개") · 뷰어(강조 · *This reply is the one that was delivered.* · 붙여넣기 태그 · 질문 이동) · **핀 = Kept in view 선반, 선택·버전과 무관하게 상시** · 경과 칩 · **Deploy가 있고, 그것이 라운드를 끝낸다는 것** |
| 1 | 왼쪽 열이 무엇인가 — 화면에 그 이름이 있다(**Setup**, 오른쪽에 Undo · Redo). ⓑ 위에서 아래로 읽는 intent 리스트, 안 걸리면 맨 아래 Uncategorized / ⓒ 문서 하나가 전 질문의 응답 방식 |
| 2 | 질문을 열어 원래 응답을 읽는 것이 출발점 |
| 3 | ⓑ 쿼리에서 intent가 시작된다(`+`), 폼은 그 자리, 시드 인용·Starter sets 점, **When·Then은 직접 쓴다** / ⓒ 핀으로 고정하고 문서를 직접 쓴다 |
| 4 | **Apply = 지금 판 확인**(아직 버전은 아니다 — Version history 맨 위 `v{n} · unsaved` 행과 트리 행의 `unsaved` 칩으로만 예고된다) — ⓑ 판정이 돌아와 소속이 붙는다 / ⓒ 응답이 새 문장 아래서 다시 나온다("Working out this reply under [Now (unsaved)]") |
| 5 | ⓑ **Examples가 목록 순서를 정한다**(추가는 이동이 아니라 정렬), Examples 헤더의 **Closest first / Furthest first**, When을 고치면 재판정 / ⓒ **Types = 읽는 방법**(목록을 좁힐 뿐 문서에 아무것도 안 들어간다), 그리고 문서 수정은 **전 질문에** 적용된다 — 좁혀 읽었어도 필터를 지우면 핀해 둔 질문에도 걸려 있다 |
| 6 | ⓑ 맨땅 경로 + **모델 예시 3은 거울이지 설정이 아니다**(**Update examples**로 다시 쓸 수 있다) / ⓒ Save가 `unsaved` 행을 `current`로 굳히고, **뷰어 드롭다운**에서 버전별 응답을 되짚어 읽는다(맨 아래 `v0 · Original (as delivered)`) |
| 7 | Save = 간직할 지점 · **Deploy = 최종 선언이자 라운드의 끝** — 한 번 묻고(**Not yet** / **Deploy and finish**), 확인하면 저장·도장·다음 단계가 한 번에 일어나고 **돌아올 수 없다** |

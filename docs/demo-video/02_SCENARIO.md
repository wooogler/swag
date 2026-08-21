# 시나리오 — 데모 유저의 생각, 재료, 입력 원문

> 영상에서 일어나는 일은 전부 **한 교수자의 한 사이클**이다. 이 문서는 그 사람이 무엇을 보고 무엇을 생각해서 무엇을 누르는지, 그리고 화면에 나오는 재료(실제 학생 질문)와 타이핑할 원문을 모아 둔다. 내레이션은 이 생각을 **2인칭·현재형**으로 풀어 쓴 것이다(`03~05_SCRIPT_*`).

---

## 1. 데모 유저

- **누구**: 대학 글쓰기 수업 교수자. 학생들은 에세이 과제 *Intelligent Machines*("Automation is generally seen as a sign of progress, but what is lost when we replace humans with machines?")를 썼고, 과제 중 수업용 챗봇을 쓸 수 있었다.
- **지금**: 학생–챗봇 대화 로그를 처음 연다. 챗봇이 학생 질문에 **어떻게 답했는지** 보고, 원하는 모습이 아니면 설정을 고치려 한다(= 과제 문구 그대로).
- **성향**: 실무적. 교육 철학을 길게 쓰지 않고, 눈에 띈 한 가지를 고친다. 도구의 제안을 읽고 고른다.

## 2. 생각의 흐름 (이야기)

1. **둘러본다.** "학생들이 뭘 물었나." 질문 목록을 훑고 몇 개 열어 대화를 읽는다. Planning 유형에 짧은 질문들이 눈에 들어온다.
2. **알아챈다.** "단어 질문이 꽤 있네 — 철자, 동의어, 뜻에 맞는 단어, i.e. 용법. 챗봇 답이 들쭉날쭉하다. '나쁜 영향을 주다'의 단어를 물으니 'Undermining' 한 단어만 주고, '느리게 해야 한다는 걸 아는 것'의 단어를 물으니 'deliberate'를 놓고 한 문단을 쓴다."
3. **정한다.** "이런 질문엔 **한두 줄이면 충분**하다 — 단어나 철자, 그리고 짧은 예문 하나. 문단은 필요 없다." (형식 규칙. 무엇을 가르칠지에 대한 입장은 싣지 않는다.)
4. **묶음을 만든다.** 보고 있던 "how do you spell exaggeration"에서 바로 묶음을 만든다. 도구가 이 질문으로부터 설명 후보를 써 준다. 넓은 것을 고르고 이름을 **Word lookups**로 고친다.
5. **묶음을 다듬는다.**
   - *Slate*: 워크벤치가 Planning 질문 전체를 설명에 대 보고 목록을 채운다. 목록에 "Could you help me define 'automation' in terms of machines replacing human jobs?"가 들어 있다 — "이건 단어가 아니라 **과제 주제 개념**을 정의해 달라는 거지." → `out`, 이유를 고른다 → `Update definition`이 결정을 설명에 녹여 다시 쓴다 → before/after를 보고 적용 → Save.
   - *Clay*: 워크벤치가 Planning 질문 전체를 설명에 대 보고 목록을 채운다. 처음 설명이 "철자 정확성"에 치우쳐 3개만 잡힌다 — "동의어·용법도 넣자." → `Edit`로 설명을 넓혀 쓰고 → `Run` → 9개 → `Save filter`.
6. **응답 방식을 고친다.** 묶음의 rule(Slate) / 챗봇의 Rules 문서(Clay)를 연다. 예제 질문과 원래 응답이 보인다. 피드백을 한 문장 쓴다 → 도구가 rule 수정안 셋을 응답 미리보기와 함께 준다 → 하나를 고른다.
7. **이번엔 답을 직접 써 준다.** 열려 있는 다른 탭으로 옮겨 새 응답을 본다 — 형식은 맞는데 아직 원하는 답이 아니다. 이번엔 뭐가 잘못됐는지 설명하는 대신 **원하는 답을 그 자리에서 고쳐 쓴다**(`✎ Rewrite instead`) — 원하는 게 눈에 보이는데 말로 옮길 이유가 없다. 도구가 그 편집을 읽고 *"이게 일반적으로 무엇을 바꾸는 건가"*를 되묻고, 거기서 rule 수정안을 낸다 → 고르기.
7b. **나머지에 무슨 일이 났는지 본다.** `Add example`로 프리뷰를 열어 rule이 답하는 나머지 질문들의 before/after를 훑는다(Slate는 intent 안, Clay는 로그 전체). 마음에 걸리는 게 있으면 예제로 담는다 → 저장.
8. **배포한다.** 보드에서 rule이 자리 잡은 것을 확인하고 Deploy. "Students receive v1."

## 3. 재료 — 화면에 나오는 질문 (데모 세트 안, 전부 Planning 유형)

보드 라벨은 `P{학생} · Turn {n}`(n = 그 학생의 n번째 질문). 텍스트는 로그 원문 그대로(오타 포함).

| 역할 | 라벨 | 학생 질문 | 챗봇의 원래 응답(요지) |
|---|---|---|---|
| **앵커**(묶음을 만드는 질문, 룰 워크벤치의 ★) | **P19 · Turn 2** | how do you spell exaggeration | "The correct spelling is "exaggeration."" (한 줄) |
| In this intent / In this filter에 들어오는 것 | P29 · Turn 2 | give me a synonym for the nuclear option | "Extreme measure" |
| 〃 | P29 · Turn 6 | when is i.e. used | 두 문장 설명 |
| 〃 | P29 · Turn 7 | sysnonyms for "for example" | 4개 목록 |
| 〃 | P56 · Turn 3 | what is a word for understanding how the pacing of something should go | "rhythm" + 한 문단 |
| 〃 | P56 · Turn 4 | a word for understanding that something should be slow | "deliberate" + 한 문단 |
| **경계 — Slate에서 `out` 하는 질문** | **P38 · Turn 1** | Could you help me define "automation" in terms of machines replacing human jobs? | 과제 주제의 개념 정의 (단어 질문이 아니다) |
| 경계(대체) | P29 · Turn 5 | define social anxiety | 정의 한 문단 |
| **Rewrite 대상**(비트 6) | 룰 워크벤치의 **탭 2** — 질문 정체는 런마다 다르다 | (도구가 고른다) | §4-1 참조 |

**룰 워크벤치가 자동으로 여는 탭 3개** (2026-08-19부터 양 조건 동일 — anchor + 그 rule이 답하는 집합에서 가장 먼 2개):

| | 앵커(★) | 나머지 두 탭 | 뽑은 집합 |
|---|---|---|---|
| **Slate** | **P19 · T2** *how do you spell exaggeration* | 런마다 다름 (실측: P38·T1, P29·T5 / 다른 런: P29·T2, P19·T2) | intent가 답하는 질문(좁다) |
| **Clay** | **P19 · T2** *how do you spell exaggeration* | 실측 P24 · T2, P22 · T1 | Rules 문서가 답하는 질문 = 전체 로그 |

**앵커가 양쪽 다 P19 · T2인 것은 들어가는 문을 맞췄기 때문이다** — 뷰어의 `Revise rule ›` / `Revise rules ›`. (인스펙터의 `Edit Rule`로 들어가면 Slate만 *체인이 resolve한* 질문을 앵커로 골라 런마다 바뀐다. 그래서 대본은 뷰어 쪽 문을 쓴다 — `04_SCRIPT_B_SLATE.md` B4 메모.)

**나머지 두 탭의 정체는 대본에 박지 않는다.** Slate 쪽은 intent 멤버십에 달려 있고, 멤버십은 B2의 후보 정의와 B3의 fold(둘 다 LLM)가 정하므로 런마다 바뀐다. Rewrite 대상은 "탭 2"라고만 정하고, 칠 문구는 §4-1에서 고른다. Clay의 두 탭이 anchor와 확 다른 것은 정상이다 — 그 rule이 실제로 답하는 범위가 로그 전체이기 때문이고, 그게 두 조건의 차이가 화면에 드러나는 방식이다.

다른 유형에도 같은 성격의 질문이 있지만(Translating: P29 · Turn 1 "Give me a word for negatively affecting" → "Undermining"; Reviewing: P29 "spell egregious"), 묶음은 **유형 안**에 살므로 Planning 밖은 목록에 나오지 않는다. 내레이션은 이를 설명하지 않는다(한 유형 안에서 이야기가 끝난다).

## 4. 타이핑할 원문 (두 버전 동일 — 복사해 붙여도 된다)

| 어디에 | 원문 |
|---|---|
| 묶음 이름 (Title / Name 필드 덮어쓰기) | `Word lookups` |
| 피드백 1 (룰 워크벤치, 앵커 탭에서 — **경로 ①**) | `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` |
| **Rewrite 원문** (탭 2 · `✎ Rewrite instead` 후 응답을 전부 지우고 — **경로 ②**) | 화면의 질문에 따라 다르다. 모양은 항상 두 줄이고, 문구는 **§4-1**에서 고른다 |
| Rewrite 확인 단계 | 자유 입력란은 **비워 두고** 에이전트가 읽어낸 항목 중 맞는 것 하나를 체크. 셋 다 안 맞으면 자유 입력란에 한 문장(§4-1) |
| Slate · `out` 이유 (제안 중 하나를 고르거나 직접 입력) | 제안 1순위를 고른다. 직접 쓰면: `Asks to define a concept for the essay, not for a word.` |
| Clay · 설명 넓히기 (`Edit` → 전체 교체) | `asks for a word — a spelling, a synonym, a word for a meaning, or how to use a term — for example, "how do you spell exaggeration", "give me a synonym for the nuclear option", or "when is i.e. used"` |
| 후보가 전부 안 맞을 때의 설명 (`Start from scratch`) | 위와 같은 문장 |

### 4-1. Rewrite 원문 — 왜 고정 문자열이 아닌가, 그리고 무엇을 치나

**고정할 수 없다.** Rewrite 대상은 룰 워크벤치의 **탭 2**이고, 그 탭이 무엇인지는 도구가 정한다 — Slate는 *intent 안에서* 앵커와 가장 먼 질문, Clay는 *로그 전체에서* 가장 먼 질문. 그리고 Slate의 intent 멤버십 자체가 LLM 판정(B2의 후보 정의 + B3의 fold)에 달려 있어 런마다 바뀐다. 특정 질문을 대본에 박으면 그 질문이 안 들어온 런에서 촬영이 막힌다 — 실제로 그렇게 막혔다.

**대신 모양을 고정한다.** 두 줄, 옵션 두셋 + 짧은 예문:

```
<옵션1>, <옵션2>, <옵션3>
Example: <옵션1을 쓴 짧은 문장>
```

**ⓑ Slate — 탭 2가 될 만한 질문과 미리 쓴 문구** (전부 이 intent의 단어 질문이다):

| 탭 2가 이것이면 | 이렇게 고쳐 쓴다 |
|---|---|
| a word for understanding that something should be slow | `deliberate, measured, unhurried`<br>`Example: a deliberate pace suits this section.` |
| what is a word for understanding how the pacing of something should go | `pacing, rhythm, cadence`<br>`Example: the rhythm of the argument matters here.` |
| sysnonyms for "for example" | `for instance, such as, to illustrate`<br>`Example: some tools — for instance, an outline — help.` |
| give me a synonym for the nuclear option | `last resort, drastic measure, extreme step`<br>`Example: closing the lab was a last resort.` |
| when is i.e. used | `i.e. means "that is" — use it to restate something more precisely.`<br>`Example: one core skill, i.e., close reading.` |
| 그 밖의 단어 질문 | 같은 모양으로 즉석에서. 옵션 셋, 예문 하나 |

**불만은 항상 같다**: rule이 **단어를 하나만** 준다 — 단어 질문이면 두셋을 보여 주는 편이 낫다. 이 intent의 어느 질문에도 성립한다.

**ⓒ Clay — 탭 2는 로그에서 가장 먼 질문이라 성격이 다르다.** 실측 탭 2는 `P24 · T2 · What could be a Utilitarian view of this issue?`였다. 여기서 불만은 정반대이고, **그게 이 조건의 이야기다**: 단어 질문이 아닌데 전역 rules가 **단어 하나로 답하게 만들고 있다.** 고쳐 쓰기:

```
A utilitarian view weighs total benefit: automation is good if it raises overall welfare.
Example: fewer injuries on the line outweighs fewer jobs on it.
```

탭 2가 다른 질문이면 같은 원칙으로 즉석에서 — **그 질문에 맞는 제대로 된 짧은 답**을 두 줄로 써 준다.

> **확인 단계의 자유 입력**(3개가 다 안 맞을 때): ⓑ `Give two or three options, not just one.` / ⓒ `Only force the short word format on word questions.` — 양쪽 다 체크박스를 쓰거나 양쪽 다 자유 입력을 쓴다.

**묶음 설명은 도구의 후보를 쓴다.** 2026-08-19 런에서 "Broader category" 후보는 Slate에서 *Resolve Word Choice*("asks the chatbot to help select, form, or verify a word before drafting — for example, "How do I spell exaggeration?", …"), Clay에서 *Check Word Form*("asks the chatbot to resolve a word-level correctness question before writing — …")이었다. 이름은 매번 다르다 — 그래서 Title/Name을 `Word lookups`로 덮어쓴다.

**묶음에 들어오는 수**는 런마다 다르다(8/3/6/9가 나왔다). 내레이션은 숫자를 말하지 않는다.

## 5. 분기표 — 각 비트에서 "그대로 가도 되는 조건"과 대체 경로

| 비트 | 기대 | 조건 | 안 맞으면 |
|---|---|---|---|
| 2 후보 | "From this question"에 단어/철자 묶음으로 읽히는 후보가 있다(Specific이 철자, Broader가 단어 선택/형태) | 셋 중 하나가 "word / spelling / vocabulary"를 말한다 | `Start from scratch` → §4의 설명을 붙여 넣는다. 내레이션 "Pick one, adjust…"는 그대로 맞는다 |
| 3 Slate · 목록 | In this intent에 단어 질문 5개 이상 + 경계 1개(P38 T1 또는 P29 T5) | `out` 할 것이 목록에 있다 | 목록이 전부 맞으면 Potential에서 `in` 할 것을 고른다(내레이션 "If something doesn't belong, mark it out…" → "If something's missing, mark it in…"로 한 단어만 바뀜 — 녹음 때 두 버전을 다 읽어 둔다). Potential도 비어 있으면 `Update definition` 없이 Save → 비트 3이 짧아지므로 ⓒ 비트 3도 같이 줄인다 |
| 3 Slate · Update definition | 검토 모달에 "1 of 1 hold in the new text", 적용 후 목록에서 빠짐 | hold | "don't"면 `Edit the result`로 문구 손보고 적용, 또는 Discard 후 다시 `out` |
| 3 Clay · Run | 넓힌 설명으로 매치가 늘어난다(3 → 9) | 수가 늘거나 같다 | 줄어들면 설명을 §4 원문으로 정확히 교체하고 다시 Run |
| 5 제안 | 세 칸(또는 둘) 중 하나가 "한두 줄 + 예문" 형식이고 미리보기 응답이 그렇게 나온다 | Minimal edit 또는 Focused rework가 맞다 | 셋 다 이상하면 같은 피드백을 다시 보낸다(새 제안). 그래도 이상하면 `Edit`로 rule을 직접 §4 취지로 쓰고 `Apply edit` |
| 6 Rewrite 대상 | 룰 워크벤치에 탭이 **3개** 열려 있고 탭 2의 응답이 원하는 모습이 아니다 | 탭이 2개 이상이다 | 탭이 앵커 하나뿐이면(= rule이 답하는 질문이 1개) B3에서 intent가 너무 좁아진 것이다 → B3의 fold를 `Discard proposal`로 물리고 교정 없이 `Save`한 뒤 다시 온다. ⓒ는 스코프가 로그 전체라 이 경우가 없다 |
| 6 Rewrite 문구 | 탭 2가 §4-1 표에 있다 | 표에 있다 | 없으면 같은 모양으로 즉석에서 — **리허설에서 탭 2가 무엇인지 확인하고 문구를 미리 적어 둔다**(README §1) |
| 6 확인 단계 | 에이전트가 읽어낸 항목 3개 중 하나가 맞는다 | 하나라도 맞는다 | 셋 다 안 맞으면 자유 입력란에 §4-1의 한 문장. **양 버전에서 같은 쪽을 쓴다** |
| 7 배포 | "Deployed" → "Students receive v1", `I'm done` 등장 | — | 실패 메시지가 뜨면 메시지를 읽고 다시 Deploy |

## 6. 이 시나리오가 **가르치는 것** (비트별 학습 목표 — 내레이션의 체크리스트)

| 비트 | 참가자가 알아야 할 것 |
|---|---|
| ⓐ | 브리핑(과제·과제문·시작 프롬프트)을 어디서 다시 여는지 · 질문 목록의 한 행이 무엇인지 · 검색과 정렬 · 대화 뷰어(강조된 질문, 붙여 넣은 텍스트 표시, 질문 사이 이동) · 네 유형과 유형 설명 · 경과 시간 · Deploy가 무엇인지 |
| 1 | 왼쪽 열의 객체가 무엇인지(Slate: intent = 설명 + 자기 rule, 기본 rule / Clay: Rules 문서 하나 + filter = 저장된 검색) |
| 2 | 묶음은 **보고 있는 질문에서** 만든다; 도구가 설명 후보를 써 준다; 이름·문구는 고칠 수 있다 |
| 3 | 묶음은 자연어 설명이고, 도구가 로그를 그 설명에 대 본다; 결과를 보고 **설명을 고치는 방법**(Slate: 판정에 표시+이유 → Update definition / Clay: 문구 수정 → Run); Save가 보드에 올린다 |
| 4 | 보드에서 묶음이 어디 보이는지; 응답 방식은 어디서 고치는지(Edit Rule / Revise rules) |
| 5 | 룰 워크벤치: 예제 탭 · 원래 응답 · **경로 ①(피드백)** 한 문장 → 수정안 3단계 · 미리보기 · 고르기 · **경로 ③(직접 편집)이 어디 있는지** |
| 6 | **경로 ②(Rewrite)** — 응답을 고쳐 쓰면 도구가 rule 변경을 역추론하고 무엇을 뜻했는지 되묻는다 · 이어서 프리뷰(Slate: intent 안 전체 / Clay: 로그 전체)로 **고친 rule이 나머지에 무슨 일을 했는지** 확인하고 담는다 · 저장이 무엇을 의미하는지 |
| 7 | 보드에서 결과를 어디서 보는지 · Deploy → Students receive v1 · I'm done |

# ⓑ Slate — 샷리스트 + 내레이션

> 길이 목표 **160 s ± 7**, ⓒ와 15 s 이내. 7비트 구조와 비트별 길이는 `01_PLAN.md` §4. 재료·입력 원문·분기표는 `02_SCENARIO.md`.
>
> 시작 상태: `Run demo · SCORE` → 브리핑 모달에서 **Start**를 누른 직후의 보드(ⓐ와 같은 상태). 가운데는 **PLANNING QUESTIONS · 38**, 오른쪽은 비어 있다. 한 세그먼트는 **한 테이크**로 끝까지 찍는 것을 기본으로 한다(경과 시간 칩이 이어진다).
>
> 참고 스크린샷: `shots/b02_*` ~ `b07_*`.

---

## B0 · 타이틀 카드 (0:00 – 0:02)

- **화면**: 검은 배경에 **"Slate"**. 음성 없음.

## B1 · 왼쪽 열이 무엇인가 (0:02 – 0:18)

- **화면/액션**
  1. 커서를 왼쪽 열로. **PLANNING · No intent yet · No default rule · 38** 머리와 그 아래 점선 버튼 **+ New intent in Planning**을 가리킨다. 네 유형 모두 같은 모양임을 커서가 훑어 보여 준다.
  2. (아직 아무것도 누르지 않는다.)
- **VO**: *"In Slate, the left column is where the setup lives. Inside each type you create intents: an intent is a group of questions you describe in words, and it carries its own rule — how the chatbot responds to those questions. Anything in no intent gets the type's default rule."*
- **메모**: "No default rule" 칩이 VO의 마지막 문장과 맞물린다. `Uncategorized`는 intent가 생긴 뒤에야 보이므로 여기서는 말하지 않는다.

## B2 · 보고 있는 질문으로 intent 만들기 (0:18 – 0:40)

- **화면/액션**
  1. 가운데 **P19 · Turn 2 · how do you spell exaggeration** 클릭 → 오른쪽에 대화. (VO "a spelling, a synonym"에 맞춰 1초 머문다.)
  2. 뷰어 머리의 **+ New intent** 클릭 → 모달 **NEW INTENT** (`shots/b02_new_intent_chooser.png`): 위에 경로 *PLANNING › + new intent*와 한 줄 *"Answers Planning questions no existing intent claims first."*, **THE QUESTION**: how do you spell exaggeration. 왼쪽 **FROM THIS QUESTION**에 후보 셋(예: *Spell Target Word · Specific / Resolve Word Choice · Broader category / Check Language Readiness · Reframed* — 이름은 매번 다르다), 아래 **STARTER INTENTS · PLANNING**, 맨 아래 **+ Start from scratch**.
  3. **Broader category** 후보 클릭 → 오른쪽 **TITLE**과 **WHEN A QUESTION…**이 채워진다.
  4. TITLE을 지우고 `Word lookups` 입력.
  5. **Create intent →** 클릭. (후보 생성 대기 5–10 s는 편집에서 ≤2 s로.)
- **VO**: *"Say you've noticed students asking quick word questions — a spelling, a synonym. With one of them open, click New intent. The tool drafts descriptions from this question — a narrow one, a broader one, a reframed one — and there are starter intents below. Pick one, change the title if you like, and Create."*
- **메모**: 후보가 셋 다 안 맞으면 `Start from scratch` + `02_SCENARIO` §4의 설명(분기표 비트 2).

## B3 · 워크벤치 — 목록 읽기, 교정, Update definition, Save (0:40 – 1:13)

- **화면/액션** (`shots/b03a_intent_workbench.png` → `b03e_after_update.png`)
  1. 전체 화면이 워크벤치로 바뀐다: 머리 **← Board · New Intent — Word lookups**. 왼쪽 **TITLE / WHEN A STUDENT…**(설명) / **Rating the log** 진행 막대 / **HISTORY · Save**. 가운데 **IN THIS INTENT · n**(Most out-like first), 오른쪽 **POTENTIAL QUESTIONS IN THIS INTENT · m**. 진행 막대가 차는 동안 2초(나머지 대기는 컷).
  2. 가운데 목록을 커서로 훑는다 — 단어 질문들 사이에 **Could you help me define "automation" in terms of machines replacing human jobs?**(P38 · Turn 1)가 있다. 행에 커서를 올리면 오른쪽 끝에 **out** 버튼 → 클릭.
  3. 팝오버 **WHY IS THIS OUT?** (*"Becomes a rule in the definition — state the principle, not this one question."*) — 제안 1순위(예: *Requests a concept definition, not a word choice.*) 클릭 (`b03b_mark_out_reason.png`). 행에 *why not: …*이 붙는다.
  4. 왼쪽에 카드 **Your decisions · 1 · 1 don't** (`b03c_decisions_ledger.png`) → 버튼 **Update definition · 1 to teach** 클릭 → 모달 **Update definition — Word lookups · from your 1 decision · 1 of 1 hold in the new text** (`b03d_update_definition_review.png`): 왼쪽 YOUR DECISIONS, 오른쪽 **BEFORE / AFTER — REVIEW & REFINE**(추가된 구절에 밑줄), **What changed: …**, **Also moves: −1 out of 20 questions you didn't rule on ▸**. (대기 10–25 s는 컷.)
  5. **Apply this definition** 클릭 → 모달 닫힘, 목록이 다시 판정되어 그 질문이 빠진다; 카드는 **1 hold** (`b03e_after_update.png`). (대기 컷.)
  6. **Save**(HISTORY 머리) 클릭 → HISTORY에 **v1 · current**.
- **VO**: *"The intent workbench opens. On the left is the description — when a student… The tool reads every question in this type against it: the ones it's confident about go under In this intent, and borderline ones under Potential questions. If something doesn't belong, mark it out and pick a reason — this one asks to define the essay's topic, not a word. Update definition rewrites the description from your decisions; you see before and after, and what else it moves, then apply it. Save puts the intent on the board."*
- **메모**: 목록에 `out` 할 경계 질문이 없으면 분기표 비트 3(Potential에서 `in`; VO 대체 문장은 `06_NARRATION.md`에 함께 녹음해 둔다). **이 비트가 ⓑ에서 가장 길다 — ⓒ의 비트 3(설명 수정 → Run)과 길이를 맞춘다.**

## B4 · 보드로 — intent 선택, Revise rule (1:13 – 1:25)

- **화면/액션** (`shots/b04_board_intent_selected.png`)
  1. **← Board** 클릭 → 보드. 왼쪽 PLANNING 아래에 **Word lookups · n**(수는 런마다 다름)과 그 아래 *Uncategorized*, 점선 **+ New intent in Planning**. 가운데 행 **P19 · Turn 2**에 칩 **Word lookups · No rule**.
  2. 트리의 **Word lookups** 클릭 → 가운데 머리 **WORD LOOKUPS · n**, 인스펙터 **WHEN**(설명) **[Edit Intent]** / **THEN** *No rule yet* **[Edit Rule]**, 그 아래 intent의 질문들. (여기서 커서만 **THEN** 줄을 짚는다 — 아직 안 누른다.)
  3. 가운데 목록에서 **P19 · Turn 2**를 클릭(오른쪽에 대화) → 뷰어 머리의 **Revise rule ›** 클릭.
- **VO**: *"Back on the board, the intent sits under its type with a count, and the questions it covers are tagged. Select it to see its description and its rule — empty so far. To change how the chatbot responds, open a question and click Revise rule."*
- **메모 — 왜 인스펙터의 `Edit Rule`이 아니라 뷰어의 `Revise rule ›`인가.** 둘 다 같은 워크벤치를 열지만 **★ 앵커가 달라진다**: 인스펙터의 `Edit Rule`은 *체인이 resolve한* 질문을 앵커로 고르므로 런마다 바뀌고(실측: P56·T4), 뷰어의 `Revise rule ›`은 **보고 있는 질문이 그대로 앵커**가 된다(실측: ★ P19·T2). ⓒ가 쓰는 문(`Revise rules ›`)과 같은 문이므로 **양 조건의 제스처와 앵커가 같아진다** — 2026-08-19 확정.

## B5 · 룰 워크벤치 — 피드백 → 제안 → 고르기 (1:25 – 1:55)

- **화면/액션** (`shots/b05a_rule_workbench.png` → `b05c_after_use_rule.png`)
  1. 워크벤치 **← Board · Revise rule — Word lookups**. 왼쪽 **WHEN A STUDENT…**(읽기 전용) / **THEN… (RULE · V1)** *Empty — this intent has no rule of its own yet.* / **Apply edit · Save rule**. 가운데 탭 **★ P19 · T2 · ⟨탭2⟩ · ⟨탭3⟩ · + Add example**(앵커 + **이 intent 안에서** 가장 먼 2개 — 두 탭의 정체는 런마다 다르다), **RESPONSE · v1 — Empty rule**: 질문 *how do you spell exaggeration*와 원래 응답(한 줄). 오른쪽 **FEEDBACK & HISTORY**(v1 Starting rule — Empty rule), 아래 **Feedback on: v1 response · P19 · T2**와 입력란 *What's wrong with this response?*.
  2. **탭 2**를 눌러 다른 원래 응답(한 문단짜리)도 1초 보여 주고 **★ P19 · T2**로 돌아온다(응답이 들쭉날쭉함을 화면이 말하게). **이 탭 2가 B6에서 Rewrite할 대상이다** — 지금 어떤 질문인지 봐 둔다.
  3. 입력란에 **피드백 1** 타이핑: `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` → Enter.
  4. 모달 **Pick how far the revision goes · Previewing on P19 · T2** (`b05b_proposal_picker.png`): 세 칸 **MINIMAL EDIT / FOCUSED REWORK / FULL REWRITE**, 각각 **RULE CHANGES**(초록 추가분)와 **RESPONSE UNDER THIS RULE**. (생성 대기 15–35 s는 ≤2 s로.)
  5. **MINIMAL EDIT**의 **✓ Use this rule** 클릭 → 워크벤치로: **THEN… (RULE · V1.1) · not saved yet**에 rule 문장, **RESPONSE · v1.1 — …**에 새 응답(두 줄), 오른쪽 타임라인에 피드백 말풍선 + 제안 카드 + **v1.1 viewing**.
- **VO**: *"The rule workbench opens with a few of the intent's questions as tabs, each with the chatbot's original reply. Say in plain words what's wrong with the reply. The tool proposes revisions of the rule — a minimal edit, a focused rework, a full rewrite — each with the reply it would produce. Pick one, and the rule and the reply update. You can also edit the rule yourself and Apply the edit."*
- **메모**: VO의 마지막 절(직접 편집)을 말할 때 커서를 **왼쪽 rule 상자와 `Apply edit` 버튼** 위로 한 번 지나가게 한다 — 누르지는 않는다. 오른쪽의 힌트 카드(*Not sure what to ask for? A strong rule usually sets these six*)는 가리키지 않는다(양 버전에 같이 있지만 교육 철학이 실린 문구라 내레이션 밖). 제안이 이상하면 분기표 비트 5.

## B6 · **Rewrite**로 두 번째 수정 → 프리뷰로 확인 → Save rule (1:55 – 2:27)

> **순서가 바뀌었다(2026-08-19).** 전에는 "예제 추가 → 두 번째 수정"이었는데, 그러면 **특정 질문이 intent 안에 들어와 있어야** 진행이 됐다. intent의 멤버십은 LLM이 두 번(B2의 후보 정의, B3의 fold) 정하므로 런마다 달라지고, 실제로 `P29 · T6`가 안 들어오는 런이 나왔다. 지금은 **이미 열려 있는 탭**에서 고쳐 쓰므로 어떤 런에서도 성립한다. 프리뷰는 고친 뒤 확인하는 자리로 옮겼는데, 도구가 권하는 순서(고치고 → 전체에 대해 확인하고 → 저장)와도 맞는다.

- **화면/액션** (`shots/b05c_after_use_rule.png` → `b06a_preview_across_intent.png` → `b06d_rule_saved.png`)
  1. **탭 2**를 클릭(B5에서 봐 둔 그 질문). v1.1 rule 아래의 새 응답을 1초 읽는다 — 형식은 맞는데 **단어를 하나만** 준다.
  2. **응답 헤더의 `✎ Rewrite instead` 클릭** → 응답이 편집 가능한 textarea가 되고, 현재 응답이 그 안에 들어 있다.
  3. 내용을 전부 지우고 **원하는 답**을 **두 줄 모양**으로 타이핑 — 옵션 두셋 + 짧은 예문:
     ```
     <옵션1>, <옵션2>, <옵션3>
     Example: <옵션1을 쓴 짧은 문장>
     ```
     화면의 질문에 맞는 실제 문구는 `02_SCENARIO.md` §4-1의 표에서 고르거나, 리허설에서 미리 적어 둔다.
  4. **`✨ Propose rule from my rewrite`** 클릭 → 확인 단계: **What should this change in general?** *It steers the new rule.* — 자유 입력란과 그 아래 *…or confirm what the agent read from your edit:* + 에이전트가 읽어낸 항목 3개(체크박스). (대기 5–15 s는 ≤2 s로.)
  5. 자유 입력란은 **비워 두고**, 읽어낸 항목 중 맞는 것 **하나를 체크** → 버튼이 `Propose anyway` → **`✨ Propose with 1 change`**로 바뀐다 → 클릭.
  6. 제안 모달 → **MINIMAL EDIT · ✓ Use this rule** → **THEN… (RULE · V1.2) · not saved yet**.
  7. 탭 줄의 **+ Add example** 클릭 → 전체 화면 **← Back · Preview across intent — Word lookups · n/n shown**: 왼쪽 **IN THIS INTENT · n**(체크박스, Most different — 열려 있는 탭 3개는 이미 체크), 가운데 **DEPLOYED RULE · not deployed / STUDENT QUESTION / ORIGINAL RESPONSE (as delivered)**, 오른쪽 초록 **NEW RULE · v1.2 / UPDATED RESPONSE**.
  8. 체크되지 않은 행을 **위에서 아래로 두어 개 클릭**해 before/after를 훑는다(어떤 질문이든 상관없다 — 여기서는 "고친 rule이 나머지에 무슨 일을 하는가"만 보여 준다). 마음에 걸리는 행이 있으면 체크 → **Add as examples**, 없으면 **← Back**.
  9. **Save rule** 클릭 → **THEN… (RULE · V2)**, 타임라인에 **v2 · Applied · …**(`b06d_rule_saved.png`).
- **VO**: *"Instead of describing what's wrong, you can rewrite the reply itself: the tool reads your edit, asks what you meant in general, and proposes the rule from that. Add example then shows before-and-after for every question in this intent, so you can see what the change did to the rest — and pull any of them in as another example. Save rule makes it the intent's rule."*
- **메모**: 에이전트가 읽어낸 3개가 전부 안 맞으면 자유 입력란에 한 문장을 친다(분기표 비트 6). **ⓒ와 같은 쪽을 쓴다** — 한쪽만 체크박스, 다른 쪽만 자유 입력이면 그 자체가 차이로 보인다.

## B7 · 보드 확인 → Deploy (2:27 – 2:43)

- **화면/액션** (`shots/b07_board_rule_in_place.png`, `x_deployed_im_done.png`)
  1. **← Board** → 트리 **Word lookups · 6**, 인스펙터 **THEN**에 rule 문장과 칩 **own rule**. 가운데 **P19 · Turn 2** 클릭 → 뷰어 위에 파란 상자 **⟳ This reply is under the rule [v2 · … ▾]**와 새 응답(두 줄); 드롭다운을 열어 **Original (as delivered)**가 있음을 1초 보여 주고 닫는다.
  2. 헤더 **🚀 Deploy** 클릭 → 라벨 **Deployed** → (새로고침 없이) **Students receive v1**, 옆에 파란 **I'm done** 버튼 등장. (**I'm done은 누르지 않는다.**)
  3. 마지막 프레임 2초 홀드.
- **VO**: *"On the board, the intent now has its rule, and any of its conversations can be viewed under it. When you're ready, Deploy sends the setup to the student chat — and an I'm done button appears for the end of the round."*
- **메모**: 마지막 문장(I'm done)은 두 버전 동일. 빼기로 하면 ⓒ에서도 뺀다.

---

## 단어 수·길이

VO ≈ 426 단어 → **160 s ± 7**. 비트별: B1 50 · B2 56 · B3 92 · B4 45 · B5 73 · B6 66 · B7 44. (ⓒ 427 — 1단어 차.)

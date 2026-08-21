# ⓒ Clay — 샷리스트 + 내레이션

> 길이 목표 **160 s ± 7**, ⓑ와 15 s 이내. 7비트 구조와 비트별 길이는 `01_PLAN.md` §4. 재료·입력 원문·분기표는 `02_SCENARIO.md`. **이 영상의 음성·화면 어디에도 "intent"가 나오지 않는다**(§13 불변식 2).
>
> 시작 상태: `Run demo · Baseline` → 브리핑 모달에서 **Start**를 누른 직후의 보드. 왼쪽 **RULES · not deployed** 패널(*"No rules yet — open a question and Revise to write them."*)과 **FILTERS**(네 유형), 가운데 **PLANNING QUESTIONS · 38**, 오른쪽 비어 있음. 한 테이크로 끝까지.
>
> 참고 스크린샷: `shots/c02_*` ~ `c07_*`. **`c05a`는 시드 3개가 들어간 뒤의 화면**(2026-08-19 변경 — 그전 촬영본은 탭이 1개였다).

---

## C0 · 타이틀 카드 (0:00 – 0:02)

- **화면**: 검은 배경에 **"Clay"**. 음성 없음.

## C1 · 왼쪽 열이 무엇인가 (0:02 – 0:18)

- **화면/액션**
  1. 커서를 왼쪽 열로. 위의 **RULES** 패널(빈 상자, *not deployed*, 아래 회색 글 *"Edited in Revise (from a question) · deployed from the top-right."*)을 가리킨다.
  2. 아래 **FILTERS**의 유형 머리 **PLANNING 38**과 점선 버튼 **+ New filter in Planning**을 가리킨다. 네 유형 모두 같은 모양임을 커서가 훑어 보여 준다.
  3. (아직 아무것도 누르지 않는다.)
- **VO**: *"In Clay, the left column is where the setup lives. At the top are the Rules — one document that says how the chatbot responds to every question. Inside each type you create filters: a filter is a group of questions you describe in words, for reading; it carries no rule of its own."*

## C2 · 보고 있는 질문으로 filter 만들기 (0:18 – 0:40)

- **화면/액션**
  1. 가운데 **P19 · Turn 2 · how do you spell exaggeration** 클릭 → 오른쪽에 대화. (1초.)
  2. 뷰어 머리의 **+ New filter** 클릭 → 모달 **NEW FILTER** (`shots/c02_new_filter_chooser.png`): 위에 경로 *PLANNING › + new filter*와 한 줄 *"Finds every Planning question matching this description."*, **THE QUESTION**: how do you spell exaggeration. 왼쪽 **FROM THIS QUESTION**에 후보 셋(예: *Spell Target Word · Specific / Check Word Form · Broader category / Prepare Writing Vocabulary · Reframed* — 이름은 매번 다르다), 아래 **STARTER FILTERS · PLANNING**, 맨 아래 **+ Start from scratch**.
  3. **Broader category** 후보 클릭 → 오른쪽 **NAME**과 **WHEN A QUESTION…**이 채워진다.
  4. NAME을 지우고 `Word lookups` 입력.
  5. **Create filter →** 클릭. (후보 생성 대기는 ≤2 s로.)
- **VO**: *"Say you've noticed students asking quick word questions — a spelling, a synonym. With one of them open, click New filter. The tool drafts descriptions from this question — a narrow one, a broader one, a reframed one — and there are starter filters below. Pick one, change the name if you like, and Create."*
- **메모**: 후보가 셋 다 안 맞으면 `Start from scratch` + `02_SCENARIO` §4의 설명.

## C3 · 워크벤치 — 목록 읽기, 설명 넓히기, Run, Save filter (0:40 – 1:13)

- **화면/액션** (`shots/c03a_filter_workbench.png` → `c03c_after_run.png`)
  1. 전체 화면이 워크벤치로 바뀐다: 머리 **← Board · New Filter — Word lookups · ● in Planning**. 왼쪽 **NAME / WHEN A QUESTION…**(설명, 아래 ✎ Edit) / **Run · Save filter** / 회색 글 *"Collects every Planning question that matches this description. Read them to decide what to write in your rules."* 가운데 **IN THIS FILTER · n**(Newest). 오른쪽 열은 비어 있다. 첫 Run은 자동으로 돈다 — 진행 중 2초(나머지 대기는 컷).
  2. 목록을 커서로 훑는다 — 철자·용법 몇 개만 잡혔다(예: 3개). 설명 상자를 클릭(또는 ✎ **Edit**) → 모달 **Edit filter · WHEN A QUESTION…** (`c03b_edit_filter.png`) → 본문을 전부 지우고 `02_SCENARIO` §4의 넓힌 설명을 타이핑(또는 붙여 넣기) → **Save**(모달 닫힘, 패널 갱신; 아래 글 *"Saving closes this and updates the panel. Nothing reaches students until you deploy."*).
  3. **Run** 클릭 → 버튼이 *Running… n%*로 바뀌며 목록이 다시 찬다 → **IN THIS FILTER · 9**(수는 런마다 다름) — 동의어·뜻·용법 질문이 들어온다 (`c03c_after_run.png`). (대기 20–45 s는 ≤2 s로.)
  4. **Save filter** 클릭 → 버튼이 **Saved**로.
- **VO**: *"The filter workbench opens. On the left is the description — when a question… Run reads every question in this type against it, and the matches go under In this filter. If the description is too narrow or too wide, edit the wording and run again — here, widening it to include synonyms and usage questions. The list is for reading: it doesn't change how the chatbot responds; the rules do. Save filter puts it on the board."*
- **메모**: **ⓑ의 비트 3과 길이를 맞춘다**(ⓑ는 교정→Update definition, ⓒ는 설명 수정→Run). 타이핑이 길면 붙여 넣기로 시간을 맞추되, 붙여 넣기도 화면에서 "문구가 바뀐다"는 것이 보이게 1–2초 멈춘다.

## C4 · 보드로 — filter 선택, Revise rules (1:13 – 1:25)

- **화면/액션** (`shots/c04_board_filter_selected.png`)
  1. **← Board** 클릭 → 보드. 왼쪽 FILTERS · PLANNING 아래에 **Word lookups · 9**, 점선 **+ New filter in Planning**. (RULES 패널은 아직 비어 있다.)
  2. 트리의 **Word lookups** 클릭 → 가운데 머리 **FILTER · WORD LOOKUPS · 9**, 인스펙터 **FINDS**(설명) **[Edit Filter]**, 그 아래 filter의 질문 9개.
  3. 커서로 왼쪽 위 **RULES** 패널(아직 비어 있음)을 한 번 짚는다.
  4. 목록의 **P19 · Turn 2** 클릭(오른쪽에 대화) → 뷰어 머리의 **Revise rules ›** 클릭.
- **VO**: *"Back on the board, the filter sits under its type with a count, and selecting it lists the questions it collects. The Rules panel at the top is still empty. To change how the chatbot responds, open a question and click Revise rules."*

## C5 · 룰 워크벤치 — 피드백 → 제안 → 고르기 (1:25 – 1:55)

- **화면/액션** (`shots/c05a_rules_workbench.png` → `c05b_proposal_picker.png`)
  1. 워크벤치 **← Board · Revise the rules**. 왼쪽 **RULES · V1** *Empty — the chatbot answers with no rules at all.* / **Apply edit · Save rules**. 가운데 탭 **★ P19 · T2 · P24 · T2 · P22 · T1 · + Add example**(anchor + 로그에서 가장 먼 2개 — 2026-08-19부터 양 조건 동일), **RESPONSE · v1 — Empty rules**: 질문 *how do you spell exaggeration*와 원래 응답(한 줄). 오른쪽 **FEEDBACK & HISTORY**(v1 Starting rule — Empty rules), 아래 **Feedback on: v1 response · P19 · T2**와 입력란 *What's wrong with this response?*.
  2. 탭 **P22 · T1**을 눌러 다른 원래 응답(공장 부상 목록 — 긴 글머리표)도 1초 보여 주고 **P19 · T2**로 돌아온다(rules 하나가 이런 질문까지 답한다는 것을 화면이 말하게).
  3. 입력란에 **피드백 1** 타이핑: `Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.` → Enter.
  4. 모달 **Pick how far the revision goes · Previewing on P19 · T2**: **MINIMAL EDIT / FOCUSED REWORK / FULL REWRITE**, 각각 **RULE CHANGES**와 **RESPONSE UNDER THIS RULE**. (생성 대기는 ≤2 s로.)
  5. **FOCUSED REWORK**(또는 MINIMAL EDIT — ⓑ에서 고른 것과 **같은 칸**을 고른다)의 **✓ Use this rule** 클릭 → 워크벤치로: **RULES · V1.1 · not saved yet**에 문장, **RESPONSE · v1.1 — …**에 새 응답(두 줄), 오른쪽 타임라인에 피드백 말풍선 + 제안 카드 + **v1.1 viewing**.
- **VO**: *"The rules workbench opens with a few questions from the log as tabs, each with the chatbot's original reply. Say in plain words what's wrong with the reply. The tool proposes revisions of the rules — a minimal edit, a focused rework, a full rewrite — each with the reply it would produce. Pick one, and the rules and the reply update. You can also edit the rules yourself and Apply the edit."*
- **메모**: VO의 마지막 절(직접 편집)을 말할 때 커서를 **왼쪽 RULES 상자와 `Apply edit` 버튼** 위로 한 번 지나가게 한다 — 누르지는 않는다(ⓑ와 같은 동작). 힌트 카드는 가리키지 않는다. 2026-08-19 런에서는 MINIMAL EDIT가 "철자"에만 붙어서 FOCUSED REWORK("word, spelling, or other single-term lookup")를 골랐다 — 두 버전에서 **같은 칸**을 고르는 것이 원칙이지만, 칸의 내용이 맞지 않으면 내용을 우선하고 내레이션은 그대로 둔다(VO는 어느 칸인지 말하지 않는다).

## C6 · **Rewrite**로 두 번째 수정 → 프리뷰로 확인 → Save rules (1:55 – 2:27)

> ⓑ B6과 **글자 그대로 같은 순서·같은 제스처**다. 고쳐 쓰는 **내용**만 화면의 질문을 따른다 — 그리고 그 질문이 다른 것이 바로 두 조건의 차이다(ⓑ의 탭 2는 intent 안의 단어 질문, ⓒ의 탭 2는 로그 전체에서 가장 먼 질문).

- **화면/액션** (`shots/c05a_rules_workbench.png` → `c06a_preview_across_log.png` → `c06f_rewrite_proposal.png`)
  1. **탭 2**를 클릭(C5에서 봐 둔 그 질문 — 실측 `P24 · T2 · What could be a Utilitarian view of this issue?`). v1.1 rules 아래의 새 응답을 1초 읽는다 — **단어 질문이 아닌데도 rules가 단어 하나로 답하게 만들고 있다.**
  2. **응답 헤더의 `✎ Rewrite instead` 클릭** → 응답이 편집 가능한 textarea가 되고, 현재 응답이 그 안에 들어 있다.
  3. 내용을 전부 지우고 **원하는 답**을 **두 줄 모양**으로 타이핑 — 실제 문구는 `02_SCENARIO.md` §4-1의 표에서 고르거나 리허설에서 미리 적어 둔다.
  4. **`✨ Propose rule from my rewrite`** 클릭 → 확인 단계: **What should this change in general?** *It steers the new rule.* — 자유 입력란과 *…or confirm what the agent read from your edit:* + 항목 3개(체크박스). 2026-08-19 런의 실제 항목: *"Provide the direct answer first, then add a brief illustrative example." / "Use an example sentence to clarify the answer." / "Offer minimal extra explanation after answering straightforward questions."* (대기는 ≤2 s로.)
  5. 자유 입력란은 **비워 두고**, 맞는 항목 **하나를 체크** → `Propose anyway` → **`✨ Propose with 1 change`** → 클릭.
  6. 제안 모달 → (ⓑ와 같은 칸) **✓ Use this rule** → **RULES · V1.2 · not saved yet**.
  7. 탭 줄의 **+ Add example** 클릭 → 전체 화면 **← Back · Preview across the log · ⟳ n/10 shown · 103 total**: 왼쪽 **ALL QUESTIONS · 103**(체크박스, **Most different** 정렬, 열려 있는 탭 3개는 이미 체크, 아래 **+ Load 10 more**), 가운데 **DEPLOYED RULES · not deployed / STUDENT QUESTION / ORIGINAL RESPONSE (as delivered)**, 오른쪽 초록 **NEW RULES · v1.2 / UPDATED RESPONSE**.
  8. 체크되지 않은 행을 **위에서 아래로 두어 개 클릭**해 before/after를 훑는다. 마음에 걸리는 행이 있으면 체크 → **Add as examples**, 없으면 **← Back**.
  9. **Save rules** 클릭 → **RULES · V2**, 타임라인에 **v2 · Applied · …**.
- **VO**: *"Instead of describing what's wrong, you can rewrite the reply itself: the tool reads your edit, asks what you meant in general, and proposes the rules from that. Add example then shows before-and-after for any question in the log, sorted by how much the reply changes, so you can see what the change did to the rest — and pull any of them in as another example. Save rules makes them the chatbot's rules."*
- **메모**: **ⓑ와 같은 쪽을 쓴다**(체크박스 vs 자유 입력). 분기는 `02_SCENARIO.md` §5 비트 6.

## C7 · 보드 확인 → Deploy (2:27 – 2:43)

- **화면/액션** (`shots/c07a_board_rules_in_place.png`, `c07b_deployed.png`)
  1. **← Board** → 왼쪽 **RULES** 패널에 문서가 들어와 있다(*not deployed*). 가운데 **P19 · Turn 2** 클릭 → 뷰어 위에 파란 상자 **⟳ This reply is under the rule [v2 · … ▾]**와 새 응답(두 줄); 드롭다운을 열어 **Original (as delivered)**가 있음을 1초 보여 주고 닫는다.
  2. 헤더 **🚀 Deploy** 클릭 → **Deployed** → **Students receive v1**, RULES 패널 칩이 **v1 live**로, 옆에 파란 **I'm done** 버튼 등장. (**I'm done은 누르지 않는다.**)
  3. 마지막 프레임 2초 홀드.
- **VO**: *"On the board, the Rules panel now holds the document, and any conversation can be viewed under it. When you're ready, Deploy sends the setup to the student chat — and an I'm done button appears for the end of the round."*
- **메모**: 마지막 문장(I'm done)은 ⓑ와 동일하게 넣거나 둘 다 뺀다.

---

## 단어 수·길이

VO ≈ 427 단어 → **160 s ± 7**. 비트별: C1 56 · C2 56 · C3 84 · C4 43 · C5 73 · C6 73 · C7 42. (ⓑ: 50 · 56 · 92 · 45 · 73 · 66 · 44 = 426 — **1단어 차**.)

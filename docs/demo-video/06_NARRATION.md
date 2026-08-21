# 내레이션 원고 (녹음용)

> 화면 지시 없이 **읽을 것만** 모았다. 샷과의 대응은 `03/04/05_SCRIPT_*`의 같은 번호. 세션은 영어로 진행되므로 **영어로 녹음**한다(국문은 검토용 참고 번역이며 녹음하지 않는다).
>
> **한 번에 몰아 녹음한다** — ⓐ·ⓑ·ⓒ를 같은 마이크·같은 자리·같은 세션에서. 두 버전의 목소리 톤이 다르면 그것도 조건 간 차이다.

## 녹음 규칙

- **속도** 분당 155–165 단어. ⓑ와 ⓒ의 실제 길이 차가 **7초를 넘으면 다시 읽는다**(허용 15초, 목표 7초).
- **톤** 평탄하게. 어느 것도 좋다/쉽다/강력하다고 들리지 않게. 감탄·웃음 없음.
- **강세를 주지 않을 단어**: intent, filter, rule, rules — 도구의 명사는 그냥 지나간다.
- **테이크** 문단(비트)마다 끊어 녹음하고 3초 쉰다. 편집에서 화면에 맞춰 붙인다.
- **읽지 않는 것**: 괄호 안 지시, 대체 문장 표시.
- 화면 라벨을 말할 때는 화면의 대소문자 그대로 읽는다("New intent", "Save rule", "Students receive v1").

---

## ⓐ Getting around (≈190 단어 · 목표 70 s)

**A1**
> This is the Chatbot Studio. It opens on a short briefing: your task for this round, the assignment the students were given, and the prompt the chatbot started from. You can reopen it any time from Your task, in the header.

**A2**
> The middle column lists the questions students asked the chatbot — one row per question, with the student's ID and which turn it was. The search box finds questions by their text, and the menu beside it changes the order.

**A3**
> Click a question and the whole conversation opens on the right, with that question highlighted. Text the student pasted in — their own draft, or the assignment prompt — is marked, and these arrows step through the student's other questions.

**A4**
> On the left, the questions are grouped into four types — Planning, Translating, Reviewing, and Drafting. Click a type to list its questions; the line at the top says what the type covers.

**A5**
> And at the top: how many minutes you've been working this round, and Deploy, which sends your setup to the student chat. The next video shows how a setup is made.

---

## ⓑ Slate (≈426 단어 · 목표 160 s)

**B1**
> In Slate, the left column is where the setup lives. Inside each type you create intents: an intent is a group of questions you describe in words, and it carries its own rule — how the chatbot responds to those questions. Anything in no intent gets the type's default rule.

**B2**
> Say you've noticed students asking quick word questions — a spelling, a synonym. With one of them open, click New intent. The tool drafts descriptions from this question — a narrow one, a broader one, a reframed one — and there are starter intents below. Pick one, change the title if you like, and Create.

**B3**
> The intent workbench opens. On the left is the description — when a student… The tool reads every question in this type against it: the ones it's confident about go under In this intent, and borderline ones under Potential questions. If something doesn't belong, mark it out and pick a reason — this one asks to define the essay's topic, not a word. Update definition rewrites the description from your decisions; you see before and after, and what else it moves, then apply it. Save puts the intent on the board.

**B4**
> Back on the board, the intent sits under its type with a count, and the questions it covers are tagged. Select it to see its description and its rule — empty so far. To change how the chatbot responds, open a question and click Revise rule.

**B5**
> The rule workbench opens with a few of the intent's questions as tabs, each with the chatbot's original reply. Say in plain words what's wrong with the reply. The tool proposes revisions of the rule — a minimal edit, a focused rework, a full rewrite — each with the reply it would produce. Pick one, and the rule and the reply update. You can also edit the rule yourself and Apply the edit.

**B6**
> Instead of describing what's wrong, you can rewrite the reply itself: the tool reads your edit, asks what you meant in general, and proposes the rule from that. Add example then shows before-and-after for every question in this intent, so you can see what the change did to the rest — and pull any of them in as another example. Save rule makes it the intent's rule.

**B7**
> On the board, the intent now has its rule, and any of its conversations can be viewed under it. When you're ready, Deploy sends the setup to the student chat — and an I'm done button appears for the end of the round.

---

## ⓒ Clay (≈427 단어 · 목표 160 s)

**C1**
> In Clay, the left column is where the setup lives. At the top are the Rules — one document that says how the chatbot responds to every question. Inside each type you create filters: a filter is a group of questions you describe in words, for reading; it carries no rule of its own.

**C2**
> Say you've noticed students asking quick word questions — a spelling, a synonym. With one of them open, click New filter. The tool drafts descriptions from this question — a narrow one, a broader one, a reframed one — and there are starter filters below. Pick one, change the name if you like, and Create.

**C3**
> The filter workbench opens. On the left is the description — when a question… Run reads every question in this type against it, and the matches go under In this filter. If the description is too narrow or too wide, edit the wording and run again — here, widening it to include synonyms and usage questions. The list is for reading: it doesn't change how the chatbot responds; the rules do. Save filter puts it on the board.

**C4**
> Back on the board, the filter sits under its type with a count, and selecting it lists the questions it collects. The Rules panel at the top is still empty. To change how the chatbot responds, open a question and click Revise rules.

**C5**
> The rules workbench opens with a few questions from the log as tabs, each with the chatbot's original reply. Say in plain words what's wrong with the reply. The tool proposes revisions of the rules — a minimal edit, a focused rework, a full rewrite — each with the reply it would produce. Pick one, and the rules and the reply update. You can also edit the rules yourself and Apply the edit.

**C6**
> Instead of describing what's wrong, you can rewrite the reply itself: the tool reads your edit, asks what you meant in general, and proposes the rules from that. Add example then shows before-and-after for any question in the log, sorted by how much the reply changes, so you can see what the change did to the rest — and pull any of them in as another example. Save rules makes them the chatbot's rules.

**C7**
> On the board, the Rules panel now holds the document, and any conversation can be viewed under it. When you're ready, Deploy sends the setup to the student chat — and an I'm done button appears for the end of the round.

---

## 대체 문장 (분기 대비 — 함께 녹음해 둔다)

화면이 시나리오대로 나오지 않는 경우를 위해 아래 문장도 같은 세션에서 미리 읽어 둔다. 촬영 뒤 필요한 것만 쓴다.

| 언제 | 대체할 곳 | 읽을 문장 |
|---|---|---|
| ⓑ B3 — `out` 할 경계 질문이 목록에 없을 때 | B3의 세 번째 문장 | *"If something's missing, mark it in and pick a reason — this one is a word question too."* |
| ⓑ B3 — Update definition 없이 Save로 끝낼 때 | B3의 네 번째 문장 | *"Save puts the intent on the board."* (앞 문장 삭제) |
| ⓒ C3 — 첫 Run이 이미 넓게 잡혔을 때 | C3의 세 번째 문장 | *"If the description is too narrow or too wide, edit the wording and run again."* (뒤의 "here, widening…" 삭제) |
| ⓑ·ⓒ 비트 6 — 예제를 P29 · T7로 바꿀 때 | 해당 없음 (VO는 질문을 지칭하지 않는다) | 그대로 |
| ⓑ·ⓒ 비트 6 — 확인 단계에서 체크 대신 자유 입력을 쓸 때 | 해당 없음 (VO는 "asks what you meant in general"까지만 말한다) | 그대로 |
| ⓑ B7 / ⓒ C7 — I'm done을 프레임에서 빼기로 할 때 | 마지막 절 | *"When you're ready, Deploy sends the setup to the student chat."* (두 편 모두에서 같이 뺀다) |
| ⓐ A5 — ⓐ를 단독 재생할 일이 생길 때 | 마지막 문장 | *"The next video shows how a setup is made."* 를 빼고 끝낸다 |

## 검수 체크 (녹음 후)

- [ ] ⓑ와 ⓒ의 길이 차 ≤ 7 s
- [ ] ⓒ 트랙에 "intent"가 한 번도 나오지 않는다
- [ ] 세 트랙 어디에도 SCORE / baseline / treatment / control / Prolific / 연구팀이 나오지 않는다
- [ ] 비교급·가치어(better, easier, simpler, powerful, flexible…)가 없다
- [ ] 기준(criterion)을 말하지 않는다 — 몇 개를 읽어라/고쳐라, 좋은 rule은 이렇다
- [ ] Slate/Clay 이름의 뜻을 말하지 않는다
- [ ] ⓑ B5/B6와 ⓒ C5/C6가 **같은 문장 골격**이다 — 수정 경로 셋(피드백·Rewrite·직접 편집)이 양쪽에서 같은 자리에 같은 무게로 나온다

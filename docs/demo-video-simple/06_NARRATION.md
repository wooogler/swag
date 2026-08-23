# 내레이션 원고 v2 (녹음용 · Simple)

> 읽을 것만. 대응 샷은 `03/04/05_SCRIPT_*`의 같은 번호. **영어로 녹음**, ⓐ·ⓑ·ⓒ 한 세션에서. 규칙은 전과 동일: 분당 155–165 단어 · 평탄한 톤 · 도구 명사(intent, rules, pin)에 강세 금지 · 비트마다 끊고 3초 · 괄호 지시는 읽지 않는다 · 화면 라벨은 대소문자 그대로.
>
> **LLM이 붙이는 이름(intent 제목·버전 이름)은 절대 읽지 않는다** — 매런 다르다.

---

## ⓐ Getting around (≈200 단어 · 70 s)

**A1**
> This is the Chatbot Studio. It opens on a short briefing: your task for this round, the assignment the students were given, and the prompt the chatbot started from. You can reopen it any time from Your task, in the header.

**A2**
> The middle column lists every question students asked the chatbot — one row per question, with the student's ID and which turn it was. Text they pasted in is tagged. The search box narrows this list by the student's own words.

**A3**
> Click a question and the whole conversation opens on the right, with that question highlighted. Original, as delivered, is what the student actually received. Pasted text folds away, and these arrows step through the student's other questions.

**A4**
> Pin a question to keep it in view — it moves into its own shelf above the list, and stays there whatever you select or change later. Pin it again to let it go.

**A5**
> And at the top: how many minutes you've been working this round, and Deploy — which sends your setup to the student chat when you decide it's ready. The next video shows how a setup is made.

---

## ⓑ Slate (≈430 단어 · 165 s)

**B1**
> In Slate, the left column is where the setup lives. You create intents: an intent is a group of questions you describe in words, with its own rule for how the chatbot responds to them. The list is read top to bottom, and anything no intent catches lands in Uncategorized at the end — which has a rule of its own.

**B2**
> Say you've noticed students asking quick word questions — a spelling, a synonym — and the chatbot answering them unevenly: one word here, a whole paragraph there. You want these answered one way.

**B3**
> Reading a question and deciding it should be handled differently is the move this board is built around — so an intent starts from the question. The form opens right where the intent will sit, quoting what you started from; starter sets are there if you want a ready-made description, marked where this question already belongs. You write the description and the rule in your own words, and Add.

**B4**
> The tool then reads every question against your description — you can watch it work out where questions go, and each row gets a mark saying which intent now answers it. Open the intent and the question you started from sits at the top as its first example. The list below is ordered by these examples, most typical first — and a title has been written for you; the pencil changes it.

**B5**
> Any question can be made another example — it changes the order, it does not move the question. Flip the order to Least like these and the top row answers a different question: of everything your words caught, what is least like what you meant? If something there isn't yours, you fix it the only way this board fixes anything — by rewriting the description — and Apply re-reads the log: rows leaving fade out red, rows arriving come in green.

**B6**
> An intent doesn't need a question on screen — New intent starts one from scratch. Since you pointed at nothing, the tool writes three example questions from your description — they mirror what your words mean, they are not part of the setup, and Rewrite redoes them. The arrows change the order intents are read in — a question goes to the first one that claims it.

**B7**
> Save keeps this point — versions are named for you, and each intent keeps its own history of what moved, the description or the rule. When you're ready, Deploy saves what's in effect and stamps it as the setup you stand behind — and an I'm done button appears for the end of the round.

---

## ⓒ Clay (≈425 단어 · 165 s)

**C1**
> In Clay, the left column is where the setup lives: one Rules document, in your own words, that says how the chatbot responds to every question. Below it, the versions you save will build up.

**C2**
> Say you've noticed students asking quick word questions — a spelling, a synonym — and the chatbot answering them unevenly: one word here, a whole paragraph there. You want these answered one way.

**C3**
> Pin the questions you're fixing, so they stay in reach while you write. Then you write the rules yourself, in the document — here, how word questions should be answered. Nothing has taken effect yet: the document is just text until you apply it.

**C4**
> Apply, and the reply is worked out again under what you just wrote — you can read the exact text it ran under, right above the answer. The pinned questions are one click away, so checking the second one is immediate. This is the loop: write, apply, look.

**C5**
> A different kind of question — here the chatbot simply wrote the paragraphs. The same document answers this question too, so you add to it: a second paragraph, applied the same way. One document, so every change applies to every question — which is why the pinned ones are worth a look after each apply.

**C6**
> Save keeps this point — versions are named for you and listed on the left. On any reply you can switch what it's read under: any moment you've written, or Original, as delivered — the one answer no setup can reproduce, and the fixed point to compare against.

**C7**
> When you're ready, Deploy saves what's in effect and stamps it as the setup you stand behind — and an I'm done button appears for the end of the round.

---

## 대체 문장 (분기 대비 — 같은 세션에서 미리 녹음)

| 언제 | 대체할 곳 | 읽을 문장 |
|---|---|---|
| ⓑ B5 — 경계 질문이 안 잡혀 When 수정을 생략할 때 | B5 후반 두 문장 | *"If something there isn't yours, rewriting the description is how you'd fix it — Apply re-reads the log."* |
| ⓑ B5 — diff 색이 안 보일 때 | 마지막 절 | *"…and Apply re-reads the log against the new wording."* |
| ⓑ B4 — 제목 생성이 5 s 넘게 늦을 때 | 마지막 절 삭제 | (연필 언급 없이 끝) |
| ⓒ C5 — P11·1 대신 P30·3/P56·1을 쓸 때 | 해당 없음 | VO는 질문을 지칭하지 않는다 |
| ⓑ B7/ⓒ C7 — I'm done을 빼기로 할 때 | 마지막 절 | *"…the setup you stand behind."* 로 끝(두 편 동일하게) |
| ⓐ A5 — 단독 재생용 | 마지막 문장 삭제 | |

## 검수 체크 (녹음 후)

- [ ] ⓑ·ⓒ 길이 차 ≤ 7 s
- [ ] ⓒ 트랙에 "intent" 0회
- [ ] SCORE / baseline / treatment / control / Prolific / 연구팀 0회
- [ ] 비교급·가치어 0회 · 기준(몇 개, 좋은 rule) 0회 · 이름 뜻 설명 0회
- [ ] LLM이 붙인 제목·버전 이름을 읽지 않았다
- [ ] B2와 C2가 같은 문장이다(관찰의 패리티) · B7과 C7의 Deploy 문장이 같다
- [ ] "warning" 계열 표현 0회 — 사실 진술만(§13 불변식 + Simple 원칙 4)

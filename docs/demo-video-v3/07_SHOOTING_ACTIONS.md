# 촬영 동작 시트 — 위에서 아래로 읽으며 찍는다

> **화면 녹화하는 사람이 손에 들고 보는 문서.** 내레이션·이유·설계는 없다. **누를 것 · 가리킬 것 · 기다릴 시간**만 있다.
>
> **보드 하나당 한 번에 쭉 찍는다.** `Run demo` 를 한 번 돌리고, 브리핑에서 시작해 ⓐ를 찍고, 그대로 이어서 워크스루를 끝까지 간다. 편집에서 두 구간으로 자르면 된다 — ⓐ가 끝나는 자리에서 보드는 깨끗하고(검색 지움, 핀 없음, 아무것도 안 씀) 워크스루가 바로 이어진다.
>
> 대기 시간은 **컷 편집 전제의 어림값**이다. 정확할 필요 없고, "여기서 화면이 멈춘 것처럼 보여도 정상"을 알려 주는 용도다. **타이핑은 나중에 배속**한다고 보고 실속도로 치면 된다.
>
> 왜 이 순서인지, 무엇을 말할지는 `04_SCRIPT_CLAY.md` / `05_SCRIPT_SLATE.md`. 원문의 출처는 `03_SCENARIO.md` §4.

---

## 0. 촬영 전 (두 번 다 같다)

- **프로덕션 빌드**로 띄운다: `rm -rf .next && npm run build && PORT=3030 npm run start`. dev는 왼쪽 아래 "N" 배지가 프레임에 박힌다.
- 1920×1080 · F11 전체화면 · 줌 100% · 커서 하이라이트 켜기 · **무음 녹화**(소리는 TTS로 따로).
- `localhost:3030/study/admin` → 코드 `R1` + passcode → **NIRVANA** 탭.
- 찍을 보드의 버튼을 누른다. **워크스페이스 재구축에 20–30초** 걸린다 — 이건 녹화 전이다.
- 브리핑 모달이 뜬 상태에서 **녹화 시작.**
- **두 번째 보드로 넘어가기 전에 주소창에 `localhost:3030/study/admin` 을 직접 친다.** 데모 쿠키를 든 채 curation으로 가면 404다.

**절대 누르지 않는 것 — `Deploy and finish`.** 누르면 배포 + 블록 종료 + `/study/session` 이동이 한 번에 일어나 보드로 못 돌아온다. 다시 찍으려면 `Run demo` 를 새로 돌려야 하고 assignment id가 바뀐다. 실수로 팝오버만 열렸으면 **`Not yet`**.

---

# 촬영 1 — Clay 보드

`Run demo · Simple Baseline` → 브리핑 모달에서 녹화 시작.

## ⓐ Getting around (Clay 테이크)

> 이 구간에서 **`Types` 버튼은 누르지도, 커서로 지나가지도 않는다.** 목록이 좁아지면 "모든 질문을 보여 준다"는 내레이션이 그 순간 거짓이 된다. 동선을 화면 왼쪽에 붙여 짠다.

1. 브리핑 모달을 위에서 아래로 천천히 스크롤한다. 세 섹션이 다 지나가게. `⏱ ~6초`
2. 헤더의 ⓘ **`Your task`** 에 커서를 얹었다 뗀다. `⏱ ~2초`
3. **`Start`** 클릭. `⏱ ~1초` → 모달이 닫히고 보드가 보인다.
4. 가운데 목록의 **`P1 · 4`** 행에 커서를 얹고, 학생 ID → 턴 번호 → 주황색 붙여넣기 태그 `[OWN DRAFT · 313 words · 99%]` 를 차례로 짚는다. `⏱ ~4초`
5. 검색창에 **`spell`** 을 친다. `⏱ ~2초` → 카운트가 `7 of 103`, 행 본문의 `spell` 이 노랗게 물든다.
6. 검색창의 **✕** 를 누른다. `⏱ ~2초` → `All questions 103 of 103` 로 복귀.
7. **`P1 · 4`** 행을 클릭한다. `⏱ ~3초` → 오른쪽에 대화가 열리고 그 질문에 보라색 링, 답 위에 회색 줄 `This reply is the one that was delivered.`
8. 답 아래 **`show pasted text`** 를 눌러 펼쳤다가 **`hide pasted text`** 로 접는다. `⏱ ~5초`
9. 질문 옆 **`⌃ 4/5 ⌄`** 로 한 칸 이동했다 되돌아온다. `⏱ ~4초`
10. 행에 호버 → **📌** 클릭 → 위에 `Kept in view 1` 선반이 뜬다 → 아무 행이나 한 번 눌러 선택을 바꿔도 선반이 그대로인 것을 1초 → 선반의 **📌** 로 해제. `⏱ ~8초` → 선반이 사라진다.
11. 헤더의 **`n / 25 min`** 칩에 호버해 툴팁을 띄웠다 뗀다 → **`Deploy`** 위에 커서만 얹는다 → 2초 홀드. `⏱ ~6초`
    ⚠ **Deploy를 누르지 않는다.** (편집에서 여기가 ⓐ의 끝이다.)

## Ⓒ Clay 워크스루

> 보드는 지금 깨끗하다 — 검색 지움, 핀 없음, `RULES` 비어 있음. 그대로 이어 찍는다.

12. 가운데 목록을 두 화면쯤 천천히 스크롤한다. `⏱ ~3초`
13. **`P19 · 2` `how do you spell exaggeration`** 행을 클릭한다. `⏱ ~2초` → 답은 `The correct spelling is "exaggeration."`
14. 답 위 회색 줄 **`This reply is the one that was delivered.`** 에 커서를 1초 얹는다.
15. 검색창에 **`spell`** 을 친다. `⏱ ~2초` → `7 of 103`
16. **`P29 · 3` `spell egregious`** 행을 클릭한다. `⏱ ~2초` → 답이 `E-G-R-E-G-I-O-U-S`
17. 13번 행 ↔ 16번 행을 한 번씩 다시 눌러 두 답을 대비시킨다. `⏱ 각 1초`
18. 검색창의 **✕**. `⏱ ~1초` → `All questions 103 of 103`
19. **`P19 · 2`** 행을 다시 클릭하고, 행에 호버 → **📌**. `⏱ ~2초` → `Kept in view 1` 선반, 헤더에 `· 1 kept above`
20. `RULES` 상자를 클릭하고 **문단 1** 을 친다. → 카운터 `180 / 8000`

    ```
    When a student asks for a word — a spelling, a synonym, or how to use a term — answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.
    ```

21. **`Apply`** 를 누른다. `⏱ ~12초` → 오른쪽 줄이 `This reply is under [Now (unsaved)]` 로 바뀌고, 답이 스트리밍되며 한 줄 + 예문이 된다.
22. 왼쪽 `VERSION HISTORY` 맨 윗행(`v1 · … · unsaved`)에 커서를 1초 얹는다.
23. 목록을 내려 **`P29 · 5` `define social anxiety`** 를 클릭한다. `⏱ ~12초` → 답이 두 줄로 나온다(`social anxiety: …` / `Example: …`).
24. 그 행에 호버 → **📌**. `⏱ ~1초` → `Kept in view 2`
25. `RULES` 첫 문단의 **앞 절만** 고친다. `When a student asks for a word — a spelling, a synonym, or how to use a term` 를 지우고 아래로 바꿔 친다. → 카운터 `194 / 8000`

    ```
    When a student asks how to spell a word, whether a spelling is right, or which word to use
    ```

26. **`Apply`**. `⏱ ~10초`
27. 선반의 **`P29 · 5`** 를 클릭한다. `⏱ ~8초` → **여전히 두 줄이다.** (이게 이 구간의 요점이니 답이 다 뜰 때까지 기다린다.)
28. `RULES` 끝에 **빈 줄 하나**를 넣고 **문단 2** 를 친다. → `351 / 8000`

    ```
    When a student asks what a term means, answer in three or four sentences: a plain-language definition, then one example of how the term is used in writing.
    ```

29. **`Apply`**. `⏱ ~10초` → `P29 · 5` 의 답이 세 문장 + 용례로 자란다.
30. 선반의 **`P19 · 2`** 를 클릭한다. `⏱ ~8초` → 여전히 한두 줄이다.
31. 선반의 **📌 두 개**를 눌러 둘 다 해제한다. `⏱ ~2초` → 선반이 사라진다.
32. 목록을 내려 **`P29 · 8` `Make this succinct "The …`** 를 클릭한다. `⏱ ~8초` → 줄여 놓은 재작성본 한 문장.
33. 가운데 헤더의 **`Types ▾`** 를 누른다. `⏱ ~1초` → 분류 메뉴.
34. `Reviewing` 아래 **`Shorten / Trim`** 을 고른다. `⏱ ~2초` → 제목이 `Shorten / Trim`, 카운트 `8 of 103`, 제목 아래에 그 분류의 정의문.
35. 제목 아래 **정의문**에 커서를 2초 얹는다. (이 문장을 읽고 다음 문단을 쓴다는 그림.)
36. `RULES` 끝에 빈 줄을 넣고 **문단 3** 을 친다. → `588 / 8000`

    ```
    When a student asks the chatbot to shorten or cut something they wrote, do not hand back a rewritten version. Point at the two or three sentences that could go, say in one line why each is the weakest, and let the student make the cut.
    ```

37. **`Apply`**. `⏱ ~10초` → `P29 · 8` 의 답이 **무엇을 자를지와 그 이유**로 바뀐다.
38. `Types` 옆의 **✕**(`Show every question again`)를 누른다. `⏱ ~2초` → `All questions 103 of 103`
39. **`Save`** 를 누른다. `⏱ ~3초` → 맨 윗행이 `current` 가 되고 `Apply`·`Save` 가 흐려진다.
40. 헤더의 **`Deploy`** 를 누른다. `⏱ ~1초` → 아래 팝오버 + `Not yet` / `Deploy and finish`
41. **2초 홀드하고 녹화 종료.** ⚠ 아무것도 누르지 않는다.

---

# 촬영 2 — Slate 보드

`localhost:3030/study/admin` → `Run demo · Simple SCORE` → 브리핑 모달에서 녹화 시작.

## ⓐ Getting around (Slate 테이크)

> **동작과 멈춤을 촬영 1의 ⓐ와 똑같이 한다** — 프레임은 다르지만 손은 같아야 한다. Slate 보드는 목록 제목이 `Uncategorized` 이고 모든 행에 회색 `● Uncategorized` 칩이 붙는다. **칩을 짚지 않는다**(Ⓢ 워크스루가 가르친다). 행에 호버하면 `+` 도 같이 뜨는데 누르지 않는다.

1. 브리핑 모달을 위에서 아래로 천천히 스크롤한다. `⏱ ~6초`
2. 헤더의 ⓘ **`Your task`** 에 커서를 얹었다 뗀다. `⏱ ~2초`
3. **`Start`** 클릭. `⏱ ~1초`
4. 가운데 목록의 **`P1 · 4`** 행에 커서를 얹고 학생 ID → 턴 번호 → 붙여넣기 태그를 차례로 짚는다. `⏱ ~4초`
5. 검색창에 **`spell`**. `⏱ ~2초` → `7 of 103`
6. 검색창의 **✕**. `⏱ ~2초` → `Uncategorized 103 of 103`
7. **`P1 · 4`** 행 클릭. `⏱ ~3초` → 오른쪽에 대화, `This reply is the one that was delivered.`
8. **`show pasted text`** 로 펼쳤다 **`hide pasted text`** 로 접는다. `⏱ ~5초`
9. **`⌃ 4/5 ⌄`** 로 한 칸 이동했다 되돌아온다. `⏱ ~4초`
10. 행 호버 → **📌** → 선반 확인 → 다른 행 클릭 → 선반의 **📌** 로 해제. `⏱ ~8초`
11. **`n / 25 min`** 칩 호버 → **`Deploy`** 에 커서만 → 2초 홀드. `⏱ ~6초` ⚠ 누르지 않는다.

## Ⓢ Slate 워크스루

12. 가운데 목록을 두 화면쯤 스크롤한다. `⏱ ~3초`
13. **`P19 · 2`** 행을 클릭한다. `⏱ ~2초` → 답 한 줄.
14. 검색창에 **`spell`**. `⏱ ~2초` → `7 of 103`
15. **`P29 · 3`** 행을 클릭한다. `⏱ ~2초` → `E-G-R-E-G-I-O-U-S`
16. 13번 ↔ 15번 행을 한 번씩 다시 누른다. `⏱ 각 1초`
17. 검색창의 **✕**. `⏱ ~1초`
18. **`P19 · 2`** 행에 호버 → **`+`** 를 누른다. `⏱ ~2초` → 툴팁 `Start an intent — read before "Uncategorized"`, 리스트의 그 자리에 폼이 열린다.
19. 폼의 **`STARTED FROM`** 카드에 커서를 1초 얹는다. → `P19 · 2` 와 질문 원문.
20. **`WHEN A QUESTION…`** 에 친다.

    ```
    asks for a word — a spelling, a synonym, or how to use a term
    ```

21. **`THEN`** 에 친다.

    ```
    Answer in one or two lines: give the word or spelling, then one short example sentence. No paragraph.
    ```

22. **`Add`** 를 누른다. `⏱ ~30초` → 리스트 헤더에 *working out where questions go*, 행마다 소속 칩이 붙어 간다. **이 판정은 자르지 말고 다 찍는다**(편집에서 10초로 압축).
23. 왼쪽 새 행에 제목이 저절로 붙는 것을 본다. `⏱ ~3초`
24. 카드가 저절로 열려 있다. **`Examples 1`** 에 커서를 2초 얹는다. → 시드 `P19 · 2`
25. **`Furthest first`** 를 누른다. `⏱ ~3초` → 목록이 뒤집힌다.
26. 맨 위 두 줄을 읽는다: `P38 · 1` `Could you help me define "automation" …` · `P29 · 5` `define social anxiety`. `⏱ ~3초` → **둘 다 정의 질문이면 성립.**
27. 카드의 **WHEN 끝**에 덧붙여 친다.

    ```
     — not asking what a term means
    ```

28. **`Apply`**. `⏱ ~15초` → 카운트가 줄고, 트리 행에 `unsaved` 칩, `VERSION HISTORY 2`.
29. 새로 들어온 엉뚱한 행들(`P11 · 8` · `P30 · 2` · `P26 · 9` 같은 것)에 커서를 3초 얹는다.
30. **`v1` 히스토리 행**을 클릭한다. `⏱ ~3초` → 보드가 읽기 전용이 되고 헤딩 줄에 **`Restore`** · **`Latest`** 가 나온다.
31. **`Restore`** 를 누른다. `⏱ ~1초` → 확인 줄 `Back to setup 1, dropping what came after?`
32. 확인의 **`Restore`** 를 누른다. `⏱ ~8초` → **v2가 사라지고** `VERSION HISTORY 1`, 목록이 원래대로 돌아온다.
33. **`P29 · 5`** 행에 호버 → **`+`**. `⏱ ~2초` → 툴팁이 **`Start an intent — read before "{단어 intent 제목}"`** 로 바뀐다(제목은 매번 다르다).
34. 폼의 위치 문장(*…and anything below it this also describes…*)에 커서를 2초 얹는다.
35. **WHEN** 에 친다.

    ```
    asks what a term means — a definition of a word or a concept
    ```

36. **THEN** 에 친다.

    ```
    Give a two or three sentence definition in plain language, then one example of how the term is used in writing. Do not go longer.
    ```

37. **`Add`**. `⏱ ~20초` → 새 행이 **위에** 서고 아래 행의 카운트가 줄어든다.
38. **`P29 · 5`** 를 클릭한다. `⏱ ~10초` → `This reply is under [v1 · …]`, 두 문장 + `Example: …`
39. 왼쪽 트리의 **`Uncategorized`** 를 클릭한다. `⏱ ~2초` → `Uncategorized 86 of 103`, 편집기가 `THEN` 하나뿐.
40. 목록을 내려 **`P29 · 8`** 을 클릭한다. `⏱ ~3초` → **`This reply is the one that was delivered.`**(드롭다운이 없다)
41. 그 행에 호버 → **📌**. `⏱ ~1초` → `Kept in view 1`
42. 왼쪽 **`+ New intent`** 를 누른다. `⏱ ~2초` → 폼에 **`STARTED FROM` 카드가 없다.**
43. **`Starter sets ▾`** → `Reviewing` 아래 **`Shorten / Trim`** 을 고른다. `⏱ ~3초` → **WHEN이 저절로 채워진다.** (여기는 치지 않는다.)
44. **THEN** 에 친다.

    ```
    Do not hand back a rewritten version. Point at the two or three sentences that could go, say in one line why each is the weakest, and let the student make the cut.
    ```

45. **`Add`**. `⏱ ~20초` → 제목이 `Shorten / Trim` 이 되고, 선반 행의 칩이 새 색으로 바뀐다. 몇 초 뒤 `Examples 3` 이 이탤릭 가상 질문으로 채워지고 헤더 버튼이 `Update examples` 가 된다.
46. **`Save`** 에 호버만 한다. `⏱ ~2초` → 툴팁 *Nothing has changed since the last save*. (이 대본에서 Save는 늘 흐리다 — 세 `Add` 가 전부 저장이다.)
47. 선반의 **`P29 · 8`** 을 클릭한다. `⏱ ~10초` → 답이 `The weakest spots are:` 와 자를 후보 셋으로 바뀐다.
48. 헤더의 **`Deploy`** 를 누른다. `⏱ ~1초` → 팝오버.
49. **2초 홀드하고 녹화 종료.** ⚠ 아무것도 누르지 않는다.

---

## 대기 시간, 한눈에

| 무엇 | 대략 | 편집에서 |
|---|---|---|
| Clay의 `Apply`(응답 재생성) | **10–12초** | 첫 두 번은 살리고 이후 ≤3초 |
| 안 본 질문을 처음 여는 것 | **8–12초** | 〃 |
| **Slate의 첫 `Add`(전 로그 판정)** | **~30초** | **자르지 말고 10초로 압축** |
| Slate의 두 번째 이후 `Add` / `Apply` | **15–20초** | ≤3초 |
| `Restore` 확인 후 | **~8초** | ≤3초 |
| `Examples 3` 이 채워지는 것 | **~15초** | 기다렸다 찍고 ≤3초 |
| `Save` | 2–3초 | 그대로 |
| 타이핑 | 실속도로 친다 | 첫 구간만 실속도, 나머지 2× 램프 |

## 촬영 중 함정

- **행의 아이콘은 호버해야 나온다.** 📌 · `+` · ✨ 는 마우스가 그 행 위에 있을 때만 보인다. 누르기 전에 커서를 행 위에 잠깐 두고 **아이콘이 뜬 프레임을 만든 뒤** 클릭한다.
- **`Save` 는 적용 안 된 편집이 있으면 흐리다.** 순서는 언제나 **타이핑 → `Apply` → `Save`**.
- **LLM이 붙이는 이름은 매번 다르다.** intent 제목·버전 이름이 이 문서와 달라도 정상이다. 카운트 숫자도 ±2 다를 수 있다.
- **판정이 도는 동안 화면이 멈춘 것처럼 보인다.** Slate에서 `Add` 뒤 30초는 정상이다.
- **촬영 2의 33번 툴팁**은 LLM이 붙인 제목을 담고 있어 이 문서와 글자가 다르다. **문장 형태만 맞으면 성립.**
- ⓐ의 시연 질문을 `P1 · 4` 로 잡은 이유: 워크스루가 쓰는 네 질문(`P19 · 2` · `P29 · 3` · `P29 · 5` · `P29 · 8`)과 겹치지 않게 하려는 것이다. 한 테이크로 이어 찍으면 같은 행에 핀을 걸었다 떼고 곧바로 다시 거는 그림이 나온다.
- 예상과 다르게 나올 때의 대체 경로는 `03_SCENARIO.md` §5.

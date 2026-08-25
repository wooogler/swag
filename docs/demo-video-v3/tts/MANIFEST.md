# TTS — 무엇을 어디에 넣나

`export.py` 가 `../06_NARRATION.md` 에서 뽑아 쓴다. **여기 있는 .txt를 고치지 말고 원고를 고친 뒤 다시 돌린다.**

```bash
cd docs/demo-video-v3/tts && python3 export.py
```

비트 35개 · 낭독 단어 1275개.

## `studio/` — 챕터 하나에 프로젝트 하나

ElevenLabs Studio에 그대로 올린다. **빈 줄이 블록 경계**라 블록이 비트와 일대일로 떨어진다.

### `studio/getting-around.txt` — Getting around (블록 5개)

| 블록 | 비트 | 첫머리 | |
|---|---|---|---|
| 1 | A1 | This is the Chatbot Studio. It starts with a… |  |
| 2 | A2 | The middle column lists every question stude… |  |
| 3 | A3 | Click a question and the whole conversation … |  |
| 4 | A4 | Pin a question to keep it visible. It moves … |  |
| 5 | A5 | And at the top: how many minutes you have wo… |  |

### `studio/clay-concept.txt` — Concept · Clay (블록 5개)

| 블록 | 비트 | 첫머리 | |
|---|---|---|---|
| 1 | C1 | Students in this course wrote with a chatbot… | **다른 덱과 같은 문장** — `slate-concept.txt` 의 블록 1 에 이 오디오를 그대로 쓴다 |
| 2 | C2 | In Clay, your instructions are a single docu… |  |
| 3 | C3 | Whatever a student asks, the chatbot reads y… |  |
| 4 | C4 | So a paragraph you write for one kind of que… |  |
| 5 | C5 | You work in a loop. Write, try it, and read … | **다른 덱과 같은 문장** — `slate-concept.txt` 의 블록 5 에 이 오디오를 그대로 쓴다 |

### `studio/slate-concept.txt` — Concept · Slate (블록 5개)

| 블록 | 비트 | 첫머리 | |
|---|---|---|---|
| 1 | S1 | Students in this course wrote with a chatbot… | **생성하지 말 것** — `clay-concept.txt` 블록 1 의 오디오를 쓴다 |
| 2 | S2 | In Slate, your instructions are a list of in… |  |
| 3 | S3 | Before it answers, the chatbot checks your l… |  |
| 4 | S4 | The last place in the list holds every quest… |  |
| 5 | S5 | You work in a loop. Write, try it, and read … | **생성하지 말 것** — `clay-concept.txt` 블록 5 의 오디오를 쓴다 |

### `studio/clay-walkthrough.txt` — Walkthrough · Clay (블록 10개)

| 블록 | 비트 | 첫머리 | |
|---|---|---|---|
| 1 | C1 | A student asks how to spell a word. The answ… | **다른 덱과 같은 문장** — `slate-walkthrough.txt` 의 블록 1 에 이 오디오를 그대로 쓴다 |
| 2 | C2 | Here is the same kind of question, and here … | **다른 덱과 같은 문장** — `slate-walkthrough.txt` 의 블록 2 에 이 오디오를 그대로 쓴다 |
| 3 | C3 | Pin that question so it stays nearby and you… |  |
| 4 | C4 | So you write the rule in the document: a wor… |  |
| 5 | C5 | But this one is not a word question. It asks… |  |
| 6 | C6 | You can make the rule narrower, and you do. … |  |
| 7 | C7 | So you write what a definition should receiv… |  |
| 8 | C8 | Now you continue reading the list. Here a st… |  |
| 9 | C9 | The list can be narrowed to that one kind of… |  |
| 10 | C10 | Save keeps this version. And when you are re… | **다른 덱과 같은 문장** — `slate-walkthrough.txt` 의 블록 10 에 이 오디오를 그대로 쓴다 |

### `studio/slate-walkthrough.txt` — Walkthrough · Slate (블록 10개)

| 블록 | 비트 | 첫머리 | |
|---|---|---|---|
| 1 | S1 | A student asks how to spell a word. The answ… | **생성하지 말 것** — `clay-walkthrough.txt` 블록 1 의 오디오를 쓴다 |
| 2 | S2 | Here is the same kind of question, and here … | **생성하지 말 것** — `clay-walkthrough.txt` 블록 2 의 오디오를 쓴다 |
| 3 | S3 | So you start an intent from the question you… |  |
| 4 | S4 | The questions it collected are ordered by th… |  |
| 5 | S5 | Some of these ask what a term means. Your wo… |  |
| 6 | S6 | Instead you start an intent from the definit… |  |
| 7 | S7 | And it answers the way you asked.… |  |
| 8 | S8 | Then you read the questions that are left. H… |  |
| 9 | S9 | The starter sets contain descriptions that a… |  |
| 10 | S10 | Save keeps this version. And when you are re… | **생성하지 말 것** — `clay-walkthrough.txt` 블록 10 의 오디오를 쓴다 |

### 두 번 만들지 말아야 하는 블록

| | 클레이 쪽 | 슬레이트 쪽 |
|---|---|---|
| 개념 덱 | `clay-concept.txt` 블록 **1, 5** | `slate-concept.txt` 블록 **1, 5** |
| 워크스루 | `clay-walkthrough.txt` 블록 **1, 2, 10** | `slate-walkthrough.txt` 블록 **1, 2, 10** |

문장이 글자까지 같다. 두 번 만들면 억양이 갈리고, 그건 두 조건 사이에 있어선 안 되는 차이다. 한쪽에서 만든 오디오를 다른 쪽 타임라인에 그대로 얹는다. `getting-around.txt` 는 한 번 만들어 **두 블록-1 영상**에 같이 쓴다(그림만 보드별로 다르다).

## `lines/` — 비트 하나에 파일 하나

블록 하나만 다시 만들 때 쓴다. 파일 30개(위 다섯 쌍은 하나로 묶여 있다).

| 트랙 | 비트 | 파일 | |
|---|---|---|---|
| ②ⓐ | A1 | `lines/getting-around-a1.txt` |  |
| ②ⓐ | A2 | `lines/getting-around-a2.txt` |  |
| ②ⓐ | A3 | `lines/getting-around-a3.txt` |  |
| ②ⓐ | A4 | `lines/getting-around-a4.txt` |  |
| ②ⓐ | A5 | `lines/getting-around-a5.txt` |  |
| ①Ⓒ | C1 | `lines/shared-concept-frame.txt` | shared with the other deck |
| ①Ⓒ | C2 | `lines/concept-clay-c2.txt` |  |
| ①Ⓒ | C3 | `lines/concept-clay-c3.txt` |  |
| ①Ⓒ | C4 | `lines/concept-clay-c4.txt` |  |
| ①Ⓒ | C5 | `lines/shared-concept-loop.txt` | shared with the other deck |
| ①Ⓢ | S1 | `lines/shared-concept-frame.txt` | reuses the same audio |
| ①Ⓢ | S2 | `lines/concept-slate-s2.txt` |  |
| ①Ⓢ | S3 | `lines/concept-slate-s3.txt` |  |
| ①Ⓢ | S4 | `lines/concept-slate-s4.txt` |  |
| ①Ⓢ | S5 | `lines/shared-concept-loop.txt` | reuses the same audio |
| ③Ⓒ | C1 | `lines/shared-walk-observation-a.txt` | shared with the other deck |
| ③Ⓒ | C2 | `lines/shared-walk-observation-b.txt` | shared with the other deck |
| ③Ⓒ | C3 | `lines/walk-clay-c3.txt` |  |
| ③Ⓒ | C4 | `lines/walk-clay-c4.txt` |  |
| ③Ⓒ | C5 | `lines/walk-clay-c5.txt` |  |
| ③Ⓒ | C6 | `lines/walk-clay-c6.txt` |  |
| ③Ⓒ | C7 | `lines/walk-clay-c7.txt` |  |
| ③Ⓒ | C8 | `lines/walk-clay-c8.txt` |  |
| ③Ⓒ | C9 | `lines/walk-clay-c9.txt` |  |
| ③Ⓒ | C10 | `lines/shared-walk-close.txt` | shared with the other deck |
| ③Ⓢ | S1 | `lines/shared-walk-observation-a.txt` | reuses the same audio |
| ③Ⓢ | S2 | `lines/shared-walk-observation-b.txt` | reuses the same audio |
| ③Ⓢ | S3 | `lines/walk-slate-s3.txt` |  |
| ③Ⓢ | S4 | `lines/walk-slate-s4.txt` |  |
| ③Ⓢ | S5 | `lines/walk-slate-s5.txt` |  |
| ③Ⓢ | S6 | `lines/walk-slate-s6.txt` |  |
| ③Ⓢ | S7 | `lines/walk-slate-s7.txt` |  |
| ③Ⓢ | S8 | `lines/walk-slate-s8.txt` |  |
| ③Ⓢ | S9 | `lines/walk-slate-s9.txt` |  |
| ③Ⓢ | S10 | `lines/shared-walk-close.txt` | reuses the same audio |

**목소리 설정·검수 항목은 `../06_NARRATION.md` 의 TTS 블록.**

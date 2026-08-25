# ① 개념 슬라이드 — 소스와 4K 렌더

`../02_CONCEPT_SLIDES.md` 가 이 열 장의 **내용과 규율**을 정하고, 이 폴더가 그 **그림**이다. 문구를 고치려면 `02_CONCEPT_SLIDES.md` 를 먼저 고치고 여기로 온다 — 두 곳이 갈라지면 문서가 진실이다.

| 파일 | 무엇 |
|---|---|
| `build.py` | 도형·문구를 생성해 `slides.html` 을 쓴다. **여기가 편집 지점이다.** |
| `slides.html` | 정적 HTML 열 장(1920×1080 씩). 스크립트 없음 — 브라우저로 그냥 열어 보면 된다 |
| `slides.json` | 렌더 순서(= PNG 파일명) |
| `render.mjs` | `slides.html` → `png/*.png`, **3840×2160** |
| `png/` | 영상 편집에 넣을 4K 스틸 열 장 |

## PNG 열여섯 장

| 파일 | 슬라이드 | 화면에 있는 글자 |
|---|---|---|
| `clay-part-1-how-it-works.png` | Ⓒ C0 · **파트 1 카드** | CLAY / How it works |
| `clay-part-2-getting-around.png` | **파트 2 카드**(덱 바깥) | CLAY / Getting around |
| `clay-part-3-worked-example.png` | **파트 3 카드**(덱 바깥) | CLAY / A worked example |
| `clay-1-brief.png` | Ⓒ C1 | you brief it. they talk to it. |
| `clay-2-document.png` | Ⓒ C2 | one document |
| `clay-3-every-question.png` | Ⓒ C3 | every question |
| `clay-4-read-for-all.png` | Ⓒ C4 | a rule you write for one kind of question is read for all of them |
| `clay-5-loop.png` | Ⓒ C5 | write · see what it answers · keep a point · deploy, once |
| `slate-part-1-how-it-works.png` | Ⓢ S0 · **파트 1 카드** | SLATE / How it works |
| `slate-part-2-getting-around.png` | **파트 2 카드**(덱 바깥) | SLATE / Getting around |
| `slate-part-3-worked-example.png` | **파트 3 카드**(덱 바깥) | SLATE / A worked example |
| `slate-1-brief.png` | Ⓢ S1 | (C1과 **같은 그림·같은 글자**) |
| `slate-2-intents.png` | Ⓢ S2 | when · then · several intents |
| `slate-3-first-match.png` | Ⓢ S3 | when · then · the first one that matches |
| `slate-4-leftover.png` | Ⓢ S4 | when · then · whatever is left |
| `slate-5-loop.png` | Ⓢ S5 | (C5와 **같은 그림·같은 글자**) |

**두 쌍이 바이트까지 같은 그림이다** — `*-1-brief`(프레임)와 `*-5-loop`(사이클). 파일을 각 덱에 하나씩 둔 것은 편집 타임라인에서 각자 자기 파일을 물게 하기 위해서이고, **VO도 같은 오디오를 써야 한다**(`../06_NARRATION.md` TTS 규율).

### 파트 카드에 대해

합친 영상은 한 파일이 7분이라 이음매가 없으면 어디쯤인지 알 수 없다. 파트 카드 세 장이 그 이음매다 — 개념 앞·Getting around 앞·워크스루 앞에 한 장씩. **첫 장이 개념 덱의 C0/S0을 겸한다**(그래서 검은 타이틀 카드는 없앴다 — 덱에서 유일하게 반전되는 프레임이었고, 한 영상에 네 번 들어가면 구두점이 아니라 깜빡임이 된다).

**번호도 진행 막대도 없다.** 블록 1은 세 파트, 블록 2는 두 파트라 카운터를 달면 같은 층에 블록별로 다른 카드가 필요해진다. 파트 이름만으로 나뉘는 느낌은 충분히 난다. 시스템 이름은 **모든 카드에** 있다 — 합친 영상에서 지금 어느 쪽을 보고 있는지 계속 말해 주는 유일한 것이다.

### 프레임 슬라이드에 대해

`*-1-brief` 는 이 덱에서 유일하게 **시스템 얘기를 하지 않는** 장이다. 보는 사람이 교수자이고, 답하는 것은 챗봇이고, 학생은 그 챗봇과 이야기한다는 배치만 말한다. 그래서 **양 덱에 글자까지 똑같이** 들어간다 — 한쪽만 다르게 프레이밍되면 그 자체가 조건 차이가 된다.

말풍선이지 **얼굴이 아니다.** 눈·입을 그리면 이 도구에 없는 인격을 약속하게 되고, VO의 한정 구절(*a teaching assistant who will answer without you in the room*)이 하려는 일과 정반대가 된다. 그림에서 사람은 검정, 학생은 회색, 챗봇만 강조색이다 — 색이 "당신이 만지는 것은 가운데뿐"을 말한다.

## 다시 만드는 법

```bash
cd docs/demo-video-v3/slides
python3 build.py
LD_LIBRARY_PATH=$HOME/.local/chromedeps/usr/lib64 node render.mjs
```

**두 쌍(`*-1-brief` · `*-5-loop`)은 한 번만 렌더하고 파일을 복사한다.** 같은 마크업이라도 페이지 안 위치가 다르면 element screenshot의 안티에일리어싱이 천 바이트쯤 갈리고, "두 덱이 같은 프레임"이라는 주장이 *거의* 참인 것은 안 하느니만 못하다. 짝은 `build.py` 의 `DUPLICATES` 에 있다.

1920×1080으로 그려서 `deviceScaleFactor: 2` 로 찍는다 — 좌표를 4K로 생각할 필요가 없고, 도형이 전부 SVG라 두 배로 키워도 흐려지지 않는다. 다른 크기가 필요하면 `render.mjs` 의 `deviceScaleFactor` 만 바꾼다(3 → 5760×3240).

## 지킨 규율 (`../02_CONCEPT_SLIDES.md`)

- **스크린샷 0장.** 도형과 글자뿐이다.
- **화면 라벨 0개.** 카드의 `when` / `then` 은 **소문자** — 보드의 `When a question…` / `Then` 이 아니라 개념어라는 표시다.
- **두 덱이 같은 강조색**(`#2B5CE6`)을 쓴다. 덱마다 색을 달리하면 두 시스템에 서로 다른 인상이 붙는다.
- Clay 덱에 "intent" 0회.
- 애니메이션 없음 — 스틸 한 장이 그 장의 최종 상태다. 도형을 순서대로 등장시키고 싶으면 편집에서 마스크로 덮었다 걷는다.

## 폰트

`Noto Sans`(시스템에 설치돼 있는 유일한 본문 산세리프). 웹폰트를 걸지 않았으므로 렌더에 네트워크가 필요 없다. 다른 폰트로 바꾸려면 `build.py` 의 `CSS` 와 SVG `<text>` 의 `font-family` 두 곳을 같이 고친다.

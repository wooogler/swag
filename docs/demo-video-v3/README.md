# 데모 영상 v3 — 촬영·녹음·발행 런북

> 개념 슬라이드 2편 + 워크스루 2편을 만들고, 기존 Getting around 2편과 함께 발행하기까지.
> 기획 `01_PLAN.md` · 개념 덱 `02_CONCEPT_SLIDES.md` · 시나리오/원문 `03_SCENARIO.md` · 샷리스트 `04`/`05` · 녹음 `06_NARRATION.md` · **촬영 동작 시트 `07_SHOOTING_ACTIONS.md`**.
>
> **찍을 때 손에 드는 것은 `07`이다** — 누를 것·가리킬 것·기다릴 시간만 있고 내레이션과 이유는 없다. `04`/`05`는 왜 그 순서인지가 필요할 때 편다.
>
> **v2(`docs/demo-video-simple/`)를 대체하는 범위**: 워크스루 대본(v2의 `04`/`05`)만. **ⓐ Getting around는 v2 문서와 기존 영상을 그대로 쓴다.** 서버·브라우저·업로드 같은 일반 절차도 v2 `README.md` §2가 여전히 유효하다 — 여기는 차이만 적는다.

## 0. 만들 것

| 파일 | 무엇 | 어디서 |
|---|---|---|
| `concept-clay.mp4` | ① 슬라이드 5장 + 타이틀 + VO | **스틸은 이미 있다** — `slides/png/clay-*.png`(3840×2160) |
| `concept-slate.mp4` | ① 슬라이드 5장 + 타이틀 + VO | 〃 `slides/png/slate-*.png` |
| `getting-around-simple-clay.mp4` | ② | **그림은 기존 파일 재사용**(다시 찍지 않는다). **소리는 다시 만든다** — `tts/studio/getting-around.txt` |
| `getting-around-simple-slate.mp4` | ② | 〃 (소리는 같은 파일) |
| `simple-clay.mp4` | ③ | `Run demo · Simple Baseline` |
| `simple-slate.mp4` | ③ | `Run demo · Simple SCORE` |

## 1. 사전 확인 (촬영 전날)

- [ ] `/study/admin/curation?ds=nirvana` — Demo students 20명, **"20 students · 103 questions isolated"**.
- [ ] `.env`의 `OPENAI_API_KEY` 유효(응답·이름 생성·Slate 판정·Examples).
- [ ] `npx tsx --env-file=.env scripts/study/check-simple.ts --view simple_score` / `--view simple_baseline` 통과.
- [ ] **리허설 1회씩**, 끝까지. 확인할 것:
  - Ⓒ: `Types ▾` 에 `Reviewing` → **`Shorten / Trim`** 이 있고 카운트가 0이 아니다(실측 8) · 문단 1 Apply 뒤 **`P29 · 5` 가 짧아진다** · 문단 3 Apply 뒤 답이 **재작성본이 아니라 "무엇을 자를지"** 로 나온다.
  - Ⓢ: 첫 `Add` 뒤 **`Furthest first` 맨 위 두 줄이 정의 질문**이다(실측 `P38 · 1` / `P29 · 5`) · `v1` 행 클릭 → `Restore` → 확인 → **v2가 사라진다** · `Starter sets` 의 `Shorten / Trim` 이 **WHEN을 자동으로 채운다**.
  - 둘 다: Save가 Apply 전에는 dim · Deploy 팝오버가 예정대로 뜬다(**`Deploy and finish` 는 리허설에서도 누르지 않는다** — 누르면 그 클론이 끝난다).
- [ ] 리허설에서 **타이핑 원문을 손에 익힌다.** Ⓒ는 588자, Ⓢ는 545자를 친다(Ⓢ의 세 번째 When은 세트가 채워 주므로 치지 않는다) — 오타 후 수정도 자연스러우니 한두 개는 그대로 두어도 된다.
- [ ] 분기가 어디로 갔는지 `03_SCENARIO` §5 표에 적어 둔다. **본 촬영은 새 Run demo라 판정이 ±2 다를 수 있다.**

## 2. 서버·브라우저

- **프로덕션 빌드**로: `rm -rf .next && npm run build && PORT=3030 npm run start` — dev는 "N" 배지 + 컴파일 멈칫.
- 1920×1080 · F11 · 줌 100% · 커서 하이라이트 · 무음 녹화(VO는 따로).
- `/study/admin` → R1 + passcode → curation.

## 3. 워크스루 한 편 찍는 순서

> **손에 들 문서는 [07_SHOOTING_ACTIONS.md](docs/demo-video-v3/07_SHOOTING_ACTIONS.md) 다** — Ⓒ 31동작 · Ⓢ 34동작 · ⓐ 10동작(재촬영 시), 각 동작의 대기 시간과 "됐다는 신호"까지. 아래는 그 바깥의 절차다.

1. curation에서 **Run demo · Simple Baseline**(또는 **· Simple SCORE**) → 워크스페이스 재구축 후 `/studio/<id>` 브리핑 모달.
2. **Start** → 녹화 시작 → 샷리스트 순서대로 → 녹화 종료 → §5 체크리스트 대조.
   - **마지막 비트는 Deploy 팝오버에서 2초 홀드하고 끝낸다.** `Deploy and finish` 를 누르면 배포 + 블록 종료 + `/study/session` 이동이 한 번에 일어나 보드로 못 돌아온다. 실수로 팝오버만 열렸으면 **Not yet**.
3. **다음 편은 반드시 `/study/admin` 을 거쳐서** — 데모 세션 쿠키를 든 채 curation으로 직행하면 404다(`/study/admin` 이 return 쿠키를 소비해 연구자로 복귀시킨다). 주소창에 `localhost:3030/study/admin` → 자동으로 curation으로 돌아온다.
4. Run demo는 매번 클론을 새로 만든다 — 앞 테이크의 rule·pin은 남지 않는다.

## 3-1. 내레이션 — TTS로 만든다

`06_NARRATION.md` 의 VO는 **합성 음성이 읽는다는 전제로** 문장부호를 정리해 두었다(em dash 0개). 붙여 넣을 대사는 이미 뽑혀 있다:

```bash
cd docs/demo-video-v3/tts && python3 export.py     # 원고를 고쳤을 때만
```

**`tts/studio/*.txt` — 챕터 다섯 개, 프로젝트 하나에 파일 하나.** ElevenLabs Studio에 그대로 올린다. **빈 줄이 블록 경계**라 블록이 비트와 일대일로 떨어진다.

| 파일 | 블록 | |
|---|---|---|
| `getting-around.txt` | 5 | 한 번 만들어 **두 블록-1 영상**에 같이 쓴다(그림만 보드별로 다르다) |
| `clay-concept.txt` · `slate-concept.txt` | 5 · 5 | **블록 1·5가 두 덱에서 같은 문장** |
| `clay-walkthrough.txt` · `slate-walkthrough.txt` | 10 · 10 | **블록 1·2·10이 두 덱에서 같은 문장** |

같은 문장인 블록은 **한 번만 생성해 두 덱에 같은 오디오를 얹는다** — 두 번 생성하면 억양이 갈리고, 그건 두 조건 사이에 있어선 안 되는 차이다. 어느 블록인지는 `tts/MANIFEST.md` 의 챕터별 표에 줄줄이 적혀 있다.

- `tts/lines/*.txt` — 비트 하나에 파일 하나(30개). 블록 하나만 다시 만들 때 쓴다.
- **다섯 트랙 전부 같은 목소리·같은 설정.** 비트 사이 3초는 편집에서 넣는다(생성 안에 빈 줄을 두지 않는다).
- ⚠ **`03_SCENARIO` §4의 타이핑 원문과 스크립트에 인용된 rule 문장에는 em dash가 그대로 있다.** 그건 화면에 치는 글자다 — TTS에 넣지 않는다.
- ⚠ **② Getting around의 소리도 다시 만든다.** 그림은 기존 영상 그대로지만, 나머지 네 트랙과 같은 목소리로 나와야 네 층이 한 사람으로 들린다. 204단어라 느린 낭독에서 79 s이므로 75 s 그림을 1–2 s 늘리거나 낭독을 붙인다.

## 4. 개념 슬라이드 — 스틸은 이미 있다

**열여섯 장 전부 `slides/png/` 에 3840×2160으로 렌더돼 있다.** 편집에서 그대로 얹으면 된다. 소스·재생성·규율 점검은 `slides/README.md`.

- **파트 카드 3장**: `*-part-1-how-it-works`(= 덱의 첫 장) · `*-part-2-getting-around` · `*-part-3-worked-example`. 합친 영상에서 각 층 **앞에** 끼운다 — 이게 7분짜리 한 파일의 이음매다.
- **개념 덱 5장**: `*-1-brief` · `*-2-document`/`*-2-intents` · `*-3-*` · `*-4-*` · `*-5-loop`. **`*-1-brief` 와 `*-5-loop` 는 두 덱이 바이트까지 같은 그림이다.**
- **장당 12–19 s**(프레임 18 s · 사이클 19 s가 가장 길다). 타이틀 3 s를 더해 **덱 전체 80 s**.
- **VO를 먼저 녹음하고 스틸의 길이를 거기에 맞춘다** — 반대로 하면 두 덱 길이가 벌어진다.
- 전환 효과 없음(컷). 도형을 순서대로 등장시키고 싶으면 스틸을 마스크로 덮었다 걷는다 — 슬라이드 파일을 여러 장으로 쪼개지 않는다(두 덱의 장 수가 어긋난다).
- 문구를 고쳐야 하면 `02_CONCEPT_SLIDES.md` → `slides/build.py` 순서로 고치고 `python3 build.py && node render.mjs`.

## 5. 촬영 직후 체크리스트 (테이크마다)

- [ ] "N" 개발 배지 없음(프로덕션 빌드)
- [ ] 헤더 **Participant DEMO** · 뒤로가기 화살표 없음 · 주소창 없음(전체화면)
- [ ] 경과 칩 단조 증가(한 테이크)
- [ ] 스크립트 인용 라벨 = 실제 화면(다르면 **스크립트를 고친다** — UI가 진실)
- [ ] **③ 화면에 개념·라벨을 설명하는 순간이 없다** (VO도 §6 체크)
- [ ] Ⓒ 화면·자막에 "intent" 0회
- [ ] Ⓒ: 핀 2개가 선반에 올랐고 **Apply 두 번(C6·C7)을 선반에서 확인**했다(C4는 이미 선택된 질문에서, C9는 핀을 놓은 뒤라 목록에서 확인한다) · 문서가 세 문단으로 자랐다 · **`Types` 로 좁혀 읽고 ✕로 지운 뒤 확인**했다
- [ ] Ⓢ: 두 경로(행 `+` / `+ New intent`)가 다 나왔다 · **`Furthest first`** 로 정의 질문을 찾았다 · **버전 행 → `Restore` → 확인**까지 갔고 v2가 사라졌다 · **`Starter sets` 가 WHEN을 채우는 것**이 프레임에 있다 · Examples 3(이탤릭)이 보였다
- [ ] 마지막: **Deploy 팝오버**에서 홀드, **누르지 않음**
- [ ] LLM 제목·버전 이름을 내레이션이 읽지 않았다 · 숫자를 읽지 않았다

## 6. 편집 → 발행

1. 컷 규칙은 `01_PLAN` §1-2. **램프·컷을 양 조건 같은 자리에 건다.** 타이틀 카드 3 s · 마지막 홀드 2 s · VO 얹기.
2. ③ 두 편 길이 차 **≤ 20 s**, ① 두 덱 차 **≤ 5 s**.
3. YouTube Unlisted · 임베드 허용 · 제목은 화면 라벨("Clay" / "Slate" / "Getting around") · 설명 비움.
4. **발행은 네 파일이다**(`01_PLAN` §1-1): `block1-clay` · `block1-slate` · `block2-clay` · `block2-slate`. 각각 개념 + (블록 1만) Getting around + 워크스루를 이어 붙인 것. Unlisted · **임베드 허용**(Private은 재생 안 된다) · 설명란에 **챕터 타임스탬프**(한 파일이 7분이다).
5. `.env` 에 네 줄을 넣고 **서버 재시작**. 값은 **유튜브 링크 그대로면 된다** — watch URL · `youtu.be` 공유 링크(`?si=` 포함) · `/embed/` · 열한 글자 id 전부 받는다.
   ```
   NEXT_PUBLIC_STUDY_DEMO_BLOCK1_SIMPLE_SCORE="…"      # block1-slate
   NEXT_PUBLIC_STUDY_DEMO_BLOCK1_SIMPLE_BASELINE="…"   # block1-clay
   NEXT_PUBLIC_STUDY_DEMO_BLOCK2_SIMPLE_SCORE="…"      # block2-slate
   NEXT_PUBLIC_STUDY_DEMO_BLOCK2_SIMPLE_BASELINE="…"   # block2-clay
   ```
6. 확인은 simple family 참가자로 `/study/session`(not_started → 블록 1 / break → 블록 2). **빈 슬롯은 필요한 변수명을 그대로** 표시하고, **값이 잘못되면 그 값을 되비추며** 왜 못 트는지 말한다.
7. Zoom "컴퓨터 소리 공유" ON.

## 7. 무엇이 바뀌면 이 문서를 고쳐야 하나

- **`onPickType` 을 null로 바꾸면 Ⓒ의 `Types` 가 사라진다** → C9를 통째로 다시 짜야 한다(대체 경로 없음 — 준비된 분류가 Clay에서 사라진다).
- **`StarterPicker` 의 `onPick` 이 definition을 WHEN에 안 넣게 되면** → S9가 무너진다(직접 타이핑으로 되돌리고 길이를 재계산).
- **`IntentHistory` 의 `Restore` / 확인 문구** → S5와 `01_PLAN` §5.
- **① 덱의 문구를 고치면** → `02_CONCEPT_SLIDES.md` → `slides/build.py` → 재렌더 → `06_NARRATION` ①트랙. 넷이 같이 움직인다.
- **Deploy 팝오버** — 문구와 `Deploy and finish` 는 `score/page.tsx` 의 `PhaseAdvance` `blocked` prop(`:191`), `Not yet` 은 `components/study/PhaseAdvance.tsx`(`:208`) → C10·S10과 `06_NARRATION`.
- **taxonomy(`src/lib/score/default-config.ts`)에서 `Shorten / Trim`(RE04) 이 사라지거나 이름이 바뀌면** → 관찰 ③ 전체.
- **데모 20명 구성이 바뀌면** → `03_SCENARIO` §3의 실측 표 전부(앵커 `P19 · 2` / `P29 · 3` / `P29 · 5` / `P29 · 8`).
- **마스터의 `custom_system_prompt` / `include_instruction_in_prompt` 가 바뀌면**(재임포트·과제 편집 포함) → Clay의 `0 / 8000` 첫 프레임과 Slate의 `Uncategorized` 빈 THEN이 **글이 든 상자로 바뀐다**. C4의 타이핑·카운터가 전부 달라진다.
- **`demoSegmentsFor` / `STUDY_DEMO_VIDEOS`(`src/lib/study/config.ts`)** → `01_PLAN` §1-1·§6.

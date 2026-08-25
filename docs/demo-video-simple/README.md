# 데모 영상 v2 (Simple) — 촬영 런북

> Simple 스터디용 워크스루 4편을 찍고 발행하기까지. 기획 `01_PLAN.md` · 시나리오/원문 `02_SCENARIO.md` · 스크립트 `03/04/05_SCRIPT_*.md` · 녹음 `06_NARRATION.md`.
>
> ⚠ **2026-08-23 개정.** 08-22 11:32 이후 53커밋이 화면을 바꿨다 — 특히 **Deploy가 블록을 끝내는 되돌릴 수 없는 한 번**이 되었고(`I'm done` 소멸), 소속 diff 색이 사라졌고, ⓒ에 `Types` 피커가 생겨 C5가 다시 짜였다. **`shots/`는 같은 날 실제 데모 워크스페이스로 1920×1080 재촬영했다**(23장 · `shots/README.md`).
>
> 구 런북(`docs/demo-video/README.md`)의 일반 절차(서버·브라우저·업로드)는 그대로 유효하다 — 여기는 차이만 적는다.

**찍을 것 4개** (ⓐ는 보드별 2테이크):

| 파일 | 무엇 | 어디서 |
|---|---|---|
| `getting-around-simple-slate.mp4` | ⓐ, Slate 보드 | `Run demo · Simple SCORE` |
| `getting-around-simple-clay.mp4` | ⓐ, Clay 보드 | `Run demo · Simple Baseline` |
| `simple-slate.mp4` | ⓑ | `Run demo · Simple SCORE` |
| `simple-clay.mp4` | ⓒ | `Run demo · Simple Baseline` |

## 1. 사전 확인 (촬영 전날)

- [ ] `/study/admin/curation?ds=nirvana` — Demo students 20명, **"20 students · 103 questions isolated"**.
- [ ] `.env`의 `OPENAI_API_KEY` 유효(판정·응답·이름 생성).
- [ ] `npx tsx --env-file=.env scripts/study/check-simple.ts --view simple_score` / `--view simple_baseline` 통과.
- [ ] **리허설 1회**: ⓑ·ⓒ를 끝까지. `02_SCENARIO.md` §5 분기표에서 어느 가지로 가는지, 특히 ⓑ 비트 5의 **경계 질문이 무엇인지** 적어 둔다(본 촬영은 새 Run demo — 판정이 ±2 다를 수 있다).
- [ ] 리허설에서 **타이핑 원문을 손에 익힌다** — Simple은 타이핑이 화면의 중심이다. 오타 후 수정도 자연스러우니 한두 개는 그대로 두어도 된다.
- [ ] **리허설에서 확인할 것 [08-23]**: ⓒ의 `Types` ▾에 **Drafting**이 있고 그 카운트가 0이 아니다 · ⓑ에서 Add 직후 카드가 저절로 열린다 · Save가 Apply 전에는 dim이다 · Deploy 팝오버가 예정대로 뜬다(**Deploy and finish는 리허설에서도 누르지 않는다** — 누르면 그 클론이 끝난다).

## 2. 서버·브라우저 (구 런북 §2–3과 동일)

- **프로덕션 빌드**로: `rm -rf .next && npm run build && PORT=3030 npm run start` — dev는 "N" 배지 + 컴파일 멈칫.
- 1920×1080 · F11 · 줌 100% · 커서 하이라이트 · 무음 녹화.
- `/study/admin` → R1 + passcode → curation.

## 3. 한 편 찍는 순서

1. curation에서 **Run demo · Simple SCORE**(또는 **· Simple Baseline**) — 워크스페이스 재구축 후 `/studio/<id>` 브리핑 모달로 들어간다.
2. 녹화 시작 → 스크립트 순서대로 → 녹화 종료 → §4 체크리스트 대조.
   - **마지막 비트는 Deploy 팝오버에서 홀드하고 끝낸다.** `Deploy and finish`를 누르면 배포 + 블록 종료 + `/study/session` 이동이 한 번에 일어나 보드로 못 돌아온다 — 그 테이크를 다시 찍으려면 `Run demo`를 새로 돌려야 한다(assignment id가 바뀌고 브리핑 모달도 다시 열린다). 실수로 팝오버가 열렸을 뿐이면 **Not yet**으로 닫는다.
3. **다음 편은 반드시 `/study/admin`을 거쳐서** — 데모 세션 쿠키를 든 채 curation으로 직행하면 404다(`/study/admin`이 return 쿠키를 소비해 연구자로 복귀시킨다). 주소창에 `localhost:3030/study/admin` 입력 → 자동으로 curation으로 돌아온다.
4. Run demo는 매번 클론을 새로 만든다 — 앞 테이크의 intent·rules·핀은 남지 않는다.

## 4. 촬영 직후 체크리스트 (테이크마다)

- [ ] "N" 개발 배지 없음(프로덕션 빌드)
- [ ] 헤더 **Participant DEMO** · 뒤로가기 화살표 없음 · 주소창 없음(전체화면)
- [ ] ⓒ 화면·자막에 "intent" 0회
- [ ] 경과 칩 단조 증가(한 테이크)
- [ ] 스크립트 인용 라벨 = 실제 화면(다르면 스크립트를 고친다 — UI가 진실)
- [ ] **판정·응답 스트리밍이 프레임에 남아 있다**(과편집 금지 — 속도가 이 버전의 주장)
- [ ] ⓐ: 뷰어에서 **This reply is the one that was delivered.** 한 줄을 짚었다(드롭다운을 찾지 않았다) · Clay 테이크에서 **Types를 누르지 않았다**
- [ ] ⓑ: 두 경로(행 `+` / `+ New intent`)가 다 나왔다 · Examples 추가 ✨와 **Furthest first** 전환이 나왔다 · 모델 예시 3(이탤릭)이 보였다 · Apply 뒤 **`v{n} · unsaved` 행과 카운트**를 짚었다(사라진 색 신호 대신)
- [ ] ⓒ: 핀 2개가 선반에 있었고 **Apply마다 선반에서 확인**했다 · 문서가 두 사이클에 걸쳐 자랐다 · **Types로 좁혀 읽고 ✕로 지운 뒤 핀에서 확인**했다 · 뷰어 드롭다운 **맨 아래**의 **v0 · Original (as delivered)** 를 골랐다 돌아왔다
- [ ] 마지막: **Deploy 팝오버**(Not yet / Deploy and finish)에서 홀드, **누르지 않음**
- [ ] LLM 제목·버전 이름을 내레이션이 읽지 않았다

## 5. 편집 → 발행

1. 패리티 규칙(`01_PLAN` §4)대로. 5 s 초과 대기만 ≤2 s 컷, 스트리밍은 유지. 타이틀 카드 2 s · 마지막 홀드 2 s · VO 얹기.
2. ⓑ(~170 s)·ⓒ(~180 s) 길이 차 **≤ 20 s**(`01_PLAN` §4 [08-23 완화] — 초 단위로 맞추지 않는다). 블록 1(ⓐ+자기 버전)이 4분을 넘으면 `01_PLAN` §2의 흡수 순서를 따른다.
3. YouTube Unlisted · 제목 "Getting around"/"Slate"/"Clay" · 설명 비움.
4. `.env`에 id → **재빌드** → 확인:
   ```
   NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_SCORE="…"
   NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_BASELINE="…"
   NEXT_PUBLIC_STUDY_DEMO_SIMPLE_SCORE="…"
   NEXT_PUBLIC_STUDY_DEMO_SIMPLE_BASELINE="…"
   ```
5. 확인은 simple family 참가자로 `/study/session`(not_started → ⓐ+자기 버전 / break → 다른 버전). 빈 슬롯이 남으면 그 슬롯이 **필요한 변수명을 그대로** 표시한다.
6. Zoom "컴퓨터 소리 공유" ON.

## 6. 무엇이 바뀌면 이 문서를 고쳐야 하나

- SimpleStudio의 라벨(Setup · Kept in view · Working out this reply under · Examples · Closest/Furthest first · Generate/Update examples · Starter sets · Types · Add …) → `01_PLAN` §5와 스크립트 인용 수정.
- **`PhaseAdvance`의 Deploy 팝오버 문구·버튼**(`src/app/instructor/assignments/[id]/score/page.tsx`의 `blocked`) → ⓐA5·ⓑB7·ⓒC7과 `06_NARRATION`.
- **`onPickType`을 null로 바꾸면 ⓒ의 Types가 사라진다** → C5를 구 버전(대필 질문을 검색으로 찾기)으로 되돌리고 `01_PLAN` §2-1을 고친다.
- 데모 20명 구성 → `02_SCENARIO` §3의 재료 표(앵커 P19 · 2, 대필 P11 · 1, 분류 Drafting)와 §4 원문 재선정.
- `demoSegmentsFor`/`STUDY_DEMO_VIDEOS`(`src/lib/study/config.ts`) → `01_PLAN` §2·§7.

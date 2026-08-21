# 데모 영상 — 촬영 런북

> 참가자에게 보여 줄 워크스루 영상 3편(ⓐ Getting around · ⓑ Slate · ⓒ Clay)을 찍고 발행하기까지의 절차. 기획은 `01_PLAN.md`, 시나리오는 `02_SCENARIO.md`, 샷·내레이션은 `03/04/05_SCRIPT_*.md`, 녹음 원고는 `06_NARRATION.md`. `shots/`는 2026-08-19 기준 참고 화면.

**찍을 것 4개** (ⓐ는 보드별로 두 테이크):

| 파일 | 무엇 | 어디서 |
|---|---|---|
| `getting-around-slate.mp4` | ⓐ, Slate 보드에서 | `Run demo · SCORE` |
| `getting-around-clay.mp4` | ⓐ, Clay 보드에서 | `Run demo · Baseline` |
| `slate.mp4` | ⓑ | `Run demo · SCORE` |
| `clay.mp4` | ⓒ | `Run demo · Baseline` |

---

## 1. 사전 확인 (촬영 전날)

- [ ] `/study/admin/curation?ds=nirvana`의 **Demo students** = 20명 선택, 칩이 **"20 students · 103 questions isolated"**.
- [ ] `.env`에 `OPENAI_API_KEY`가 있고 유효하다 (후보 생성·판정·제안·프리뷰가 전부 LLM이다).
- [ ] Postgres 떠 있음: `pg_isready -h 127.0.0.1 -p 5432`.
- [ ] 한 번 리허설: ⓑ와 ⓒ를 처음부터 끝까지 밟아 보고 `02_SCENARIO.md` §5 분기표의 어느 가지로 가는지 확인. **LLM 출력은 매번 다르므로 리허설과 본 촬영의 문구가 달라도 정상.**
- [ ] **리허설에서 반드시 적어 둘 것**: 룰 워크벤치의 **탭 2가 어떤 질문인지**(ⓑ·ⓒ 각각), 그리고 비트 6에서 칠 **Rewrite 두 줄**(`02_SCENARIO.md` §4-1의 표에서 고르거나 즉석에서 작성). 본 촬영은 **다시 Run demo**로 시작하므로 탭 2가 바뀔 수 있다 — 바뀌면 같은 원칙으로 그 자리에서 쓴다.

## 2. 서버 — 프로덕션 빌드로 띄운다

개발 서버는 (1) 처음 여는 화면마다 컴파일로 멈칫하고 (2) 왼쪽 아래 **"N" 개발 배지**가 프레임에 박힌다. 촬영은 프로덕션 빌드로:

```bash
cd ~/swag
command -v ss >/dev/null || export PATH=$PATH:/usr/sbin
ss -tlnpH "sport = :3030" | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9
rm -rf .next                      # dev와 .next를 공유하므로 반드시 지우고 빌드
npm run build                     # ~2분
PORT=3030 npm run start > /tmp/swag-prod.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/login   # → 200
```

- 촬영이 끝나면 되돌리기: `ss …| xargs -r kill -9` → `rm -rf .next` → `npm run dev`.
- `NEXT_PUBLIC_STUDY_DEMO_*`는 **빌드 타임**에 박힌다. 영상 id를 넣은 뒤에는 다시 빌드해야 재생 확인이 된다(§6).

## 3. 브라우저 세팅

- [ ] 창을 **1920×1080**로. 확장 프로그램·알림 끄기. 다크 모드 아님.
- [ ] `http://localhost:3030/study/admin` → 코드 `R1` + `.env`의 `STUDY_ADMIN_PASSCODE` → curation 보드.
- [ ] **F11 전체화면** — 주소창·탭·북마크가 프레임에서 사라진다. (전체화면을 쓰지 않으면 주소창의 `/studio/<id>`가 찍힌다. 중립 경로라 치명적이지는 않지만 프레임이 지저분하다.)
- [ ] 줌 100%. 세 열이 다 들어오는지 확인.
- [ ] 커서 하이라이트 ON, 클릭 소리 OFF.
- [ ] 화면 녹화는 **무음**(보이스오버는 따로).

## 4. 한 편 찍는 순서

1. curation 보드에서 **Run demo · SCORE**(또는 **· Baseline**) 클릭 — 워크스페이스를 새로 만드느라 **~20–60초** 걸린다. 들어가면 브리핑 모달이 열린 보드다.
   - 매번 새로 만들므로 **앞 테이크의 intent/filter/rule은 남지 않는다.** 실패하면 그냥 다시 Run demo.
   - 헤더 경과 시간이 **0–1 / 25 min**에서 시작한다(Run demo가 시계를 새로 건다).
2. 녹화 시작 → 스크립트대로 끝까지. **한 세그먼트는 한 테이크**(경과 시간 칩이 이어져야 한다).
3. 녹화 종료. 곧바로 스크립트의 라벨과 실제 화면을 대조(§5 체크리스트).
4. 다음 편은 **다시 Run demo**부터. 나가는 길은 주소창에 `localhost:3030/study/admin` — 데모 안에는 뒤로가기가 없다(의도된 것: 참가자 화면과 같게).

**타이핑할 원문**은 `02_SCENARIO.md` §4. 미리 클립보드에 넣지 말고 **화면에서 타이핑**한다(참가자가 "여기에 이렇게 쓰는구나"를 봐야 한다). 단, ⓒ C3의 긴 설명은 붙여 넣어도 되고, 그때는 문구가 바뀐 것이 보이도록 1–2초 멈춘다.

## 5. 촬영 직후 체크리스트 (테이크마다)

- [ ] 프레임에 **"N" 개발 배지**가 없다 (프로덕션 빌드로 찍었나)
- [ ] 헤더가 **Participant DEMO** — `DEMO-SCORE`/`DEMO-BASELINE`이 아니다
- [ ] 헤더 왼쪽에 **뒤로가기 화살표가 없다**
- [ ] 주소창이 프레임에 없다(전체화면). 있다면 `/studio/<id>`인지 확인
- [ ] ⓒ 화면 어디에도 "intent"라는 글자가 없다
- [ ] 헤더 경과 시간이 테이크 안에서 **단조 증가**한다(컷 자국 없음)
- [ ] 스크립트가 인용한 버튼 라벨이 실제 화면과 같다 — 다르면 스크립트를 고친다(UI가 진짜다)
- [ ] 마지막에 **Students receive v1** + **I'm done**이 보인다. **I'm done은 누르지 않았다**
- [ ] rule 수정 **세 경로**가 다 나왔다 — 비트 5 피드백(시연) · 비트 6 `✎ Rewrite instead`(시연) · 비트 5 VO에서 직접 편집(지목). 두 편이 같은 자리에서 같은 것을 한다
- [ ] 룰 워크벤치에 **뷰어의 `Revise rule ›`/`Revise rules ›`로** 들어갔다(인스펙터의 `Edit Rule` 아님) — ★ 앵커가 양쪽 다 **P19 · T2**여야 한다

## 6. 편집 → 발행

1. **편집** — `01_PLAN.md` §4 패리티 규칙대로. LLM 대기는 각 ≤2초로 자른다(양쪽 같은 단계를 같은 길이로). 타이틀 카드 2초, 마지막 프레임 2초 홀드. 보이스오버를 얹는다(`06_NARRATION.md`).
2. **길이 확인** — ⓑ와 ⓒ의 차 **≤ 15초**(목표 7초). 넘으면 긴 쪽의 대기 컷을 더 줄인다.
3. **업로드** — YouTube **Unlisted**, 임베드 허용, 챕터·엔드스크린·카드 없음, 설명란 비움. 제목은 `Getting around` / `Slate` / `Clay`(ⓐ 두 편은 같은 제목이어도 된다 — 참가자에게는 하나만 보인다).
4. **연결** — `.env`에 id(`?v=` 뒤)를 넣는다:

   ```
   NEXT_PUBLIC_STUDY_DEMO_COMMON_SCORE="…"      # getting-around-slate
   NEXT_PUBLIC_STUDY_DEMO_COMMON_BASELINE="…"   # getting-around-clay
   NEXT_PUBLIC_STUDY_DEMO_SCORE="…"             # slate
   NEXT_PUBLIC_STUDY_DEMO_BASELINE="…"          # clay
   ```
   `…_COMMON_*` 대신 `NEXT_PUBLIC_STUDY_DEMO_COMMON` 하나만 두면 두 조건이 그것을 함께 쓴다(보드가 반은 어긋난다 — 권장하지 않음).
5. **재빌드 후 확인** — `NEXT_PUBLIC_`은 빌드 타임이므로 `npm run build` 다시. 그다음 참가자 화면에서 확인:
   - 콘솔(`/study/admin/console`)에서 데모가 아닌 테스트 참가자를 `not_started`로 두고 `/study/session`을 열면 **Before you start**에 ⓐ+자기 버전 2편이, `break`에서는 다른 버전 1편이 뜬다.
   - 각 플레이어가 실제로 재생되는지(빈 슬롯 = id 오타), 소리가 나는지.
6. **세션 준비** — Zoom 화면 공유 시 **"컴퓨터 소리 공유" ON**(설계 §5.1). 재생은 세션 중 그 자리에서(사전 발송 없음).

## 7. 촬영 후 정리

- 데모 참가자(`DEMO-SCORE` / `DEMO-BASELINE`)는 `is_demo`로 표시되어 **콘솔과 metrics export에서 제외**된다. 남겨 두어도 데이터에 영향 없다.
- 다음 Run demo가 클론을 지우고 다시 만든다 — 별도 청소 불필요.
- 서버를 dev로 되돌린다(§2).

## 8. 무엇이 바뀌면 이 문서를 고쳐야 하나

- 보드의 버튼 라벨(`Your task`, `New intent`, `Revise rules`, `Add example`, `Rewrite instead`, `Propose rule from my rewrite`, `Use this rule` …) → 스크립트의 인용을 고친다.
- 데모 학생 20명 구성 → `02_SCENARIO.md` §3의 재료 표와 앵커(P19 · Turn 2), 경계(P38 · Turn 1), §4-1의 Rewrite 문구 표를 다시 고른다.
- 세그먼트 구성(`demoSegmentsFor` in `src/lib/study/config.ts`) → `01_PLAN.md` §2.

# USER_STUDY 문항지 (v1)

> 작성 2026-08-11 (같은 날 국문 병기 추가) · **2026-08-12 §1 스크리너 전면 개정**. 참가자에게 실제로 제시되는 **모든 문항과 진행자 발화의 원문**. `USER_STUDY 설계 v2.md`의 [준비] 중 "미니 설문 원문 · 인터뷰 가이드 · 관찰 메모 양식"에 스크리너와 세션 핵심 발화를 더해 한 문서로 묶는다. 튜토리얼 고정 대본 2벌은 별도 문서로 만든다(이 문서 범위 밖).
>
> **08-12 §1 개정 요약.** 모집 경로가 Prolific 재접촉 → **Replay_Quality 서베이(2026-05, `study/Replay_Quality.qsf`) 응답자 메일링 리스트**로 확정됨에 따라 스크리너를 다시 설계했다. 인구통계·경력·genAI 태도·syllabus AI 정책은 그 서베이에서 **연결해 오고**(재질문 없음, §1-0), 스크리너는 **게이트 + 그 서베이에 없는 배경 + 운영**만 받는다(~4분). IRB는 24-325 amendment.
>
> **언어 전제.** 참가자 대면 텍스트는 전부 **영어**다 — Prolific 모집, 영어 UI(Intent / Rule / Rules / Deploy), 영어 데이터셋. 세션도 영어로 진행한다. 각 문항 아래의 **국문:** 줄은 검토·IRB용 **참고 번역**이며 참가자에게 제시되지 않는다.
> 미확정은 **[파일럿]** 표시. 문항→측정 대응은 각 절의 주석에 명시.

---

## 0. 문구 원칙

- **중립 어휘.** 진행자의 공통 발화에서 "rules", "prompt"를 쓰지 않는다 — "setup" / "configuration"으로 말한다. 예외는 블록 테스트의 포인팅 질문뿐이다: 각 조건의 화면 요소(intent / Rules document)를 지칭하는 것은 편향이 아니라 지칭이다.
- **평가는 문항에 묶는다.** "이 도구가 좋은가"를 묻지 않는다 — "이 응답이 당신이 원한 답인가"를 묻는다.
- **척도.** 문항 판정 5점(1–5, 양끝 앵커) · 설문 7점 동의(1–7). [파일럿: 5점 통일 여부]
- 구두 응답(서술·포인팅·프로브)은 녹화에서 전사한다.
- 어느 쪽이 연구팀 시스템인지 묻는 참가자에게: *"We're comparing the two designs — I can tell you more after the session."*
  - 국문: "두 설계를 비교하는 중이라서요 — 세션이 끝난 뒤에 더 말씀드릴 수 있습니다."

---

## 1. 세션 전 폼 2종 (2026-08-14 분할)

**최소 수집 원칙**에 따라 사전 수집을 두 단계로 나눈다 — 자격 판정에 필요한 것만 먼저 받고, 나머지는 참여가 확정된 사람에게만 받는다.

| | **1A. Screening Survey** | **1B. Consent Form with Background Survey** |
|---|---|---|
| 언제 | 메일링 리스트 초대 시 | 세션 **하루 전 자동 발송** (예약 시각 기준) |
| 누구에게 | 리스트 전원 | Bookings로 예약을 마친 사람만 |
| 받는 것 | 연결 동의 · 이메일 · **게이트 5문항** | **정식 동의**(IRB 24-325) · 배경 8문항 |
| 끝나면 | 적격자는 **Bookings로 직접 예약** | 세션 참여 |
| 분량 | ~2분 | ~5분 |
| qsf | `study/SCORE_Screening_Survey.qsf` | `study/SCORE_Consent_Form_nologic.qsf` |

> **이 절이 SoT이고 qsf는 산출물이다** — 문구를 고치면 Qualtrics에서 함께 고칠 것. 각 문항의 `DataExportTag`가 아래 S-번호·Q-번호와 일치하므로 응답 export가 이 문서와 그대로 대응하고, **두 폼이 `S0c`(이메일)라는 같은 태그를 공유**해 조인 키가 된다.
>
> `_nologic` 파일은 **분기·표시 로직을 뺀 것**이다(문항·블록·순서는 동일). 임포트 후 Qualtrics UI에서 §1B-4의 로직을 직접 넣는다. 구버전 `SCORE_Screener*.qsf`·`SCORE_Recruitment_Survey.qsf`는 `_archive/`로 이동했다.
>
> **선발 통제를 포기한 대가.** 예약이 완료 화면의 Bookings 링크로 바로 이어지므로 선발은 사실상 **적격자 선착순**이다. 표본 구성(직위·수준 편중)을 고를 수 없게 되지만, 4셀 배정(조건 순서 × 데이터셋)은 예약자에게 사후 배정하면 되므로 영향받지 않는다. Bookings 슬롯을 **18개로 캡**해 초과 예약을 막는다.

### 1-0. 이전 서베이에서 연결해 오는 변인 (재질문 없음)

| 변인 | 출처 (`Replay_Quality.qsf`) | 형식 |
|---|---|---|
| 연령 | QID2 | 자유 텍스트(정확 나이) |
| 성별 | QID3 | 5범주 + 자기기술 |
| 인종 | QID4 | 다중선택 7 |
| 담당 교과 | QID5 | 자유 텍스트 |
| 교수·강사 경력 연수 | QID6 | 자유 텍스트 |
| genAI 사용 빈도 (2026-05 시점) | QID7 | Daily / 4–6× / 2–3× / 1× / Never |
| genAI TAM 12문항 — **업무 일반 맥락** | QID8 | 7점 동의 |
| 후속 인터뷰 참여 의향 | QID10 | 예/아니오 |
| 글쓰기 집중 수업의 syllabus AI 가이드라인 | QID11 | 자유 텍스트 |
| 학술 이메일 | QID9 | 텍스트 |

주석: **연결 키는 학술 이메일 문자열**이다 — Replay_Quality는 Qualtrics contact list embedded data 없이 단일 블록 익명 링크로 배포되어 패널 ID가 없다. 그래서 **두 폼 모두 `S0-c`에서 "이전과 같은 주소"를 명시적으로 요청**하고, 불일치는 수기 대조한다. **기관 유형은 묻지 않고 이메일 도메인으로 코딩**한다. TAM(QID8)은 *업무 일반*의 유용성·용이성이라 교육적 스탠스를 재지 않지만, 그 공백은 QID11(syllabus AI 가이드라인 자유 텍스트)과 그 현재 시점 갱신인 S8이 메운다. TAM 재측정은 하지 않는다(12문항 대비 이 연구의 RQ와 거리가 멀다).

**Prolific 쪽에서 오는 것 (집단 수준만).** Replay_Quality는 Prolific의 $0.50 sign-up/verification 스터디로 배포되었고, 모집단은 다음 필터의 AND로 정의되었다 — **Current Job Role** ∈ {Adjunct Faculty / Lecturer – College, Lecturer / Professor – College, School Principal / Head Teacher, Secondary School Teacher, University Lecturer / Professor} · **First Language** = English · **Country of Residence** ∈ {UK, US, Canada}. 광고문은 "writing-intensive courses (ideally STEM-based writing)"를 명시했다.

- 이 필터 자체가 **참가자 절에 그대로 쓸 표본 정의**이고, 동시에 **일반화 한계**다(영어 모어 · 영미권 3개국).
- **Job Role 필터에 K-12(교장·중등교사)가 포함**되어 있다. **배제하지 않는다**(2026-08-12 결정) — 근거는 §1-2 주석과 결정 로그 §13. S1에서 "college-level"을 빼고 수준은 S1-b로 기록만 한다.
- **Prolific 인구통계 export는 개인 단위로 연결되지 않는다** — Replay_Quality의 flow에 embedded data가 전혀 없어 `PROLIFIC_PID`가 캡처되지 않았고, 응답을 Prolific 레코드에 매칭할 키가 없다. 따라서 Prolific 쪽 변인(직위·고용 상태 등)은 **모집 풀 수준의 기술**로만 보고하고, 개인 단위로 필요한 **직위는 S2-b로 새로 받는다.**

## 1A. Screening Survey (`SCORE_Screening_Survey.qsf`)

블록 4개 — Consent and linking / Eligibility / Not eligible / Completion. **게이트 = S0-b · S1 · S2 · S9.**

### 1A-1. 안내와 연결 동의

- **S0-a (안내문).** *"Earlier this year you signed up through Prolific and completed an essay-grading session for our research on how students use ChatGPT for writing (Virginia Tech IRB 24-325). You gave us this email address at that time so we could send you the main task, and we are using it now to invite you to a **new, separate study** in the same project. (This is not the 30-minute interview about your grading that was mentioned earlier.) In a ~90-minute Zoom session, you will look at real conversations that students had with a course chatbot and use two versions of a configuration tool to set the chatbot up to behave the way you want. Sessions are recorded (screen and audio). Compensation is $60 on completion. Participation is voluntary and you may withdraw at any time — and if you would rather not hear from us again, reply to the invitation and we will remove your address. **Spots are limited: this short survey is to check fit and availability, and we will contact selected respondents to schedule a session.** To avoid asking you the same background questions twice, we would like to link your answers below to the responses you gave in the earlier survey."*
  - 국문: "올해 초에 Prolific을 통해 신청하시고, 학생의 ChatGPT 글쓰기 사용에 관한 저희 연구(버지니아텍 IRB 24-325)의 에세이 채점 세션에 참여해 주셨습니다. 그때 본 과제 발송을 위해 알려 주신 이메일 주소로, 같은 프로젝트의 **새로운 별개 연구**에 초대드립니다. (앞서 안내드렸던 채점 관련 30분 인터뷰와는 다른 연구입니다.) 약 90분의 Zoom 세션에서, 학생들이 수업용 챗봇과 나눈 실제 대화를 보시면서 설정 도구의 두 가지 버전으로 챗봇이 원하시는 대로 동작하도록 설정해 보시게 됩니다. 세션은 화면과 음성이 녹화됩니다. 완료 시 $60이 지급됩니다. 참여는 자발적이며 언제든 중단하실 수 있고, 더 이상 연락을 원치 않으시면 회신해 주시면 주소를 삭제하겠습니다. 같은 배경 질문을 두 번 드리지 않기 위해, 아래 응답을 이전 설문 응답과 연결하고자 합니다."
- **S0-b (동의).** *"Do you agree to participate, and to have these answers linked to your earlier survey responses? (Linking is required for participation in this study.)"* — Yes / No **[No → 종료]**
  - 국문: "참여에 동의하시고, 이 응답을 이전 설문 응답과 연결하는 데 동의하십니까? (이 연구 참여를 위해서는 연결이 필요합니다.)" — 예 / 아니요
- **S0-c (연결 키 — 표시 로직: S0-b = Yes).** *"Please provide the institutional email address you used in the earlier survey (e.g., .edu, .ac.uk). We use it to match your answers to your earlier responses, and — if you are eligible — you will use the same address to book your session at the end. If you no longer use that address, please give your current one and note the old one."*
  - 국문: "이전 설문에서 사용하신 기관 이메일 주소(예: .edu, .ac.uk)를 적어 주세요. 응답 매칭에 쓰이며, 자격이 되시면 마지막에 같은 주소로 세션을 예약하시게 됩니다. 더 이상 그 주소를 쓰지 않으시면 현재 주소를 적고 이전 주소를 함께 적어 주세요."
  - 주석: **위치가 맨 앞인 이유** — ① Qualtrics가 부분 응답을 보관하므로(`PartialData +1 week`) 뒤에 두면 중도 이탈자가 식별 불가능한 고아 행이 된다, ② 연결 동의(S0-b) 바로 다음이라 논리적으로 붙는다, ③ **완료 화면에 piped text로 되박아** *"Please book using **john@vt.edu**"*라고 실제 주소를 보여줄 수 있다(`${q://<S0c의 QID>/ChoiceTextEntryValue}` — 편집기의 {A} → Entered Text로 삽입). 원 서베이 QID9는 *".edu preferred"*였으나 모집단이 UK·Canada를 포함하므로 `.ac.uk`를 예시에 넣는다.
  - **표시 로직이 필수다** — 없으면 동의를 거부한 사람도 필수인 이메일을 채워야 다음으로 넘어간다(Flow 분기는 블록이 끝난 뒤 평가되므로). 갇히는 문제이자, 거부자에게서 식별정보를 받아내는 문제다.

주석: 이전 동의문(QID12)은 replay 채점 과제만 서술하고 **응답의 후속 스크리닝 재사용을 언급하지 않는다.** IRB 우산(24-325 amendment)과 별개로 연결 고지가 필요한 이유. 이메일도 마찬가지로 *"verify your position and send the main survey"*라는 **명시된 용도로 받은 것**이므로, 새 연구 초대는 (a) 출처를 밝히고 (b) 옵트아웃을 제공하며 (c) amendment에 재사용 범위가 들어가 있어야 한다. 광고된 "30분 후속 인터뷰"와 혼동되지 않게 **별개 연구임을 명시**하는 문장도 필수 — 그렇지 않으면 미끼성 초대가 된다.

### 1A-2. 게이트

- **S1.** *"Are you currently teaching — or have you recently taught — a course in which students complete writing assignments (essays, reports, discussion posts, etc.)?"* — I am teaching one now / Yes, within the past 2 years / Yes, but longer ago than that / No **[뒤 두 항목 → 종료]**
  - 국문: "학생들이 글쓰기 과제(에세이, 보고서, 토론글 등)를 수행하는 수업을 현재 가르치고 계시거나 최근에 가르치신 적이 있습니까?" — 현재 진행 중 / 예, 최근 2년 이내 / 예, 그보다 이전 / 아니요
- **S1-b (게이트 아님 — 수준, 다중 선택).** *"At what level do (or did) you teach those writing assignments?"* — Undergraduate, first-year or introductory composition / Undergraduate, upper-level / Graduate / Secondary school (high school) / Other
  - 국문: "그 글쓰기 과제를 어느 수준에서 지도하십니까(하셨습니까)?" — 학부 1학년·기초 작문 / 학부 상급 / 대학원 / 중등(고등학교) / 기타
- **S2.** *"In that course (or the most recent such course), are — or were — you responsible for guiding students' writing: giving feedback, setting expectations, or answering their questions?"* — Yes / Partially / No **[No → 종료]**
  - 국문: "그 수업(또는 가장 최근의 해당 수업)에서 학생들의 글쓰기를 지도하는 역할 — 피드백 제공, 기대 수준 설정, 질문 응대 — 을 맡고 계십니까(계셨습니까)?" — 예 / 부분적으로 / 아니요
- **S2-b (게이트 아님 — 직위).** *"Which best describes your current position?"* — Professor (tenured or tenure-track) / Lecturer or Instructor / Adjunct or contingent faculty / Postdoc or graduate instructor / Secondary school teacher / Other
  - 국문: "현재 직위를 가장 잘 나타내는 것은 무엇입니까?" — 정년·정년트랙 교수 / 강사(Lecturer·Instructor) / 겸임·비정년 교원 / 박사후연구원·대학원 강의자 / 중등교사 / 기타
- **S9.** *"This study is a ~90-minute Zoom session. Can you join from a desktop or laptop with Chrome, and share your screen during the session?"* — Yes / No **[No → 종료]**
  - 국문: "이 연구는 약 90분의 Zoom 세션입니다. 데스크톱 또는 노트북에서 Chrome으로 접속하고, 세션 중 화면을 공유하실 수 있습니까?" — 예 / 아니요

주석: S1·S2가 "기준은 교수자에게서 나온다" 전제의 게이트다 — 이전 서베이에는 게이트가 전무했고(QID5는 자유 텍스트) 5~6개월이 지났으므로 currency 확인을 겸한다. S1의 시점 선택지가 구 S3(최근성)를 흡수한다. **S2-b는 Prolific의 Job Role 필터가 개인 단위로 연결되지 않아 새로 받는 것**이다(§1-0) — 참가자 표의 직위 축이자, 겸임/정년트랙 구성이 편중되면 한계로 보고할 재료.

**중등교사를 배제하지 않는다 (2026-08-12 결정).** 그래서 S1에서 "college-level"을 빼고 수준은 S1-b로 기록만 한다. 근거 셋:
1. **논문의 근거 문헌이 상당 부분 K-12다.** rule 워크벤치 스캐폴드 칩 여섯 중 다섯이 그대로 대응하는 Liu et al.(2026)은 *K-12 Classroom Implementation*이고, 서론의 37.7% 정량 앵커도 그 연구다. 배제는 자기 인용과 어긋난다.
2. **"내 수업이 아닌 로그를 다룬다"는 조건은 전원에게 이미 참이다.** 참가자는 어차피 남의 강좌 로그(중립 주제명으로 제시)를 받아 설정한다 — 중등교사의 수준 격차는 종류가 아니라 정도의 차이다.
3. **측정이 참가자 내 자기참조다.** "좋은 응답의 기준은 각 교수자 자신에게서 나온다"이고 within-subjects이므로, 교수자 간 기준 차이는 노이즈가 아니라 전제다(설계 v2 §2).

단, 두 가지는 지킨다 — **수준(S1-b)을 4셀에 고르게 배정**해 조건 순서와 교락하지 않게 하고, 최종 구성이 한쪽으로 쏠리면 **참가자 절과 한계에 그대로 보고**한다.

### 1A-3. 종료 화면

- **탈락 (S0-b·S1·S2·S9 게이트 → "Not eligible" 블록).** *"Thank you for taking the time to respond. Based on your answers, this particular study isn't a match — we are looking for instructors who currently (or recently) teach writing-intensive courses and can join a 90-minute Zoom session. We appreciate your continued interest in our research."*
  - 국문: "시간 내어 응답해 주셔서 감사합니다. 답변을 보니 이번 연구와는 맞지 않는 것 같습니다 — 현재(또는 최근) 글쓰기 중심 수업을 가르치시고 90분 Zoom 세션에 참여 가능하신 교수자를 찾고 있습니다. 저희 연구에 계속 관심 가져 주셔서 감사합니다."
- **완료 ("Completion" 블록).** *"Thank you — you are eligible for this study.*
  *Please book your 90-minute session here: [Bookings URL]*
  *When you book, please use the same email address you gave at the start of this survey (`${q://<S0c>/ChoiceTextEntryValue}`) so we can match your booking to your responses.*
  *Spots are limited and fill on a first-come, first-served basis. Sessions are recorded (screen and audio) with your consent, and compensation is $60 on completion.*
  *A consent form will be emailed to you the day before your session; please complete it before we meet.*
  *Questions: sangwooklee@vt.edu"*
  - 국문: "감사합니다 — 이번 연구의 참여 조건에 해당하십니다. 아래에서 90분 세션을 예약해 주세요. 예약 시에는 이 설문 처음에 적어 주신 것과 **같은 이메일 주소**를 사용해 주세요. 자리가 제한되어 선착순으로 마감됩니다. 세션은 동의하에 화면·음성이 녹화되며 완료 시 $60이 지급됩니다. **세션 하루 전에 동의서 링크를 메일로 보내드리니 만나기 전에 작성해 주세요.**"
  - **[운영 확정 필요]** Bookings URL의 `?ismsaljsauthenabled` 파라미터 제거 여부 — **로그아웃 상태 브라우저에서 반드시 테스트**할 것(외부 참가자에게 MS 로그인을 요구하면 안 된다). Bookings 슬롯은 18개로 캡.
  - 주석: 동의서 사전 발송 안내가 여기 없으면 참가자에게는 예고 없는 메일이 된다.

---

## 1B. Consent Form with Background Survey (`SCORE_Consent_Form_nologic.qsf`)

예약 후 **세션 하루 전 자동 발송**. 블록 2개 — Consent Form / Background.

### 1B-1. 동의

- **Q1 (정식 동의문, 표시 전용).** VT HRPP 양식의 Information Sheet 전문. IRB # 24-325, PI Sang Won Lee, Lead Investigator Sangwook Lee. 절: *What should I know? / Confidentiality / Who can I talk to?* — 세션 절차·90분·녹화·$60(Amazon/Zelle/Venmo 택1)·자발성·참가자 번호 기반 저장·Sonix.ai 전사 후 삭제·5년 보관·HRPP 연락처.
  - **녹화 문구는 Q4와 일치해야 한다**: *"The session will be recorded through Zoom, including your screen and your audio. With your separate permission, your webcam video may also be recorded — webcam recording is optional, and you may decline it and still take part in the study."*
  - **연결 고지 포함**: *"This form also asks a few short background questions…; your answers may be linked to the responses you gave in our earlier survey and screening form so that we do not ask you the same questions twice."*
- **Q3 (동의).** *"By clicking the button below, you indicate you have read the consent document and that you consent to be in this study."* — *I have read the consent document and I consent to be in this study.* / *I do not consent to be in this study.* **[거부 → 종료]**
- **Q4 (웹캠 — 표시 로직: Q3 = 동의).** *"Optional: Do you agree to allow webcam video recording during the study session? You may still participate if you select No."* — Yes / No
  - **표시 로직이 필수다** — 없으면 동의를 거부한 사람도 필수인 Q4를 답해야 넘어간다(S0-c와 같은 유형의 함정).

### 1B-2. 배경

- **S0-c (연결 키).** *"Please confirm the email address you used to book your session (the same one you gave in the screening survey). We use it only to match this form to your booking and your earlier responses."*
  - 국문: "세션 예약에 사용하신 이메일 주소(스크리닝 설문에서 적으신 것과 동일)를 확인해 주세요."
  - 주석: 스크리닝의 S0-c와 **같은 태그**라 두 export를 그대로 조인한다. 자동 발송 URL에 `?email=…`을 붙일 수 있으면 이 문항 대신 Flow의 **Embedded Data**로 받는 편이 낫다(재입력 불필요).
- **S3 (교육용 챗봇 서비스 경험).** *"Some institutions now provide AI chatbot services for teaching — for example, ChatGPT Edu, a campus-wide AI tutor platform, or a chatbot built into an LMS such as Canvas, Blackboard, or Moodle. Instructors can set these up for a specific course so that students use them for their coursework. A custom GPT that you set up and shared with your class counts as well. Which best describes your experience with a chatbot like this?"*
  - As far as I know, my institution does not offer anything like this.
  - It is available at my institution, but I have not used it.
  - I have used one, but I did not change how it responds — I used it as provided.
  - I have set one up, or changed how it responds, for one of my courses.
  - 국문: "일부 기관은 교육용 AI 챗봇 서비스를 제공합니다 — 예컨대 ChatGPT Edu, 캠퍼스 전역 AI 튜터 플랫폼, Canvas·Blackboard·Moodle 같은 LMS에 내장된 챗봇. 교수자는 이를 특정 수업용으로 설정해 학생이 과제에 쓰게 할 수 있습니다. 직접 만들어 수업에 공유한 custom GPT도 해당됩니다." — 기관에 그런 것이 없는 것으로 안다 / 있지만 사용해 본 적 없다 / 사용해 봤지만 응답 방식은 바꾸지 않았다 / 내 수업용으로 설정하거나 응답 방식을 바꿔 봤다
- **S4 (배포 전 확인 — 표시 로직: S3 = 4번).** *"Before your students used it, how much did you check that it behaved the way you intended?"* — I tested it systematically across many cases / I tried a few examples / I did not really check; I adjusted it when problems came up
  - 국문: "학생들이 사용하기 전에, 의도한 대로 동작하는지 얼마나 확인하셨습니까?"
- **S3-b (프롬프트 저작 경험 일반).** *"Apart from that, have you ever changed how any AI chatbot responds — for example, by writing custom instructions or a system prompt, including for your own personal use?"* — No, never / Yes, occasionally / Yes, regularly
  - 국문: "그것과 별개로, 개인적 용도를 포함해 AI 챗봇의 응답 방식을 바꿔 보신 적이 있습니까 — 예컨대 custom instructions나 시스템 프롬프트를 작성하는 식으로?"
- **S5 (학생–AI 대화 열람).** *"In your own courses, have you ever read through conversations that your students had with an AI chatbot about their writing? (Not counting the student conversations you saw in our earlier grading study.)"* — No, never / Yes, a few conversations / Yes, many conversations
  - 국문: "선생님 수업의 학생들이 글쓰기에 관해 AI 챗봇과 나눈 대화를 직접 읽어 보신 적이 있습니까? (앞서 참여하신 채점 연구에서 보신 학생 대화는 제외합니다.)"
- **S5-b (열람 경로 — 표시 로직: S5 = 2·3번, 다중 선택).** *"How did you see them?"* — A student showed me / Students submitted them as part of an assignment / A course tool or platform logged them / Other
- **S7 (최근 글쓰기 과제).** *"Think of one writing assignment you have taught most recently. Briefly: what course was it, what kind of writing, what length (pages or words), and about how many students?"* (자유 텍스트)
  - **[판단 필요]** 현재 선택 응답(req=OFF). 세션 인터뷰의 이식성 질문을 이 답으로 구체화하므로 비어 있으면 진행자가 쓸 재료가 없다 — 필수로 되돌릴지 결정할 것.
- **S8 (수업 AI 정책의 현재 상태).** *"Earlier this year you told us about the generative-AI guidelines in your syllabus. Since then, has your policy for students' AI use changed?"* — No, it is about the same / Yes, it is more permissive now / Yes, it is more restrictive now / I now teach a different course with a different policy / I don't recall what I said then
- **S8-b (표시 로직: S8 = 2·3·4번).** *"In one or two sentences, what changed?"* (자유 텍스트)

주석 (각 항목이 논문에서 사는 자리):
- **S3** = 두 가지를 동시에 받친다. ① **서론 첫 문단의 전제** — draft §1은 *"여러 대학이 교수자가 강좌별 AI 튜터를 직접 만들 수 있는 캠퍼스 전역 플랫폼을 도입하면서, 이는 일부의 실험을 넘어 제도적 흐름이 되고 있다(Ko et al., CHI'26)"*라고 쓰는데 근거가 인용 하나뿐이다. 1·2번 선택지가 *"16명 중 n명의 기관이 이런 플랫폼을 제공하고 있었다"*는 자체 관측치를 준다. ② **참가자의 저작 비전문성** — 4번이 세션 과제와 정확히 같은 경험(학생이 쓸 챗봇의 행동을 설정)이므로, 4번의 희소성이 곧 "비전문가였다"의 근거다.
  - *2026-08-14 개정.* 구 S3은 *"AI chatbot을 설정해 본 적 있는가"*라 개인용 ChatGPT custom instructions와 학생용 PCA 저작이 같은 칸에 들어갔다. draft가 말하는 대상은 PCA(교수자가 설정해 학생에게 제공하는 챗봇)이므로 **stem에 대상을 명시**하고 선택지를 가용성→사용→저작으로 갈랐다. custom GPT와 API·코드 구분은 이 논문에서 쓰지 않으므로 4번으로 병합(교수 의견).
- **S3-b** = S3이 교육용 챗봇만 재는 탓에 생기는 공백을 메운다 — 개인용으로 system prompt를 매일 쓰는 사람과 한 번도 안 써 본 사람이 S3에서는 똑같이 1~2번에 들어간다. **Baseline 조건(모놀리식 프롬프트)의 수행을 설명할 가장 유력한 변인**이고, 서론이 기대는 Zamfirescu-Pereira 전제를 직접 받친다.
- **S4** = Koyama et al.(교사 제작 챗봇 121개 중 배포 전 체계적 테스트 사실상 전무)에 대한 자체 관측치. S3 = 4번에만 걸리므로 *"수업용 챗봇을 설정해 본 k명 중 j명만이 학생에게 열기 전에 확인했다"*는 정확한 대조가 된다. 다만 **k가 한 자릿수일 가능성이 높다** — corroborating observation 이상으로 밀지 않는다(비선발 응답자 데이터는 분석·보고하지 않는다 — 결정 로그 §12).
- **S5** = 배경 변인. 자기 학생의 AI 대화를 읽어 본 교수자는 학생이 무엇을 묻는지에 대한 사전 지식이 다르므로 질적 분석의 맥락이 된다. "이전 채점 연구 제외" 한정이 없으면 **전원이 해당해 변별력이 사라진다** — 그 연구의 replay는 NIRVANA 학생들의 ChatGPT 대화를 실제로 노출했다(2026-08-12 확인).
  - *구 S6(이전 연구의 replay 노출 정도)는 삭제.* 전원이 노출되어 분산이 없고, 그것이 위협한다고 본 "관찰 문제" 프레이밍은 애초에 이 연구의 주장이 아니다 — draft §4.2에서 **로그 뷰어·검색은 양 조건이 공유**하고 조작 변인은 저작 표현 하나뿐이며, draft 헤더 ①이 이미 thesis를 "관찰–수정–평가 루프"에서 "저작 표현 패러다임 비교"로 재중심화했다. 대신 남는 실제 쟁점은 **NIRVANA 사전 노출의 데이터셋 비대칭**이며, 이는 스크리너가 아니라 세트 큐레이션·배치에서 다룬다(설계 v2 §4·§7).
- **S7** = 세 군데서 값을 한다 — (a) SWAG/NIRVANA 과제와의 생태적 유사성 대조, (b) **인터뷰 §5-5 이식성 질문을 참가자 본인 과제로 구체화**("a different course" → "your ENGL 1105 argumentative essay"), (c) 참가자 표.
- **S8** = **QID11(syllabus AI 가이드라인 자유 텍스트, 2026-05)의 현재 시점 갱신.** 태도가 아니라 실제 정책을 묻고, 이미 가진 풍부한 자유 텍스트에 4~6개월치 델타만 얹는 구조라 구인 타당도 문제가 없다. 질적 분석에서 rule 내용의 허용–제한 성향을 해석할 때 가장 설명력 있는 배경 변인.
- ***구 S8(태도 3문항)은 삭제 (2026-08-12).*** 하나의 척도처럼 묶여 있었지만 실제로는 세 가지 다른 일을 했고, 셋 다 값이 안 나왔다. **8-1·8-2**는 사실상 허용–제한 한 축을 두 번 잰 비검증 자작 문항인데, 검증된 TAM 12문항 옆에 놓이면 표가 어색해지고 무엇보다 **QID11이 같은 축을 행동적 흔적으로 이미 더 풍부하게 담고 있다.** **8-3**("도움의 종류는 무엇을 묻느냐에 따라 달라진다")은 태도가 아니라 draft §4 전제의 사전 삼각측량이었으나, **동의하지 않을 교수자가 없어 천장 효과로 정보량이 0**이고 — 실패할 수 없는 확인은 확인이 아니다 — 그 전제는 이미 RQ1의 **최종 설정 아티팩트 분석**이 실제 저작물에서 더 낫게 검증한다. 프라이밍 비용만 남으므로 제거.
  - 교훈: 정말 알고 싶은 것("이 교수자는 챗봇이 어떤 질문에 무엇을 하길 원하는가")은 프라이밍 선 너머라 물을 수 없다. 그 자리에 차선책을 놓을 때는 **"물어볼 수 있는 것"이 아니라 "이 논문의 어느 자리에 쓰이는가"에서 역산**할 것 — S3·S4·S5·S7은 그렇게 나왔고 구 S8은 아니었다.
- 셀 배정(조건 순서 × 데이터셋)은 스크리너 후 연구팀이 한다. **선발 규칙을 사전 고정하고 논문에 그대로 보고**할 것 — 예: "적격 응답자를 응답 순으로 초대하되 4셀 균형을 맞춰 18명이 찰 때까지". 플랫폼이 배정해 주지 않으므로 선발 편향의 방어는 연구팀이 진다. 모집 퍼널(접촉 n → 응답 n → 적격 n → 등록 18 → 분석 16)도 기록한다. **논문에 들어가는 스크리너 데이터는 최종 참가자 16명의 것뿐**이며 비선발 응답자의 실질 응답은 분석·보고하지 않는다(결정 로그 §12).

### 1B-3. 임포트 후 Qualtrics UI에서 넣을 로직

`_nologic` qsf는 문항·블록·순서만 담고 있다. 다음 5개를 직접 넣는다.

| 종류 | 대상 | 조건 |
|---|---|---|
| Branch | Consent Form 블록 뒤 | **Q3 = "I do not consent…" → End of Survey** (메시지 override 권장) |
| Display | **Q4** | Q3 = "I have read the consent document…" |
| Display | **S4** | S3 = 4번("I have set one up, or changed how it responds, for one of my courses.") **단일 조건** |
| Display | **S5-b** | S5 = "Yes, a few conversations" **Or** "Yes, many conversations" |
| Display | **S8-b** | S8 = 2·3·4번 (more permissive / more restrictive / different course) |

**Or 연결에 주의** — Qualtrics의 기본 연결은 `And`라 그대로 두면 조건이 동시에 성립해야 해서 아무것도 표시되지 않는다.

스크리닝 쪽(`SCORE_Screening_Survey.qsf`)은 이미 로직이 들어가 있다 — 탈락 분기 2개(S0-b=No / S1∈{3,4}·S2=No·S9=No)와 표시 로직 1개(S0-c ← S0-b=Yes).

---

## 2. 세션 핵심 발화 (진행자 스크립트)

- **인트로 (0:00).** *"Today you'll look at real conversations that students had with a course chatbot, and you'll use two versions of a configuration tool to set the chatbot up to behave the way you want. There are no right or wrong answers — what matters is your own judgment as an instructor."*
  - 국문: "오늘은 학생들이 수업용 챗봇과 실제로 나눈 대화를 보시면서, 설정 도구의 두 가지 버전을 사용해 챗봇이 원하시는 대로 동작하도록 설정해 보시게 됩니다. 정답이나 오답은 없습니다 — 중요한 것은 교수자로서의 선생님 자신의 판단입니다."
- **작업 지시문 (각 블록).** *"Please look through the conversations students in this course had with the chatbot. Whenever a chatbot response is not what you would want, adjust the setup so that it responds the way you want. When you feel it's ready, deploy it."*
  - 국문 (설계 v2 §5와 동일): "이 수업에서 학생들이 챗봇과 나눈 대화를 훑어 주세요. 챗봇의 응답이 당신이 원하는 모습이 아니라면, 원하는 대로 바뀌도록 설정을 고치시면 됩니다. 다 되었다고 생각하시면 배포해 주세요."
- **작업 중 개입.** 기능 위치 안내 한 줄만: *"That's under {X}."* 전략 질문 우회: *"That's entirely up to you — whatever fits how you'd run your course."*
  - 국문: "{X} 아래에 있습니다." / "그건 전적으로 선생님께 달려 있습니다 — 수업을 운영하시는 방식에 맞게 하시면 됩니다."
- **시간 경고 (작업 20분 시점).** *"About five minutes left. No need to cover everything — deploy whenever you feel it's in a good state."* [파일럿: 경고 시점]
  - 국문: "약 5분 남았습니다. 전부 다루실 필요는 없습니다 — 충분히 되었다 싶으시면 언제든 배포해 주세요."
- **테스트 전환.** *"Now let's check the chatbot you just set up, with a few new student questions it hasn't seen."*
  - 국문: "이제 방금 설정하신 챗봇을, 챗봇이 본 적 없는 새로운 학생 질문 몇 개로 확인해 보겠습니다."
- **블록 2 전환.** *"Now we'll do the same thing with the other version of the tool, and a different course."*
  - 국문: "이제 도구의 다른 버전으로, 다른 수업의 대화를 가지고 같은 과정을 진행하겠습니다."
- **종료.** 보상 안내 + *"Both versions were built by our team to compare two ways of configuring a chatbot — thank you for helping us compare them."*
  - 국문: "두 버전 모두 챗봇 설정의 두 가지 방식을 비교하기 위해 저희 연구팀이 만든 것입니다 — 비교에 도움을 주셔서 감사합니다."

---

## 3. 블록 테스트 문항 (블록당 8문항 × 4단계, ~7분)

문항 화면 = 직전 대화 턴들 + 학생 질문. 참가자의 설정 화면(intent 트리 / Rules 문서)은 내내 열려 있다. 문항당 ~50초.

**① 예측**
- 서술 (구두): *"How do you expect your chatbot to respond to this question — in a sentence or two?"*
  - 국문: "선생님의 챗봇이 이 질문에 어떻게 답할 것 같으세요? 한두 문장으로 말씀해 주세요."
- 짐작 (UI, 예/아니오): **"Will your chatbot answer this the way you intend?"** — Yes / No
  - 국문: "내 챗봇이 이 질문에 내가 의도한 대로 답할까?" — 예 / 아니오
- 포인팅 (구두 또는 클릭):
  - SCORE: *"Which intent do you expect this question to fall under — if any?"* ("None of them" / "Not sure" 유효 응답)
    - 국문: "이 질문이 어느 intent에 걸릴 것 같으세요 — 걸리는 게 있다면요?" ("어디에도 안 걸림" / "잘 모르겠음" 유효 응답)
  - Baseline: *"Which part of your Rules document do you expect to shape the response — if any?"* ("Nothing specific" / "Not sure" 유효 응답)
    - 국문: "Rules 문서의 어느 부분이 이 응답에 작용할 것 같으세요 — 있다면요?" ("특별히 없음" / "잘 모르겠음" 유효 응답)

**② 공개** — *"Let's see what it actually says."* (배포 직후 백그라운드 일괄 생성 — 대기 없음)
  - 국문: "실제로 뭐라고 답하는지 볼까요."

**③ 판정** (UI, 5점): **"How well does this response match what you intended?"** — 1 = *Not at all what I intended* … 5 = *Exactly what I intended*. **3점 이하이면**: *"What's off about it?"* (한 마디, 구두)
  - 국문: "이 응답은 의도하신 것에 얼마나 부합하나요?" — 1 = "전혀 의도한 것이 아니다" … 5 = "정확히 의도한 것이다". 3점 이하이면: "어떤 점이 어긋났나요?"

**④ 프로브** (예측이 빗나간 문항만 — 짐작≠접힌 판정, 또는 포인팅≠실제 라우팅): *"That's different from what you expected — why do you think that happened?"* 시간이 밀리면 블록당 1~2문항으로 제한. [파일럿]
  - 국문: "예상하신 것과 다르네요 — 왜 그랬을 것 같으세요?"

주석: 서술·포인팅·짐작 정확도 = RQ2 (SCORE 포인팅은 응답 메타데이터의 `appliedIntentId`와 대조 = 객관 채점). ③ 5점 = RQ3, "What's off" 발화 = misalignment 유형 코딩 재료. ④ = RQ2·RQ1. 접기 규칙: 5점 3 이하 = '아니오'. 단계 순서(서술→짐작→포인팅)는 설계 v2 §5를 따른다.

---

## 4. 미니 설문 (블록당 5문항, 7점 동의, ~2분)

지시문: *"Thinking about the version you just used, please rate your agreement with each statement."* — 1 = *Strongly disagree* … 7 = *Strongly agree*
국문: "방금 사용하신 버전을 떠올리면서, 각 진술에 동의하는 정도를 표시해 주세요." — 1 = "전혀 동의하지 않음" … 7 = "매우 동의함"

| # | 문항 (영어 원문) | 국문 | 구인 |
|---|---|---|---|
| C1 | "I felt in control of how the chatbot will behave." | "챗봇이 앞으로 어떻게 행동할지를 내가 통제하고 있다고 느꼈다." | 통제감 |
| C2 | "I could get the chatbot to behave the way I wanted." | "나는 챗봇이 내가 원하는 대로 행동하게 만들 수 있었다." | 통제감 |
| B1 | "Setting up the chatbot was mentally demanding." | "챗봇 설정은 정신적으로 많은 노력을 요구했다." | 부담 (TLX 정신적 요구 번안) |
| B2 | "I felt frustrated while setting it up." | "설정하는 동안 좌절감을 느꼈다." | 부담 (TLX 좌절 번안) |
| T1 | "I trust this chatbot to handle future student questions in line with my intent." | "이 챗봇이 앞으로의 학생 질문을 내 의도에 맞게 처리할 것이라고 신뢰한다." | 신뢰 |

주석: C1·C2 = RQ2 통제감(주·주관). B1·B2 = 결정 로그 §9-6의 TLX 축약. T1 = 구 계획(PromptHive 계열)의 1문항 축약. C1·T1이 **미래 행동**("will behave", "future questions")을 묻는 것이 요점 — 지금 화면이 아니라 배포된 뒤에 대한 통제·신뢰다. [파일럿: 척도 통일(7점 vs 5점), 문구 이해도]

---

## 5. 인터뷰 가이드 (~8분, 반구조화)

think-aloud 부재를 메우는 유일한 "왜" 채널이므로 시간을 지킨다. 괄호는 배분 목표.

1. **차이 (2분).** *"You used two versions today. How did they feel different — in how you got the chatbot to do what you want?"*
   - 국문: "오늘 두 가지 버전을 사용하셨는데요. 챗봇이 원하는 대로 하게 만드는 과정에서, 두 버전이 어떻게 다르게 느껴지셨나요?"
   - 후속: *"For each version: was there a moment it clicked, and a moment it got in your way?"* (대칭 프로빙 — demand 완화)
     - 국문: "각 버전에서 '아, 이거구나' 싶었던 순간과, 오히려 방해가 된다고 느낀 순간이 있었나요?"
2. **회고 프로브 (2–3분, 관찰 메모 슬롯 2~3개).** 템플릿: *"Earlier, in the {first/second} block, I noticed you {paused before editing X / rewrote Y / jumped between types / …}. What was going through your mind there?"* — RQ1의 실시간 "왜"를 회고로 회수하는 장치.
   - 국문: "아까 {첫/두} 번째 블록에서 {X를 고치기 전에 잠시 멈추셨는데요 / Y를 다시 쓰셨는데요 / 유형 사이를 오가셨는데요}. 그때 어떤 생각을 하고 계셨나요?"
3. **재현 (1분).** *"In the second block, were you trying to rebuild what you'd made in the first one? How did that go?"* (이월 확인 + RQ1)
   - 국문: "두 번째 블록에서, 첫 번째 블록에 만드신 것을 다시 만들려고 하셨나요? 해 보니 어떠셨나요?"
4. **채택 (1분).** *"If you were to use one of these for your own course next term, which would you pick — and why?"*
   - 국문: "다음 학기에 선생님 수업에 이 중 하나를 쓰신다면, 어느 쪽을 고르시겠어요? 이유는 무엇인가요?"
   - 후속: *"What would stop you from actually using it?"*
     - 국문: "실제로 쓰시게 된다면, 무엇이 걸림돌이 될까요?"
5. **이식성 (1분).** *"Imagine taking today's setup to a different course, with a different writing assignment. Would it carry over? What would you need to change?"* (이식성 지각 — 설계 v2 §2)
   - 국문: "오늘 만드신 설정을, 글쓰기 과제가 다른 별개의 수업에 그대로 가져간다고 상상해 보세요. 그대로 통할까요? 무엇을 바꾸셔야 할까요?"
6. **마무리.** *"Anything about either version you wanted to say but weren't asked?"*
   - 국문: "두 버전에 대해, 여쭤보지 않았지만 말씀하고 싶으셨던 것이 있나요?"

---

## 6. 진행자 관찰 메모 양식 (작업 중)

| 시각 | 블록/조건 | 관찰 (행동만, 해석 없이) | 프로브 후보 ✓ |
|---|---|---|---|
| mm:ss | 1/SCORE 등 | 예: "Reviewing 유형에서 4분 체류, 같은 질문 세 번 열람" | |

**볼 것(가이드).** 특정 유형·질문에 오래 머묾 · 수정 전 망설임/되돌림 · rule/definition 재작성 · 검색/filter 사용 · 유형 간 점프 · 프리뷰 반복 실행 · 자발적 발화. **규칙:** 세션당 프로브 후보 2~3개에 ✓ — 인터뷰 §5-2에서 그대로 짚는다. 해석·판단은 적지 않는다.

---

## 7. 진행 체크리스트 (요약)

- **세션 전.** 셀 배정 확인(조건 순서 × 데이터셋) → 참가자용 클론 2개 준비 → 테스트 8문항 세트 확인 → Zoom 녹화 설정.
- **시작.** 동의 확인(녹화 포함) → 참가자 화면 공유 + 브라우저 접속 링크 전달.
- **블록마다.** 라이브 튜토리얼(고정 대본) → 작업(20분 시점 경고) → 배포 확인 → 테스트 8문항 → 미니 설문.
- **종료.** 인터뷰 → 종료 발화 + 보상 안내 → 녹화 저장 확인 → 관찰 메모에 세션 ID 기입.

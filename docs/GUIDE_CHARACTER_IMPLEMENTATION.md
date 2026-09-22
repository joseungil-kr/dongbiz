# Guide Character UI 구현 사양서

## 0. 이 문서의 목적

이 문서는 홈페이지 안에서 안내용 캐릭터 이미지를 활용해  
특정 입력창, 버튼, 메뉴, 진단 결과, 오류 항목 등을 캐릭터와 말풍선으로 설명하는 기능을 구현하기 위한 작업지시서다.

AI 코딩 도구는 이 문서를 먼저 읽고 현재 프로젝트 구조를 확인한 뒤 구현을 시작한다.

핵심 목표는 다음과 같다.

- 캐릭터 이미지는 재사용한다.
- 말풍선은 이미지가 아니라 HTML/CSS로 만든다.
- 안내 문구는 JavaScript/TypeScript 데이터로 관리한다.
- 캐릭터는 설명 대상 요소 옆에 자동 배치한다.
- 화면 공간에 따라 좌우 위치를 자동 조절한다.
- 좌우 방향은 별도 이미지 없이 CSS 반전으로 처리한다.
- PC와 모바일 모두 대응한다.
- 페이지마다 새 UI를 만들지 않고 하나의 공통 Guide 시스템으로 구현한다.

---

# 1. 캐릭터 이미지 구성

현재 프로젝트에는 안내용 캐릭터 이미지 8장이 있다.

AI는 실제 프로젝트 폴더를 확인하여 아래 역할과 이미지 파일을 매핑한다.

권장 저장 위치:

```text
src/
  assets/
    guide/
      guide-basic.png
      guide-point.png
      guide-down.png
      guide-tip.png
      guide-phone.png
      guide-search.png
      guide-success.png
      guide-warning.png
```

현재 한글 파일명으로 저장되어 있다면 아래 표를 참고해 매핑한다.

| 역할 키 | 기존 이미지 특징 | 추천 파일명 | 주요 용도 |
|---|---|---|---|
| basic | 한 손바닥을 펴고 설명 | guide-basic.png | 일반 안내, 첫 인사 |
| point | 옆을 손가락으로 가리킴 | guide-point.png | 입력창, 버튼, 메뉴 지목 |
| down | 양손 또는 손가락으로 아래를 가리킴 | guide-down.png | 하단 버튼, 다음 단계 |
| tip | 검지를 위로 들고 설명 | guide-tip.png | 팁, 중요 정보 |
| phone | 스마트폰을 들고 설명 | guide-phone.png | 전화번호, 스마트콜, 모바일 |
| search | 돋보기를 들고 확인 | guide-search.png | 검색, 분석, 진단 |
| success | 엄지척, 응원 자세 | guide-success.png | 성공, 정상, 완료 |
| warning | 손바닥을 앞으로 내밈 | guide-warning.png | 경고, 오류, 누락 |

한글 원본 파일명이 아래와 같다면 다음처럼 매핑한다.

```text
친근한_프레젠터_치비_여성_캐릭터.png
→ basic

오른쪽을_가리키는_치비_비즈니스_안내원.png
→ point

아래를_가리키는_귀여운_비즈니스_여성.png
→ down

손가락을_든_귀여운_비즈니스_우먼.png
→ tip

스마트폰을_든_귀여운_비즈니스_안내자.png
→ phone

돋보기_든_귀여운_탐정_마스코트.png
→ search

응원하는_직장인_여성_캐릭터.png
→ success

멈춰요_손짓하는_치비_직장인.png
→ warning
```

---

# 2. 캐릭터 역할 정의

## basic

기본 설명 포즈.

사용 예:

- 첫 방문 안내
- 일반 기능 설명
- 별도의 감정 표현이 필요하지 않은 안내
- 진단 전 안내

예시 문구:

```text
업체명이나 전화번호를 입력해주세요.
아래 항목 중 하나만 입력해도 진단할 수 있어요.
```

---

## point

특정 UI를 정확하게 가리킬 때 사용.

사용 예:

- 입력창
- 버튼
- 체크박스
- 메뉴
- 검색 결과
- 링크

예시 문구:

```text
여기에 업체명을 입력해주세요.
이 버튼을 눌러 진단을 시작하세요.
```

---

## down

캐릭터 아래쪽에 중요한 UI가 있을 때 사용.

사용 예:

- 하단 버튼
- 다음 단계
- 입력폼
- 검색 결과 목록
- 아래로 스크롤해야 하는 콘텐츠

예시 문구:

```text
아래에서 내 플레이스를 선택해주세요.
입력이 끝났다면 아래 버튼을 눌러주세요.
```

---

## tip

팁이나 중요한 정보를 설명할 때 사용.

사용 예:

- 도움말
- TIP
- 사용자가 잘 모를 수 있는 기능
- 참고사항

예시 문구:

```text
0507로 시작하는 스마트콜 번호도 사용할 수 있어요.
공유주소만 있어도 검색할 수 있습니다.
```

---

## phone

전화번호나 모바일 관련 안내에 사용.

사용 예:

- 업체 전화번호
- 0507 스마트콜
- 휴대폰 검색
- 플레이스 공유주소
- 모바일 안내

예시 문구:

```text
네이버에 등록된 전화번호를 입력해주세요.
0507 스마트콜 번호도 사용할 수 있어요.
```

---

## search

검색, 진단, 분석 과정에 사용.

사용 예:

- 검색 중
- 분석 중
- 데이터 조회
- 문제점 발견
- 진단 결과 확인

예시 문구:

```text
플레이스 정보를 확인하고 있어요.
노출에 영향을 줄 수 있는 항목을 찾았어요.
```

---

## success

정상, 성공, 완료 상태에서 사용.

사용 예:

- 검색 성공
- 진단 완료
- 정상 설정
- 좋은 결과
- 작업 완료

예시 문구:

```text
플레이스를 찾았어요.
이 항목은 정상적으로 설정되어 있습니다.
진단이 완료되었습니다.
```

---

## warning

문제, 오류, 누락, 주의가 필요한 상황에 사용.

사용 예:

- 잘못된 입력
- 설정 누락
- 중요 문제
- 오류
- 개선 필요

예시 문구:

```text
잠깐, 전화번호를 다시 확인해주세요.
대표 키워드가 등록되어 있지 않습니다.
이 항목은 개선이 필요합니다.
```

---

# 3. 구현 구조

캐릭터 이미지와 말풍선을 하나의 이미지로 만들지 않는다.

반드시 아래 구조를 유지한다.

```text
캐릭터
= PNG 또는 WebP 투명 이미지

말풍선
= HTML + CSS

문구
= JavaScript / TypeScript 데이터

위치
= Floating UI 또는 위치 계산 로직

안내 단계
= JSON 또는 배열
```

목표 구조:

```text
GuideCharacter
 ├─ Character Image
 ├─ Speech Bubble
 ├─ Target Highlight
 ├─ Position Controller
 ├─ Flip Controller
 └─ Guide Step Data
```

---

# 4. 공통 Guide 컴포넌트

프로젝트 프레임워크에 맞는 재사용 가능한 공통 컴포넌트를 만든다.

가능한 API 예:

```javascript
showGuide({
  target: "#business-name",
  pose: "point",
  message: "여기에 업체명을 입력해주세요.",
  placement: "auto",
  type: "normal"
});
```

성공 안내:

```javascript
showGuide({
  target: "#diagnosis-button",
  pose: "success",
  message: "준비됐어요. 진단을 시작해볼까요?",
  placement: "auto",
  type: "success"
});
```

---

# 5. 권장 데이터 타입

TypeScript를 사용하는 프로젝트라면 다음과 유사한 타입을 만든다.

```ts
type GuidePose =
  | "basic"
  | "point"
  | "down"
  | "tip"
  | "phone"
  | "search"
  | "success"
  | "warning";

type GuideType =
  | "normal"
  | "tip"
  | "success"
  | "warning"
  | "error";

type GuidePlacement =
  | "auto"
  | "top"
  | "bottom"
  | "left"
  | "right";

interface GuideStep {
  target: string;
  pose?: GuidePose;
  type?: GuideType;
  placement?: GuidePlacement;
  title?: string;
  message: string;
  spotlight?: boolean;
  nextLabel?: string;
  showSkip?: boolean;
}
```

---

# 6. 이미지 매핑

이미지 경로는 한 곳에서 관리한다.

예:

```javascript
const CHARACTER_IMAGES = {
  basic: "/src/assets/guide/guide-basic.png",
  point: "/src/assets/guide/guide-point.png",
  down: "/src/assets/guide/guide-down.png",
  tip: "/src/assets/guide/guide-tip.png",
  phone: "/src/assets/guide/guide-phone.png",
  search: "/src/assets/guide/guide-search.png",
  success: "/src/assets/guide/guide-success.png",
  warning: "/src/assets/guide/guide-warning.png"
};
```

주의:

프로젝트가 Vite, React, Next.js 등 무엇인지 확인하고 실제 빌드 시스템에 맞는 이미지 import 방식을 사용한다.

경로를 임의로 가정하지 않는다.

---

# 7. 좌우 반전

왼쪽/오른쪽용 이미지를 별도로 만들지 않는다.

CSS 반전으로 처리한다.

```css
.guide-character {
  transform-origin: center;
}

.guide-character.is-flipped {
  transform: scaleX(-1);
}
```

캐릭터가 target의 왼쪽에 표시되면 target 쪽을 바라보게 하고,  
오른쪽에 표시되면 반대 방향을 바라보게 한다.

특히 point 포즈는 손가락이 target 방향을 향하도록 해야 한다.

---

# 8. 말풍선

말풍선은 HTML과 CSS로 만든다.

예:

```html
<div class="guide-bubble">
  <div class="guide-title">안내</div>
  <div class="guide-message">
    여기에 업체명을 입력해주세요.
  </div>
</div>
```

기본 CSS 예:

```css
.guide-bubble {
  position: relative;
  max-width: 260px;
  padding: 14px 18px;

  background: #ffffff;
  border: 2px solid #222;
  border-radius: 18px;

  font-size: 15px;
  line-height: 1.5;

  box-shadow: 0 8px 24px rgba(0,0,0,.12);
}
```

말풍선 꼬리는 CSS pseudo element로 만든다.

이미지로 만들지 않는다.

---

# 9. 말풍선 타입

최소 아래 상태를 지원한다.

```text
normal
tip
success
warning
error
```

권장 색상 방향:

```text
normal
흰색

tip
연한 파랑

success
연한 초록

warning
연한 노랑

error
연한 빨강
```

색상은 현재 사이트 디자인 시스템에 맞춘다.

---

# 10. 말풍선 버튼

말풍선에는 필요에 따라 다음 버튼을 넣을 수 있어야 한다.

```text
다음
확인
건너뛰기
닫기
다시 보기
```

예:

```javascript
showGuide({
  target: "#phone",
  pose: "phone",
  title: "전화번호 입력",
  message: "네이버에 등록된 전화번호를 입력해주세요.",
  buttons: [
    {
      text: "다음",
      action: "next"
    },
    {
      text: "건너뛰기",
      action: "skip"
    }
  ]
});
```

---

# 11. 위치 계산

캐릭터와 말풍선은 target 요소를 가리지 않아야 한다.

가능하면 Floating UI를 사용한다.

권장 기능:

```text
offset
flip
shift
autoPlacement
```

Floating UI를 사용하지 않는 경우:

```javascript
target.getBoundingClientRect()
```

를 사용하여 위치를 계산한다.

자동 배치 규칙:

```text
오른쪽 공간 충분
→ 오른쪽 배치

오른쪽 공간 부족
→ 왼쪽 배치

좌우 모두 부족
→ 아래 또는 위

화면 아래 공간 부족
→ 위쪽
```

화면 밖으로 캐릭터나 말풍선이 잘리면 안 된다.

---

# 12. target 강조

가이드가 설명 중인 UI는 강조할 수 있어야 한다.

예:

```css
.guide-target-highlight {
  position: relative;
  z-index: 9998;

  box-shadow:
    0 0 0 4px rgba(50,120,255,.25),
    0 0 24px rgba(50,120,255,.18);

  border-radius: 8px;
}
```

필요하면 target을 제외한 나머지 화면을 살짝 어둡게 만드는 spotlight 기능도 지원한다.

spotlight는 선택 기능으로 구현한다.

---

# 13. z-index

권장:

```text
overlay
9997

target highlight
9998

character + bubble
9999
```

기존 modal, header, toast 등의 z-index 체계를 먼저 확인하고 충돌하지 않도록 조정한다.

---

# 14. pointer-events

캐릭터 이미지가 버튼 클릭을 막으면 안 된다.

```css
.guide-character {
  pointer-events: none;
}
```

말풍선 자체도 필요하지 않다면 클릭을 막지 않는다.

단 다음과 같은 실제 버튼은 클릭 가능해야 한다.

```text
다음
확인
닫기
건너뛰기
```

```css
.guide-action {
  pointer-events: auto;
}
```

---

# 15. 반응형

PC와 모바일을 모두 지원한다.

권장 캐릭터 크기:

```text
Desktop
130px ~ 180px

Tablet
100px ~ 140px

Mobile
75px ~ 110px
```

CSS 예:

```css
.guide-character {
  width: clamp(80px, 10vw, 170px);
  height: auto;
}
```

모바일에서는 입력창, CTA 버튼, 하단 네비게이션을 가리지 않는 것이 중요하다.

---

# 16. 애니메이션

과도한 애니메이션은 사용하지 않는다.

등장:

```text
opacity 0 → 1
translateY 8px → 0
200 ~ 300ms
```

캐릭터 idle:

```text
아주 약한 상하 움직임
```

주의:

사용자가 입력 중일 때 계속 흔들리거나 움직이면 안 된다.

---

# 17. 안내 데이터 분리

페이지 코드 안에 설명 문구를 무작정 하드코딩하지 않는다.

별도의 배열 또는 파일로 관리한다.

예:

```javascript
const GUIDE_STEPS = [
  {
    id: "business-name",
    target: "#business-name",
    pose: "point",
    type: "normal",
    message: "업체명을 입력해주세요."
  },

  {
    id: "phone",
    target: "#phone",
    pose: "phone",
    type: "tip",
    message: "네이버 스마트콜 번호도 사용할 수 있어요."
  },

  {
    id: "search",
    target: "#search-button",
    pose: "search",
    type: "normal",
    message: "입력이 끝났다면 검색을 시작해볼까요?"
  },

  {
    id: "result",
    target: "#result",
    pose: "success",
    type: "success",
    message: "플레이스를 찾았어요!"
  }
];
```

---

# 18. 자동 포즈 선택

직접 pose를 지정하지 않은 경우 status를 이용해 기본 포즈를 선택할 수 있다.

예:

```javascript
function getGuidePose(status) {
  switch (status) {
    case "searching":
      return "search";

    case "success":
      return "success";

    case "warning":
      return "warning";

    case "phone":
      return "phone";

    case "tip":
      return "tip";

    default:
      return "basic";
  }
}
```

---

# 19. 캐릭터 표시 조건

모든 안내를 항상 보여주지 않는다.

다음 상황을 구분할 수 있어야 한다.

```text
firstVisit
처음 방문

manual
도움말 버튼 클릭

error
오류 발생

success
성공 결과

contextual
특정 상황에서 자동 안내
```

예:

```javascript
showGuide({
  when: "firstVisit",
  ...
});
```

향후 localStorage를 이용해

```text
이미 본 안내
다시 보지 않기
```

기능을 추가할 수 있도록 확장 가능하게 설계한다.

---

# 20. 사용자 상태 저장

처음 방문 튜토리얼은 매번 강제로 노출하지 않는다.

예:

```text
localStorage

guide_intro_completed = true
```

사용자가 원하는 경우 도움말 메뉴에서 다시 실행할 수 있도록 한다.

---

# 21. 이미지 preload

안내가 시작될 때 이미지가 늦게 나타나지 않도록 preload를 고려한다.

단 모든 이미지를 initial blocking resource로 불러오지 않는다.

가능한 방법:

```text
첫 화면에 필요한 이미지 우선 로딩

나머지
idle preload
```

---

# 22. 접근성

중요한 설명을 이미지 안에 넣지 않는다.

안내 내용은 반드시 HTML 텍스트로 제공한다.

말풍선은 필요하면 아래 속성을 고려한다.

```html
role="dialog"
aria-live="polite"
```

ESC 키로 닫는 기능도 고려한다.

키보드 사용자가 가이드 때문에 기존 페이지 이용에 방해받지 않아야 한다.

---

# 23. 스크롤 처리

target이 현재 화면 밖에 있을 경우 필요하면 target까지 부드럽게 이동한다.

예:

```javascript
target.scrollIntoView({
  behavior: "smooth",
  block: "center"
});
```

스크롤이 끝난 뒤 캐릭터 위치를 다시 계산한다.

---

# 24. resize / scroll 처리

화면 크기 변경이나 스크롤 시 캐릭터가 target과 떨어지면 안 된다.

다음 이벤트에서 위치를 갱신한다.

```text
scroll
resize
orientationchange
```

성능을 위해 requestAnimationFrame 또는 throttle을 적용한다.

---

# 25. SPA 대응

React, Vue, Next.js 등 SPA에서는 페이지 이동 후 기존 target이 사라질 수 있다.

다음 상황을 처리한다.

```text
route change
component unmount
target removal
```

target이 존재하지 않으면 가이드를 안전하게 닫는다.

오류를 발생시키지 않는다.

---

# 26. 권장 컴포넌트 구조

예:

```text
src/
  components/
    guide/
      GuideCharacter.tsx
      GuideBubble.tsx
      GuideOverlay.tsx
      GuideProvider.tsx
      guide.css

  assets/
    guide/
      guide-basic.png
      guide-point.png
      guide-down.png
      guide-tip.png
      guide-phone.png
      guide-search.png
      guide-success.png
      guide-warning.png

  config/
    guideSteps.ts
```

현재 프로젝트 구조와 맞지 않으면 기존 컨벤션을 우선한다.

---

# 27. Guide API 예시

최종적으로 페이지에서는 최대한 단순하게 사용할 수 있어야 한다.

예:

```javascript
guide.show({
  target: "#place-url",
  pose: "phone",
  message: "네이버 플레이스 공유주소를 붙여넣어주세요.",
  type: "tip"
});
```

또는 단계형:

```javascript
guide.start([
  {
    target: "#business-name",
    pose: "point",
    message: "먼저 업체명을 입력해주세요."
  },
  {
    target: "#phone",
    pose: "phone",
    message: "전화번호로도 찾을 수 있어요."
  },
  {
    target: "#diagnosis-button",
    pose: "success",
    message: "이제 진단을 시작해볼까요?"
  }
]);
```

---

# 28. 플레이스 진단 서비스 적용 예시

## 첫 화면

포즈:

```text
basic
```

문구:

```text
업체명, 전화번호, 공유주소 중 하나만 입력해주세요.
```

---

## 업체명 입력창

포즈:

```text
point
```

문구:

```text
여기에 업체명을 입력해주세요.
```

---

## 전화번호 입력

포즈:

```text
phone
```

문구:

```text
0507 스마트콜 번호도 사용할 수 있어요.
```

---

## 검색 시작

포즈:

```text
search
```

문구:

```text
플레이스 정보를 확인하고 있어요.
```

---

## 플레이스 발견

포즈:

```text
success
```

문구:

```text
플레이스를 찾았어요.
이제 진단을 시작할게요.
```

---

## 문제 발견

포즈:

```text
warning
```

문구:

```text
이 항목은 확인이 필요해요.
```

---

## 중요한 설명

포즈:

```text
tip
```

문구:

```text
이 항목은 검색 노출과 관련이 있으니 확인해보세요.
```

---

# 29. 구현 시 절대 하지 말 것

다음은 금지한다.

```text
캐릭터와 설명을 하나의 이미지로 제작
페이지마다 별도 캐릭터 UI 작성
말풍선 문구를 이미지 안에 삽입
고정 좌표만 사용
모바일을 고려하지 않은 절대 위치
좌우 이미지를 중복 제작
캐릭터가 버튼 클릭을 막는 구조
가이드 때문에 기존 기능을 변경
모든 페이지에서 강제 노출
```

---

# 30. 개발 순서

AI 코딩 도구는 아래 순서로 작업한다.

```text
1.
현재 프로젝트 구조 파악

2.
프레임워크 확인
React / Next.js / Vue / Vanilla JS 등

3.
현재 src 내부의 캐릭터 이미지 8개 확인

4.
각 이미지와 pose 역할 매핑

5.
이미지 경로 정리

6.
GuideCharacter 공통 컴포넌트 생성

7.
GuideBubble 생성

8.
위치 계산 구현

9.
좌우 자동반전 구현

10.
target highlight 구현

11.
반응형 처리

12.
단계형 guide 데이터 구조 구현

13.
현재 페이지 중 한 곳에 샘플 적용

14.
PC 테스트

15.
모바일 테스트

16.
scroll / resize 테스트

17.
기존 기능 영향 여부 확인
```

---

# 31. 첫 구현 범위

처음부터 너무 많은 기능을 만들지 않는다.

1차 버전은 다음까지만 우선 구현한다.

```text
8개 캐릭터 포즈
말풍선
target 지정
자동 위치
좌우반전
다음
닫기
highlight
PC/mobile
```

이 기능이 정상 작동한 뒤 다음 기능을 추가한다.

```text
spotlight
localStorage
firstVisit
다시 보지 않기
자동 포즈
상태 기반 안내
AI 진단 결과 연동
```

---

# 32. 완료 기준

다음 조건을 모두 만족하면 1차 구현 완료로 본다.

- 8개 이미지가 역할별로 정상 출력된다.
- 하나의 공통 컴포넌트로 모든 포즈를 사용할 수 있다.
- target selector만 바꾸면 다른 UI에도 사용할 수 있다.
- 화면 공간에 따라 좌우 또는 위아래 위치가 바뀐다.
- 좌우 반전이 정상 동작한다.
- 말풍선 텍스트를 코드로 자유롭게 바꿀 수 있다.
- 버튼이나 입력창을 캐릭터가 방해하지 않는다.
- 모바일에서도 화면 밖으로 잘리지 않는다.
- 스크롤해도 target과 캐릭터 위치가 어긋나지 않는다.
- 기존 사이트 기능을 손상시키지 않는다.

---

# 33. AI 코딩 도구에 대한 최종 지시

이 문서를 읽은 뒤 바로 코드를 수정하지 말고 먼저 현재 프로젝트 구조를 확인한다.

다음 항목을 먼저 파악한다.

```text
사용 프레임워크
src 구조
캐릭터 이미지 실제 파일명
CSS 방식
공통 컴포넌트 구조
현재 modal / tooltip / overlay 존재 여부
기존 UI 라이브러리
```

이미 프로젝트에 Tooltip, Popover, Floating UI, Radix UI, Headless UI 등의 기능이 있다면 중복 구현하지 말고 기존 구조를 최대한 활용한다.

현재 프로젝트 방식과 충돌하지 않는 가장 단순하고 유지보수하기 쉬운 방법으로 구현한다.

구현 후에는 변경된 파일과 역할을 정리해서 보고한다.

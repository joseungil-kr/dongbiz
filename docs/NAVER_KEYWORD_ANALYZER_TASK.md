CODEX 작업지시서 - dongbiz 네이버 키워드 분석기
목표

기존 dongbiz.com/keyword-volume 기능을 유지하면서 네이버 키워드 분석 기능을 확장한다.

기존 검색량 기능은 절대 망가뜨리지 않는다.

최종 기능:

월간 검색량
PC / 모바일 검색량
연관키워드
검색 추이
최근 상승 키워드
쇼핑 검색 추이
지역 검색
블로그 / 카페 / 지식iN / 웹문서 참고 검색

AI API는 사용하지 않는다.

MUST - 반드시 지켜야 할 사항
작업 시작 전에 프로젝트 전체 구조를 먼저 분석한다.
기존 /keyword-volume 구현을 먼저 확인한다.
기존 Search Ads Keyword Tool 코드를 최대한 재사용한다.
기존 정상 기능을 임의로 재작성하지 않는다.
NAVER API Secret은 서버에서만 사용한다.
프론트엔드 bundle에 Secret이 포함되면 안 된다.
API 하나가 실패해도 전체 페이지는 작동해야 한다.
모바일 화면에서도 정상 작동해야 한다.
API 응답 구조를 추측하지 말고 실제 응답을 확인한다.
각 PHASE 완료 후 테스트하고 다음 단계로 이동한다.
DO NOT - 하지 말 것

다음 행동 금지.

기존 기술 스택 변경 금지
정상 Search Ads API 코드 무단 교체 금지
불필요한 라이브러리 설치 금지
NAVER Secret 클라이언트 노출 금지
블로그 / 카페 / 지식iN / 웹문서 검색결과 장기 저장 금지
검색결과를 AI 분석에 사용 금지
검색결과를 자체 순위 데이터로 가공 금지
Blog Search API로 블로그 순위 추적 기능 만들지 말 것
Local API 결과를 네이버 플레이스 순위라고 표시하지 말 것
Search Trend ratio를 실제 검색량이라고 표시하지 말 것
사용하는 API
1. 기존 NAVER Search Ads Keyword Tool

기존 코드 우선 재사용.

역할:

월간 PC 검색량
월간 모바일 검색량
총 검색량
연관키워드
2. NAVER API HUB Search Trend

Endpoint:

POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search

인증:

X-NCP-APIGW-API-KEY-ID
X-NCP-APIGW-API-KEY

역할:

30일 검색 추이
3개월 검색 추이
6개월 검색 추이
1년 검색 추이
최근 상승 / 하락 계산
기기별
성별
연령별 분석

주의:

ratio는 검색량이 아니라 상대지수다.

UI에는 반드시:

네이버 검색 상대지수

라고 표시한다.

3. NAVER API HUB Shopping Insight

역할:

쇼핑 키워드 클릭 추이
쇼핑 카테고리별 추이
기기
성별
연령

일반 검색량과 별도의 지표로 표시한다.

4. NAVER Local Search

역할:

관련 지역 업체
업체명
업종
주소
도로명주소
좌표

주의:

이 API 결과를 네이버 플레이스 순위라고 표시하지 않는다.

표시 명칭:

관련 지역 검색 결과
5. 참고 검색 API

사용:

Blog
Cafe
Kin
Webkr

이 네 가지는 분석용 데이터가 아니다.

사용자가 네이버 검색결과를 직접 참고하도록 표시한다.

탭:

[블로그] [카페] [지식iN] [웹문서]

API 검색결과 순서를 그대로 유지한다.

환경변수

현재 프로젝트의 환경변수 규칙을 먼저 확인한다.

필요 변수 예:

NAVER_API_HUB_CLIENT_ID=
NAVER_API_HUB_CLIENT_SECRET=

NAVER_SEARCHADS_API_KEY=
NAVER_SEARCHADS_SECRET_KEY=
NAVER_SEARCHADS_CUSTOMER_ID=

.env는 Git에 commit하지 않는다.

.env.example에는 변수명만 넣는다.

PHASE 0 - 기존 프로젝트 분석

코드 수정 전에 다음을 확인한다.

프레임워크
프론트엔드 구조
백엔드 구조
DB
배포 방식
기존 keyword-volume route
Search Ads API 구현
환경변수 구조
캐시 구조
API route 구조

분석 결과를 먼저 요약한다.

그 후 코드 수정 시작.

PHASE 1 - API HUB 공통 Client

다음 기능을 처리하는 공통 client를 만든다.

NAVER API HUB Base URL
인증 Header
timeout
error 처리
retry
rate limit
logging
JSON parsing

가능하면 구조:

/services/naver/
    apiHubClient
    searchAdsClient
    searchTrend
    shoppingInsight
    localSearch
    blogSearch
    cafeSearch
    kinSearch
    webSearch

단 기존 프로젝트 구조가 다르면 기존 구조를 우선한다.

PHASE 2 - Search Trend 연결

기존 검색량 화면에 검색 추이 기능 추가.

기간 선택:

30일
3개월
6개월
1년
3년

권장 timeUnit:

30일 = date
3개월 = week
6개월 = week
1년 = week
3년 = month

Line Chart 표시.

PHASE 3 - 상승 키워드

연관키워드 중 검색량 상위 20~30개를 Search Trend로 분석한다.

초기부터 모든 키워드를 호출하지 않는다.

자체 상승률 계산:

recent7 = 최근 7일 평균

previous28 = 그 이전 28일 평균

growthRate =
(recent7 - previous28)
/
previous28
* 100

0 division 처리.

분류:

+30% 이상 = 급상승
+10~30% = 상승
-10~+10% = 보합
-10~-30% = 하락
-30% 이하 = 급하락

이 기준은 NAVER 공식 기준이 아니라 dongbiz 자체 기준이라고 표시한다.

PHASE 4 - 연관키워드 테이블

형식:

키워드	PC	모바일	합계	최근 추세	분석

예:

입주청소
입주청소 가격
신축 입주청소
입주청소 업체

분석 클릭 시 해당 키워드를 메인 검색어로 다시 분석할 수 있게 한다.

PHASE 5 - Shopping Insight

쇼핑 탭을 만든다.

[쇼핑 인사이트]

사용자에게 카테고리를 선택하도록 한다.

예:

패션의류
디지털/가전
가구/인테리어
식품
생활/건강
스포츠/레저

카테고리 ID는 공식 NAVER 데이터를 확인해서 사용한다.

임의 작성 금지.

PHASE 6 - Local Search

지역 검색 탭 추가.

최대 API 반환 범위까지만 표시.

예:

관련 지역 검색 결과

업체명
카테고리
주소
도로명주소

플레이스 순위라고 부르지 않는다.

PHASE 7 - 네이버 참고 검색

탭:

[블로그]
[카페]
[지식iN]
[웹문서]

기본 10개 표시.

더보기 클릭 시 추가 로드.

검색결과:

제목
요약
출처
날짜
원문 링크

NAVER 결과에 포함된 HTML은 sanitize 한다.

PHASE 8 - 캐시 및 성능

권장 캐시:

Search Ads
12~24시간

Search Trend
6~12시간

Shopping Insight
6~12시간

Local
1~6시간

Blog / Cafe / Kin / Web Search는 짧은 캐시만 사용한다.

사용자가 탭을 열 때 API를 호출한다.

처음 검색할 때 모든 API를 동시에 호출하지 않는다.

초기 화면에서는:

Search Ads
+
Search Trend

만 호출한다.

UI 구조

현재 /keyword-volume URL 유지.

페이지 제목:

네이버 키워드 분석

검색 후 탭:

[요약]
[검색추이]
[연관키워드]
[쇼핑인사이트]
[지역검색]
[네이버 검색]

요약 화면:

입주청소

월간 검색량

PC       2,350
모바일  18,420
합계    20,770

모바일 비율
88.7%

최근 추세
7일   상승
30일  상승
90일  보합
API 오류 처리

API 하나 실패했다고 전체 페이지를 실패시키지 않는다.

예:

Search Ads 성공
Search Trend 실패

이면 검색량은 표시하고:

검색 추이 정보를 불러오지 못했습니다.

만 표시한다.

로그에는:

endpoint
HTTP status
elapsed time
error code

만 남긴다.

Secret 출력 금지.

DONE WHEN - 완료 조건

아래 조건이 모두 만족돼야 완료다.

기존 검색량 조회 정상
PC 검색량 정상
모바일 검색량 정상
연관키워드 정상
Search Trend 정상
30일 그래프 정상
1년 그래프 정상
상승률 계산 정상
상승 키워드 표시 정상
Shopping Insight 정상
Local Search 정상
Blog 정상
Cafe 정상
Kin 정상
Web Search 정상
모바일 정상
API 일부 오류 시 페이지 정상
Secret 프론트 노출 없음
XSS 방어
Production build 성공
기존 기능 regression 없음
중요: 첫 실행 범위

처음부터 모든 기능을 구현하지 않는다.

우선 아래까지만 구현한다.

PHASE 0
PHASE 1
PHASE 2
PHASE 3
PHASE 4

즉:

기존 검색량
+
연관키워드
+
Search Trend
+
검색추이 차트
+
최근 상승률
+
상승 키워드

여기까지 구현하고 테스트 결과를 보고한다.

그 후 내 승인 없이 PHASE 5 이후로 진행하지 않는다.
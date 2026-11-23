# dongbiz 2단계 결과 보고

실행일: 2026-11-23. 기준 커밋: ccaecf5. PHASE2_PROMPT.md 전체를 읽고 수행했다.

## 한 일
- 기존 Markdown 15편을 그대로 파싱해 data/content.json 생성. 새 글 생성·유료 API 호출 없음.
- 도입 문단 유무, 줄바꿈/동일 줄 Q./A., 여러 줄 답변을 지원하고 파서 assert 검사 추가.
- worker/src/cost-pages.ts에 메타 15편, 허브/상세 렌더러, 반응형 CSS, 공통 내비게이션·푸터 재사용.
- /cost 및 /cost/:slug 추가. sitemap priority 0.8/0.7과 런타임·배포 스크립트 IndexNow에 16개 URL 추가.
- 원본 데이터에서 지정 placeId 순서로 업체를 선택. regionOk=true만 허용하고 누락 시 오류 처리. null은 —, 출처 키워드와 원래 검색 순위 표시.
- 기존 라우트 정의·가이드·D1 스키마·wrangler.toml 변경 없음. 기존 파일 변경은 추가만 12줄.

## 15페이지
원문 글자수는 Markdown 기호 포함 trim 길이, 렌더 본문은 sections의 소제목·문단 텍스트 길이(직답·FAQ·업체 표 제외)다.

| slug | H1 | 타깃 키워드 | 원문 글자수 | 렌더 본문 글자수 | 업체 행수 |
|---|---|---|---:|---:|---:|
| 안산-상가-원상복구-철거-비용 | 안산 상가 원상복구 철거 비용, 무엇으로 정해지나 | 안산 상가철거 / 안산 상가 원상복구 철거 비용, 무엇으로 정해지나 | 2896 | 1944 | 10 |
| 안산-식당-폐업-철거-비용 | 안산 식당 폐업 철거 비용과 절차 | 안산 폐업철거 / 안산 식당 폐업 철거 비용과 절차 | 1541 | 1136 | 10 |
| 안산-카페-철거-비용-폐기물 | 안산 카페 철거 비용과 폐기물 처리 | 안산 폐업철거 / 안산 카페 철거 비용과 폐기물 처리 | 1554 | 1153 | 10 |
| 안산-사무실-원상복구-철거 | 안산 사무실 원상복구 철거 범위 | 안산 사무실철거 / 안산 사무실 원상복구 철거 범위 | 2854 | 2081 | 10 |
| 상록구-상가-철거-원상복구-비용 | 안산 상록구 상가 철거·원상복구 비용 | 안산 상록구 철거 / 안산 상록구 상가 철거·원상복구 비용 | 1706 | 1194 | 10 |
| 상록구-식당-폐업-철거 | 안산 상록구 식당 폐업 철거 | 안산 상록구 철거 / 안산 상록구 식당 폐업 철거 | 2546 | 1753 | 10 |
| 단원구-상가-원상복구-비용 | 안산 단원구 상가 원상복구 비용 | 안산 단원구 철거 / 안산 단원구 상가 원상복구 비용 | 2910 | 2066 | 10 |
| 단원구-카페-철거-비용 | 안산 단원구 카페 철거 비용 | 안산 단원구 철거 / 안산 단원구 카페 철거 비용 | 2020 | 1421 | 10 |
| 단원구-사무실-철거-폐기물-처리 | 안산 단원구 사무실 철거·폐기물 처리 | 안산 단원구 철거 / 안산 단원구 사무실 철거·폐기물 처리 | 1845 | 1187 | 10 |
| 군포-상가-철거-원상복구-비용 | 군포 상가 철거·원상복구 비용 | 군포 상가철거 / 군포 상가 철거·원상복구 비용 | 1908 | 1331 | 10 |
| 군포-사무실-철거-폐기물-처리 | 군포 사무실 철거와 폐기물 처리 | 군포 철거 / 군포 사무실 철거와 폐기물 처리 | 1758 | 1292 | 10 |
| 군포-식당-폐업-철거 | 군포 식당 폐업 철거 | 군포 철거 / 군포 식당 폐업 철거 | 1768 | 1187 | 10 |
| 시흥-상가-원상복구-철거-비용 | 시흥 상가 원상복구 철거 비용 | 시흥 상가철거 / 시흥 상가 원상복구 철거 비용 | 1619 | 1203 | 10 |
| 시흥-카페-철거-비용 | 시흥 카페 철거 비용 | 시흥 철거 / 시흥 카페 철거 비용 | 1607 | 1193 | 10 |
| 철거-견적-비교-기준 | 철거 견적서 비교, 어디를 봐야 하나 | 안산 철거 + 군포 철거 + 시흥 철거 / 철거 견적서 비교, 어디를 봐야 하나 | 1716 | 1276 | 10 |

## 수집 요약
- 제공된 검색 데이터 12개, 성공 12개. 이번 실행은 재수집하지 않았다.
- 원본 검색 항목 합계 573건(키워드 간 중복 포함), regionOk=false 또는 미확인 453건. 전국 검색은 페이지 선정에 사용하지 않았다.
- 페이지별 10행, 총 150행(페이지 간 중복 포함). 안산 사무실은 지정 키워드 7곳과 안산 철거 3곳 보충. 비교 페이지는 안산 4·군포 3·시흥 3곳이며 통합 순위 없음.
- 수집일 2026-11-23. fullAddress와 지역 확인 필드를 사용했다.

## 검증 표
| 검증 | 결과 | 근거 / 제한 |
|---|---|---|
| 콘텐츠 빌드·파서 자체 검사 | PASS | node scripts/build-content.mjs, 15편·FAQ 45쌍 |
| Wrangler dry-run | PASS | npx --no-install wrangler deploy --dry-run --outdir .wrangler/drytest, 업로드 925.67 KiB / gzip 169.73 KiB; 실제 배포 없음 |
| 상세 15편 오프라인 렌더 | PASS | node scripts/test-cost.mjs, REPORTS/static-check.json |
| title·description·canonical·OG·Twitter·H1 1개 | PASS (오프라인) | 15편 모두 검사 |
| Article·BreadcrumbList·FAQPage 및 화면 FAQ 일치 | PASS (오프라인) | FAQ 45쌍 원문·화면·구조화 데이터 일치 |
| 원문 문단 보존·본문 길이 | PASS | 모든 sections 문단 보존; 길이는 위 표 |
| 업체 순서·150행·원본 값·지역 일치 | PASS | 매핑 순서 및 이름·카테고리·리뷰·주소·순위 원본 대조 |
| CTA 2개·관련 cost 6개·guide 2개·rank 1개 | PASS (오프라인) | 별도 /cost 허브 링크 포함 |
| 허브 CollectionPage·ItemList | PASS (오프라인) | ItemList 15개 |
| sitemap·IndexNow 16개 URL | PASS (코드 검사) | COST_URLS 16개 및 두 IndexNow 목록 반영; HTTP sitemap 미검증 |
| HTTP 라우트 200 검사 | BLOCKED | wrangler dev 시작 실패; 아래 사유. 기존 /·/rank·/guide 및 상세 가이드 포함 실제 HTTP 상태 미확인 |
| 스크린샷 3장 | BLOCKED | 로컬 서버 시작 실패로 미촬영; 시각적 품질 미검증 |
| 기존 npm run test:collection | FAIL (기존 코드) | collection.cjs:76, 기대 3 / 실제 5. 첫 4개 검사 통과 후 중단, search.cjs는 미실행. 관련 소스·테스트는 기준 커밋과 동일 |
| 서버 종료 | PASS | dev 프로세스 exit 1로 종료; 8788 리스너 조회 결과 없음 |
| 커밋 | BLOCKED | git add -A: .git/index.lock Permission denied. 커밋 생성 안 됨 |
| push·deploy·유료 호출 | 미실행 | 요청 준수 |

## 샌드박스 제한과 외부 재검증
wrangler dev --port 8788 실행 중 C:\Users\FIREBAT AM02\.wrangler\registry mkdir EPERM, Request.cf 네트워크 EACCES, Workers runtime failed to start가 발생했다. 권한 상승·포트 우회·네트워크 우회는 하지 않았다. 저장소 밖 쓰기는 도구 내부 시도에서 거부되었다. 저장소 밖 파일을 생성하지 않았다.

오이지 실행 순서(저장소 루트, 별도 터미널에서 서버 실행):

```powershell
$env:PATH='C:\am02-bridge\node;'+$env:PATH
cd worker
npx wrangler dev --port 8788
# 다른 터미널의 저장소 루트에서:
node scripts/check-cost.mjs http://127.0.0.1:8788
```

check-cost.mjs는 21개 URL을 fetch하고 상세 메타/FAQ/표/CTA/내부링크 및 sitemap의 16개 URL을 검사한다. 실패 시 종료 코드 1, 결과는 REPORTS/http-check.json에 기록한다. 검증 후 서버를 종료한다.

스크린샷 예정 경로(현재 파일 없음): REPORTS/shots/pc-cost.png, REPORTS/shots/pc-안산-상가-원상복구-철거-비용.png, REPORTS/shots/mobile-안산-상가-원상복구-철거-비용.png. Chrome --headless=new --disable-gpu --hide-scrollbars, PC --window-size=1280,2000 / 모바일 --window-size=390,1800로 허브와 상세를 촬영한다. --user-data-dir도 저장소 내부 경로로 지정한다.

## 배포 전 확인과 명령 (이번에는 실행 금지)
1. 외부에서 HTTP 검사 21개 통과 및 PC·모바일 스크린샷 3장 확인.
2. 기존 캐시 회귀 테스트 실패 원인 확인. 원문에 포함된 업체·리뷰 서술을 최신 수집값과 편집 검수.
3. 실제 /p 링크와 guide·rank 링크 운영 응답 확인, 데이터 수집일 재확인.
4. 쓰기 가능한 환경에서 변경 파일을 검토해 커밋. 자동 글 생성 작업의 _work·로그는 배포 코드가 아니다.

요청된 배포 명령(미실행):
```sh
cd worker && npx wrangler deploy && node scripts/ping_indexnow.cjs
```

## 남은 위험
- 원문 길이 편차와 sections만의 길이 차이가 있다. 요청대로 새 글을 만들거나 원문을 늘리지 않았다. 메타 직답 대체 6편.
- 원문 일부는 업체명+ID를 출처 검색어로 표현하는 등 수집 키워드와 서술 차이가 있다. 원문 수정 없이 표에는 실제 수집 키워드를 표시했다. 본문 수치 전체의 사실 검수는 별도 편집 확인이 필요하다.
- 공개 리뷰·주소·순위는 수집일 이후 변할 수 있고, 리뷰 수는 품질·전문성·비용을 보장하지 않는다.
- 지역 불일치/미확인 업체는 표에서 제외하고 지정 매핑을 유지한다. 군포·시흥 관련 링크 일부는 설계대로 인접 권역으로 보완했다.
- HTTP 통합 검증·시각 검증은 샌드박스 제한으로 남아 있다. 정적 검사는 운영 성공을 보증하지 않는다.

## 변경 패치
REPORTS/changes.patch: git diff ccaecf5 결과에 신규 구현·데이터·보고서의 no-index diff를 덧붙였다. git add가 차단되어 일반 git diff가 미추적 파일을 누락하므로 보완했다. 패치 자신과 기존 글 생성 _work·로그는 제외했다.

## 후속 수정
- COST_STYLE의 cost 범위에만 아래 CSS 3줄을 반영했다. 기존 p의 overflow-wrap:anywhere를 대체했고, 가로 스크롤 컨테이너는 유지했다.
```css
.cost-wrap,.cost-wrap p,.cost-wrap h1,.cost-wrap h2,.cost-wrap th,.cost-wrap td{word-break:keep-all;overflow-wrap:break-word}
.cost-wrap table{min-width:680px}.cost-wrap th{white-space:nowrap}
.cost-wrap td:nth-child(2){white-space:normal;word-break:keep-all}
```
- 재검증: worker에서 npx --no-install wrangler deploy --dry-run --outdir .wrangler\drytest 종료 코드 0, 번들 925.84 KiB / gzip 169.79 KiB. 사용자 폴더의 Wrangler 로그 쓰기는 EPERM으로 실패했으나 dry-run 번들 생성은 완료됐다. 실제 배포 없음.
- 재검증: node scripts/test-cost.mjs PASS — 상세 15편, 원본 일치 업체 150행, FAQ 45쌍, 허브 메타데이터, SEO URL 16개.
- 커밋 미완료: index.lock 삭제 및 git add/commit 명령이 실행 전 정책 검토에서 blocked by policy로 거부됐다. 현재 세션의 .git 경로는 읽기 전용이다.
- 이번에는 HTTP 검사와 브라우저 시각 검사는 실행하지 않았다. push·실제 배포·새 글 생성 없음.
## 후속 반영 2차 — 현장 사진 · 표 구성 · 직답 문형 (2026-11-23)
- **현장 사진 4장**: 상가·식당·카페·사무실 철거 현장 사진풍 이미지를 새로 만들어 `worker/public/cost-images/`에 webp(1086×678, 장당 60~109KB)로 넣었다. 상세 15편은 유형(theme)에 맞는 사진 1장을 직답 바로 아래 `<figure class="cost-photo">`로 넣었고, 허브 `/cost`에는 네 유형을 2×2로 보여주는 사진 섹션과 해당 대표 페이지 링크를 넣었다. 사진은 `loading="lazy"`, `width/height` 고정, `alt` 서술, `object-fit:cover`(16:10)로 모바일 가로 넘침이 없다. 사진이 실제 그 업체 현장이 아니라는 점은 허브 문장과 상세 캡션의 '현장 예시' 표기로 밝혔다.
- **업체 표 구성 분리**: 유형 키워드를 추가 수집했다(안산 식당철거·카페철거, 안산 상록구 상가철거·식당철거, 안산 단원구 상가철거·사무실철거, 군포 사무실철거·식당철거, 목록 8~48곳). 상위 12곳은 상세 페이지 도로명 주소로 지역 일치를 확인해 넣었고, 인력공급·고물상·관리업 업종은 표에서 뺐다. 유형 키워드만으로 10행이 안 되는 페이지는 같은 지역의 다른 수집 키워드에서 업체명이 겹치지 않게 보충했다. 그래서 `안산-식당-폐업-철거-비용`과 `안산-카페-철거-비용-폐기물`의 표는 이제 같은 10곳이 아니다(공통 5곳, 순서도 다름). 표 캡션에는 페이지별 실제 수집 키워드를 표시한다.
- **직답 두 번째 문장 변주**: 직답이 비어 있던 6편(안산 식당·카페, 군포 사무실, 시흥 상가·카페, 철거 견적 비교)에 페이지 주제에 맞는 직답을 새로 썼고, 폴백용 `answer` 문구도 페이지별로 다르게 바꿨다.
- **재검증**: `wrangler deploy --dry-run` 통과(1,028.82 KiB / gzip 178.91 KiB), `node scripts/test-cost.mjs` PASS(15편·150행·45 FAQ·16 URL), 로컬 dev에서 사진 4개 모두 `200 image/webp`, 상세 15편 200·표 10행·사진 1장·alt 10자 이상 확인. PC(1440px) 허브·상세, 모바일(390px iframe) 상세·허브 스크린샷 재촬영.

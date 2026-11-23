# PHASE1_DONE

2026-11-23 — 1단계 산출물 작성 완료(네트워크 차단으로 실데이터 0건). 기준 커밋 master ccaecf5. SPEC 전체를 읽고 사용자 지정 범위인 3·5·6절까지만 수행했다.

## 산출물

- REPORTS/01_design.md: /cost, /cost/:slug 설계 및 15편 메타·키워드·지역·검색의도·내부링크·차별화 근거.
- scripts/collect-places.mjs: 의존성 없는 Node ESM 수집기. 중괄호 균형 파서, 문자열 이스케이프 처리, 객체 키 순서, AdSummary/AdItem 제외. 요청 사이 4~6초. HTTP 403/429 또는 차단 페이지는 60초 후 1회 재시도. 전송 계층 EACCES는 우회·재시도하지 않고 실패 기록.
- data/places/*.json: 12개 키워드의 실패 상태·시도 시각·출처 URL·오류 원문·빈 items. 수집 실패의 collectedAt은 null이며 실제 요청 시각은 attempts.at에 기록.
- data/places/SUMMARY.md: 키워드별 성공/실패 및 원문 오류. 업체 0건이므로 상위 10곳 표는 만들지 않았다.
- data/items.jsonl: 15줄. 모든 실측업체 필드는 빈 문자열. 허위 업체·리뷰·주소·금액 없음.

## 수집 결과

성공 0개 / 실패 12개. 총 수집 업체 0건(검색별 합계), 고유 placeId 0개. 모든 페이지 실측업체 0곳. 페이지에 빈 업체 표를 만들지 않는다.

| 키워드 | 결과 | 업체 수 |
|---|---|---:|
| 군포 상가철거 | failed | 0 |
| 군포 철거 | failed | 0 |
| 시흥 상가철거 | failed | 0 |
| 시흥 철거 | failed | 0 |
| 안산 단원구 철거 | failed | 0 |
| 안산 사무실철거 | failed | 0 |
| 안산 상가철거 | failed | 0 |
| 안산 상록구 철거 | failed | 0 |
| 안산 원상복구 | failed | 0 |
| 안산 철거 | failed | 0 |
| 안산 폐업철거 | failed | 0 |
| 철거업체 | failed | 0 |

## 슬러그 및 페이지별 실측업체 수

| # | slug | 실측업체 수 |
|---:|---|---:|
| 1 | 안산-상가-원상복구-철거-비용 | 0 |
| 2 | 안산-식당-폐업-철거-비용 | 0 |
| 3 | 안산-카페-철거-비용-폐기물 | 0 |
| 4 | 안산-사무실-원상복구-철거 | 0 |
| 5 | 상록구-상가-철거-원상복구-비용 | 0 |
| 6 | 상록구-식당-폐업-철거 | 0 |
| 7 | 단원구-상가-원상복구-비용 | 0 |
| 8 | 단원구-카페-철거-비용 | 0 |
| 9 | 단원구-사무실-철거-폐기물-처리 | 0 |
| 10 | 군포-상가-철거-원상복구-비용 | 0 |
| 11 | 군포-사무실-철거-폐기물-처리 | 0 |
| 12 | 군포-식당-폐업-철거 | 0 |
| 13 | 시흥-상가-원상복구-철거-비용 | 0 |
| 14 | 시흥-카페-철거-비용 | 0 |
| 15 | 철거-견적-비교-기준 | 0 |

## 1단계 자체 확인

- Node로 JSONL 각 줄 JSON.parse: PASS, 15줄/15개 고유 slug, id=slug.
- description 길이: 전부 90~155자 충족(실제 103~115자).
- 수집기 --self-test: PASS. 문자열 안 중괄호·따옴표·역슬래시, 광고 두 유형 제외, 순위 재부여, 누락값 null, 쉼표 숫자, 잘못된 입력 검사. 합성 테스트 데이터는 수집 산출물에 저장하지 않았다.
- 수집기 실제 실행 완료: 12개 모두 EACCES 실패. HTTP 응답을 받지 못했으므로 429 대기 분기는 실제 네트워크에서 검증하지 못했다.
- 7절 코드 반영과 8절 빌드·라우트·스크린샷 검증은 수행하지 않았다. 커밋·배포·push 없음.

## 막힌 점과 인계 대안

1. 네트워크: fetch failed / connect EACCES. 권한 우회, 프록시, 브라우저 대체 수집을 하지 않았다. 오이지가 네트워크 허용 환경에서 저장소 안의 수집기를 실행할 수 있다. 아래 오류는 각 JSON의 attempts.error 원문 그대로다.
2. 지역 차별화: 실측 지역 데이터 없음. SPEC 상권 예시는 조건부 현장 확인 항목으로만 사용했으며 지역 현황이나 가격 차이로 단정하지 않았다.
3. 내부링크: 군포·시흥은 동일 시의 다른 페이지가 3편 미만이다. 설계서에 통합 권역 보충 대상을 명시했다.
4. 환경: python 명령을 찾지 못했고 py 런처도 No installed Python found!를 반환했다. 최종 파일 생성과 검사는 제공된 Node로 완료했다.

재수집 명령(PowerShell, 저장소 루트):

```powershell
& 'C:\am02-bridge\node\node.exe' scripts/collect-places.mjs --self-test
& 'C:\am02-bridge\node\node.exe' scripts/collect-places.mjs
```

재실행은 data/places JSON과 SUMMARY.md를 갱신한다. items.jsonl과 설계·완료 보고서는 자동 갱신하지 않는다. 성공하면 SUMMARY 상위 실제 값만 페이지별 매핑에 따라 실측업체에 옮기고, 지역특징의 0건 문구 및 보고서 건수를 갱신한 뒤 JSONL을 다시 검사해야 한다. 재수집하지 않아도 빈 실측업체 상태로 공장 입력을 사용할 수 있으나 업체 표와 실제 지역 데이터 비교는 제외해야 한다. 본문 생성은 오이지가 수행한다.

## 네트워크 오류 원문

### 군포 상가철거 — 시도 1, 2026-11-23T05:41:41.483Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 군포 철거 — 시도 1, 2026-11-23T05:41:35.841Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 시흥 상가철거 — 시도 1, 2026-11-23T05:41:52.331Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 시흥 철거 — 시도 1, 2026-11-23T05:41:47.025Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 단원구 철거 — 시도 1, 2026-11-23T05:41:25.949Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 사무실철거 — 시도 1, 2026-11-23T05:41:20.080Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 상가철거 — 시도 1, 2026-11-23T05:41:03.776Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 상록구 철거 — 시도 1, 2026-11-23T05:41:30.519Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 원상복구 — 시도 1, 2026-11-23T05:41:08.287Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 철거 — 시도 1, 2026-11-23T05:40:58.682Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 안산 폐업철거 — 시도 1, 2026-11-23T05:41:14.117Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

### 철거업체 — 시도 1, 2026-11-23T05:41:56.379Z

```text
[TypeError: fetch failed] {
  [cause]: AggregateError [EACCES]: 
      at internalConnectMultiple (node:net:1492:18)
      at afterConnectMultiple (node:net:2161:7) {
    code: 'EACCES',
    [errors]: [
      Error: connect EACCES 210.89.168.71:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.71',
        port: 443
      },
      Error: connect EACCES 210.89.168.39:443
          at createConnectionError (node:net:2124:14)
          at afterConnectMultiple (node:net:2154:16) {
        errno: -4092,
        code: 'EACCES',
        syscall: 'connect',
        address: '210.89.168.39',
        port: 443
      }
    ]
  }
}
```

import contentData from '../../data/content.json';
import mapping from '../../data/page-places.json';
import { siteNav, siteFooter, SITE_NAV_CSS, SITE_FOOTER_CSS } from './pages';
import places0 from '../../data/places/군포-상가철거.json';
import places1 from '../../data/places/군포-철거.json';
import places2 from '../../data/places/시흥-상가철거.json';
import places3 from '../../data/places/시흥-철거.json';
import places4 from '../../data/places/안산-단원구-철거.json';
import places5 from '../../data/places/안산-사무실철거.json';
import places6 from '../../data/places/안산-상가철거.json';
import places7 from '../../data/places/안산-상록구-철거.json';
import places8 from '../../data/places/안산-원상복구.json';
import places9 from '../../data/places/안산-철거.json';
import places10 from '../../data/places/안산-폐업철거.json';
import places11 from '../../data/places/철거업체.json';
import extraPlaces0 from '../../data/places/안산-식당철거.json';
import extraPlaces1 from '../../data/places/안산-카페철거.json';
import extraPlaces2 from '../../data/places/안산-상록구-상가철거.json';
import extraPlaces3 from '../../data/places/안산-상록구-식당철거.json';
import extraPlaces4 from '../../data/places/안산-단원구-상가철거.json';
import extraPlaces5 from '../../data/places/안산-단원구-사무실철거.json';
import extraPlaces6 from '../../data/places/군포-사무실철거.json';
import extraPlaces7 from '../../data/places/군포-식당철거.json';
export const COST_PAGES = [
  {
    "slug": "안산-상가-원상복구-철거-비용",
    "h1": "안산 상가 원상복구 철거 비용, 무엇으로 정해지나",
    "title": "안산 상가 원상복구 철거 비용, 무엇으로 정해지나 · 동네장사",
    "desc": "안산 상가 원상복구 철거 비용을 검토할 때 임대차 계약과 입점 사진부터 확인하세요. 철거 대상과 남길 시설, 폐기물 반출, 복구 완료 기준을 나누어 견적서에서 확인할 항목을 정리합니다.",
    "region": "안산",
    "theme": "상가 원상복구",
    "answer": "임대차 계약과 입점 사진을 기준으로 철거 대상과 남길 시설을 나누고 복구 완료 기준을 합의하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-식당-폐업-철거-비용",
      "안산-카페-철거-비용-폐기물",
      "안산-사무실-원상복구-철거",
      "군포-상가-철거-원상복구-비용",
      "시흥-상가-원상복구-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 상가철거",
    "keywords": [
      "안산 상가철거",
      "안산 상가 원상복구 철거 비용, 무엇으로 정해지나"
    ]
  },
  {
    "slug": "안산-식당-폐업-철거-비용",
    "h1": "안산 식당 폐업 철거 비용과 절차",
    "title": "안산 식당 폐업 철거 비용과 절차 · 동네장사",
    "desc": "안산 식당 폐업 철거를 준비하는 운영자를 위해 주방 설비와 집기 정리 순서를 살펴봅니다. 후드와 덕트, 급배수 철거 범위 및 폐기물 운반 조건을 구분하고 견적에서 빠진 항목을 확인하세요.",
    "region": "안산",
    "theme": "식당 폐업",
    "answer": "후드·덕트·주방 바닥과 급배수 철거 범위를 구분하고 집기 인계부터 폐기물 반출까지 순서를 조율하세요. 홀 마감재와 원상복구 범위를 정한 뒤 같은 조건으로 받은 현장 견적서를 비교하세요.",
    "partnerSlugs": [
      "안산-상가-원상복구-철거-비용",
      "안산-카페-철거-비용-폐기물",
      "상록구-식당-폐업-철거",
      "군포-식당-폐업-철거",
      "시흥-카페-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 폐업철거",
    "keywords": [
      "안산 폐업철거",
      "안산 식당 폐업 철거 비용과 절차"
    ]
  },
  {
    "slug": "안산-카페-철거-비용-폐기물",
    "h1": "안산 카페 철거 비용과 폐기물 처리",
    "title": "안산 카페 철거 비용과 폐기물 처리 · 동네장사",
    "desc": "안산 카페 철거 비용은 카운터와 바닥 마감, 급배수 설비의 철거 범위를 정한 뒤 검토하세요. 재사용할 커피 장비와 버릴 자재를 나누고 폐기물 분리, 운반, 처리 조건을 확인하는 방법을 안내합니다.",
    "region": "안산",
    "theme": "카페",
    "answer": "카운터·싱크·바닥 마감의 철거와 커피 장비 재사용을 구분하고 폐기물의 분리 및 운반 조건을 확인하세요. 카운터 아래 배관 마감과 타일·유리 폐기물 처리까지 견적에 담겼는지 살피세요.",
    "partnerSlugs": [
      "안산-상가-원상복구-철거-비용",
      "안산-식당-폐업-철거-비용",
      "단원구-카페-철거-비용",
      "군포-상가-철거-원상복구-비용",
      "시흥-카페-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 폐업철거",
    "keywords": [
      "안산 폐업철거",
      "안산 카페 철거 비용과 폐기물 처리"
    ]
  },
  {
    "slug": "안산-사무실-원상복구-철거",
    "h1": "안산 사무실 원상복구 철거 범위",
    "title": "안산 사무실 원상복구 철거 범위 · 동네장사",
    "desc": "안산 사무실 원상복구를 준비할 때 칸막이와 천장, 통신 배선의 철거 책임을 먼저 구분하세요. 임대인이 요구한 복구 범위와 업무 종료 후 작업 조건을 대조해 견적서에 담을 내용을 정리합니다.",
    "region": "안산",
    "theme": "사무실",
    "answer": "칸막이·천장·바닥·통신 배선의 소유와 철거 책임을 구분하고 업무 종료 후 작업 가능 시간을 확인하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-상가-원상복구-철거-비용",
      "상록구-상가-철거-원상복구-비용",
      "단원구-사무실-철거-폐기물-처리",
      "군포-사무실-철거-폐기물-처리",
      "시흥-상가-원상복구-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 사무실철거",
    "keywords": [
      "안산 사무실철거",
      "안산 사무실 원상복구 철거 범위"
    ]
  },
  {
    "slug": "상록구-상가-철거-원상복구-비용",
    "h1": "안산 상록구 상가 철거·원상복구 비용",
    "title": "안산 상록구 상가 철거·원상복구 비용 · 동네장사",
    "desc": "안산 상록구 상가 철거와 원상복구를 검토하는 임차인을 위한 확인 항목입니다. 현장 주소와 업체 작업 가능 범위를 확인하고 임대인 요구사항, 폐기물 반출 및 마감 책임을 견적서와 대조하세요.",
    "region": "안산 상록구",
    "theme": "상가",
    "answer": "상록구 검색 업체의 주소와 현장 작업 가능 여부를 대조하고 임대인의 복구 요구를 사진에 표시하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-상가-원상복구-철거-비용",
      "안산-사무실-원상복구-철거",
      "상록구-식당-폐업-철거",
      "군포-상가-철거-원상복구-비용",
      "시흥-상가-원상복구-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 상록구 철거",
    "keywords": [
      "안산 상록구 철거",
      "안산 상록구 상가 철거·원상복구 비용"
    ]
  },
  {
    "slug": "상록구-식당-폐업-철거",
    "h1": "안산 상록구 식당 폐업 철거",
    "title": "안산 상록구 식당 폐업 철거 · 동네장사",
    "desc": "안산 상록구 식당 폐업 철거에서 주방 설비와 공용 덕트의 경계를 확인하세요. 집기 인계 이후 남는 철거 대상과 급배수 마감, 폐기물 처리 책임을 구분해 업체에 전달할 질문을 정리합니다.",
    "region": "안산 상록구",
    "theme": "식당",
    "answer": "상록구 식당의 공용 덕트와 개별 주방 설비 경계를 구분하고 철거 후 급배수 마감 책임을 확인하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-식당-폐업-철거-비용",
      "안산-카페-철거-비용-폐기물",
      "상록구-상가-철거-원상복구-비용",
      "군포-식당-폐업-철거",
      "시흥-카페-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 상록구 철거",
    "keywords": [
      "안산 상록구 철거",
      "안산 상록구 식당 폐업 철거"
    ]
  },
  {
    "slug": "단원구-상가-원상복구-비용",
    "h1": "안산 단원구 상가 원상복구 비용",
    "title": "안산 단원구 상가 원상복구 비용 · 동네장사",
    "desc": "안산 단원구 상가 원상복구 비용을 검토할 때 작업 범위와 반출 조건을 함께 확인하세요. 역세권 점포라면 보행 동선과 차량 진입, 관리주체가 정한 작업 시간 및 공용부 보양 조건도 살펴봅니다.",
    "region": "안산 단원구",
    "theme": "상가",
    "answer": "역세권 점포에 해당하면 보행 동선과 반출 차량 진입, 공용부 보양 및 작업 시간 협의 여부를 확인하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-상가-원상복구-철거-비용",
      "단원구-카페-철거-비용",
      "단원구-사무실-철거-폐기물-처리",
      "군포-상가-철거-원상복구-비용",
      "시흥-상가-원상복구-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 단원구 철거",
    "keywords": [
      "안산 단원구 철거",
      "안산 단원구 상가 원상복구 비용"
    ]
  },
  {
    "slug": "단원구-카페-철거-비용",
    "h1": "안산 단원구 카페 철거 비용",
    "title": "안산 단원구 카페 철거 비용 · 동네장사",
    "desc": "안산 단원구 카페 철거를 앞두고 카운터 해체와 천장 설비 보존 조건을 나누어 확인하세요. 조명과 냉난방 설비, 배관 마감의 책임을 정하고 폐기물 운반까지 포함된 견적인지 점검하는 내용을 안내합니다.",
    "region": "안산 단원구",
    "theme": "카페",
    "answer": "카페 천장의 조명·냉난방 설비 보존 조건과 카운터 해체 후 배관 마감 책임을 각각 확인하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-카페-철거-비용-폐기물",
      "단원구-상가-원상복구-비용",
      "단원구-사무실-철거-폐기물-처리",
      "군포-식당-폐업-철거",
      "시흥-카페-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 단원구 철거",
    "keywords": [
      "안산 단원구 철거",
      "안산 단원구 카페 철거 비용"
    ]
  },
  {
    "slug": "단원구-사무실-철거-폐기물-처리",
    "h1": "안산 단원구 사무실 철거·폐기물 처리",
    "title": "안산 단원구 사무실 철거·폐기물 처리 · 동네장사",
    "desc": "안산 단원구 사무실 철거와 폐기물 처리를 준비할 때 재사용 가구를 먼저 구분하세요. 엘리베이터 사용과 반출 동선, 공용부 보양 및 처리 범위를 확인하고 견적서의 운반 항목을 점검합니다.",
    "region": "안산 단원구",
    "theme": "사무실",
    "answer": "사무용 가구 재사용과 철거 폐기물을 나누고 엘리베이터 사용 조건 및 반출 동선을 함께 확인하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "안산-사무실-원상복구-철거",
      "단원구-상가-원상복구-비용",
      "단원구-카페-철거-비용",
      "군포-사무실-철거-폐기물-처리",
      "시흥-상가-원상복구-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "안산 단원구 철거",
    "keywords": [
      "안산 단원구 철거",
      "안산 단원구 사무실 철거·폐기물 처리"
    ]
  },
  {
    "slug": "군포-상가-철거-원상복구-비용",
    "h1": "군포 상가 철거·원상복구 비용",
    "title": "군포 상가 철거·원상복구 비용 · 동네장사",
    "desc": "군포 상가 철거와 원상복구를 준비하는 임차인을 위해 복구 기준 합의와 견적 확인 순서를 안내합니다. 산본 상가에 해당한다면 관리규약과 공용부 사용, 반출 시간 조건을 현장에서 함께 확인하세요.",
    "region": "군포",
    "theme": "상가",
    "answer": "산본 상가에 해당하면 관리규약과 공용부 사용 조건을 확인하고 원상복구 완료 기준을 문서화하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "군포-사무실-철거-폐기물-처리",
      "군포-식당-폐업-철거",
      "안산-상가-원상복구-철거-비용",
      "단원구-상가-원상복구-비용",
      "시흥-상가-원상복구-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "군포 상가철거",
    "keywords": [
      "군포 상가철거",
      "군포 상가 철거·원상복구 비용"
    ]
  },
  {
    "slug": "군포-사무실-철거-폐기물-처리",
    "h1": "군포 사무실 철거와 폐기물 처리",
    "title": "군포 사무실 철거와 폐기물 처리 · 동네장사",
    "desc": "군포 사무실 철거와 폐기물 처리를 앞두고 이전 일정과 설비 보존 대상을 먼저 정하세요. 통신 배선 철거 책임, 가구 반출 및 폐기물 운반 항목을 구분해 같은 작업 범위로 견적을 비교하도록 돕습니다.",
    "region": "군포",
    "theme": "사무실",
    "answer": "사무실 이전 일정에 맞춰 통신 설비 보존 대상을 정하고 철거·운반·처리 견적 항목을 분리하세요. 엘리베이터 사용 시간과 폐기물 적재 위치를 관리사무소에 먼저 확인하세요.",
    "partnerSlugs": [
      "군포-상가-철거-원상복구-비용",
      "군포-식당-폐업-철거",
      "안산-사무실-원상복구-철거",
      "단원구-사무실-철거-폐기물-처리",
      "시흥-카페-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "군포 철거",
    "keywords": [
      "군포 철거",
      "군포 사무실 철거와 폐기물 처리"
    ]
  },
  {
    "slug": "군포-식당-폐업-철거",
    "h1": "군포 식당 폐업 철거",
    "title": "군포 식당 폐업 철거 · 동네장사",
    "desc": "군포 식당 폐업 철거는 중고 주방기기 인계와 남은 설비 해체 순서를 맞춰 준비하세요. 가스와 급배수 마감 책임, 폐기물 처리 범위 및 점포 반환 조건을 견적서에 확인할 항목으로 정리합니다.",
    "region": "군포",
    "theme": "식당",
    "answer": "중고 주방기기 인계 후 남은 철거 항목을 확정하고 가스·급배수 설비 마감 책임을 확인하세요. 비용은 같은 작업 범위와 폐기물 처리 조건으로 받은 현장 견적서를 비교해 확인하세요.",
    "partnerSlugs": [
      "군포-상가-철거-원상복구-비용",
      "군포-사무실-철거-폐기물-처리",
      "안산-식당-폐업-철거-비용",
      "상록구-식당-폐업-철거",
      "시흥-카페-철거-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "군포 철거",
    "keywords": [
      "군포 철거",
      "군포 식당 폐업 철거"
    ]
  },
  {
    "slug": "시흥-상가-원상복구-철거-비용",
    "h1": "시흥 상가 원상복구 철거 비용",
    "title": "시흥 상가 원상복구 철거 비용 · 동네장사",
    "desc": "시흥 상가 원상복구 철거 비용을 알아볼 때 점포의 최초 인도 상태와 추가 시공 내역을 대조하세요. 신도시 상가에 해당하는 현장도 계약상 복구 기준, 폐기물 반출 및 마감 범위를 개별 확인해야 합니다.",
    "region": "시흥",
    "theme": "상가",
    "answer": "신도시 상가에 해당하면 최초 인도 상태와 추가 시공 내역을 대조하고 계약상 복구 기준을 합의하세요. 반출 동선과 공용부 보양 조건을 확인한 뒤 같은 범위로 견적을 받으세요.",
    "partnerSlugs": [
      "시흥-카페-철거-비용",
      "안산-상가-원상복구-철거-비용",
      "군포-상가-철거-원상복구-비용",
      "상록구-상가-철거-원상복구-비용",
      "단원구-상가-원상복구-비용",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "시흥 상가철거",
    "keywords": [
      "시흥 상가철거",
      "시흥 상가 원상복구 철거 비용"
    ]
  },
  {
    "slug": "시흥-카페-철거-비용",
    "h1": "시흥 카페 철거 비용",
    "title": "시흥 카페 철거 비용 · 동네장사",
    "desc": "시흥 카페 철거 비용을 검토하는 운영자를 위해 매립 배관과 바닥 마감의 철거 경계를 살펴봅니다. 장비 회수 순서와 폐기물 적재 공간, 운반 및 처리 책임을 구분해 업체 견적에서 확인하세요.",
    "region": "시흥",
    "theme": "카페",
    "answer": "매립 배관과 바닥 마감의 철거 경계를 정하고 카페 장비 회수 순서 및 폐기물 적재 공간을 확인하세요. 배관·전기 마감 책임과 특수 폐기물 여부를 업체에 미리 알려 견적 차이를 줄이세요.",
    "partnerSlugs": [
      "시흥-상가-원상복구-철거-비용",
      "안산-카페-철거-비용-폐기물",
      "단원구-카페-철거-비용",
      "군포-사무실-철거-폐기물-처리",
      "군포-식당-폐업-철거",
      "철거-견적-비교-기준"
    ],
    "sourceKeyword": "시흥 철거",
    "keywords": [
      "시흥 철거",
      "시흥 카페 철거 비용"
    ]
  },
  {
    "slug": "철거-견적-비교-기준",
    "h1": "철거 견적서 비교, 어디를 봐야 하나",
    "title": "철거 견적서 비교, 어디를 봐야 하나 · 동네장사",
    "desc": "안산·군포·시흥에서 받은 철거 견적서는 동일한 작업 범위를 기준으로 비교하세요. 포함 항목과 제외 항목, 폐기물 처리 및 추가 작업 조건을 확인하고 공개 업체 정보와 실제 견적을 구분하는 방법을 안내합니다.",
    "region": "안산·군포·시흥",
    "theme": "업체 비교",
    "answer": "세 지역의 검색 순위를 키워드별로 구분하고 같은 작업 범위로 받은 견적의 포함·제외 항목을 비교하세요. 철거·운반·처리·마감을 항목별로 적어 달라고 하고 빠진 항목을 확인하세요.",
    "partnerSlugs": [
      "안산-상가-원상복구-철거-비용",
      "단원구-상가-원상복구-비용",
      "군포-상가-철거-원상복구-비용",
      "군포-사무실-철거-폐기물-처리",
      "시흥-상가-원상복구-철거-비용",
      "시흥-카페-철거-비용"
    ],
    "sourceKeyword": "안산 철거 + 군포 철거 + 시흥 철거",
    "keywords": [
      "안산 철거 + 군포 철거 + 시흥 철거",
      "철거 견적서 비교, 어디를 봐야 하나"
    ]
  }
];
const sources = [places0, places1, places2, places3, places4, places5, places6, places7, places8, places9, places10, places11,
  extraPlaces0, extraPlaces1, extraPlaces2, extraPlaces3, extraPlaces4, extraPlaces5, extraPlaces6, extraPlaces7];

type Content = { answer: string; sections: { h: string; paragraphs: string[] }[]; faqs: {q: string; a: string}[] };
const contents: Record<string, Content> = contentData;
const pageMapping: Record<string, {sourceKeyword: string; placeIds: string[]; note: string}> = mapping;
const esc = (v: unknown) => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const inline = (s: string) => esc(s).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/p\/\d+)\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const costPath = (slug: string) => '/cost/' + encodeURIComponent(slug);
const origin = 'https://dongbiz.com';
export const COST_URLS = [origin + '/cost', ...COST_PAGES.map(p => origin + costPath(p.slug))];
export function costPlaces(slug: string) {
  const m = pageMapping[slug];
  const keywords = m.sourceKeyword.split(' + ');
  if (m.sourceKeyword === '안산 사무실철거') keywords.push('안산 철거');
  return m.placeIds.map(id => {
    for (const keyword of keywords) {
      const source = sources.find(s => s.keyword === keyword && s.status === 'success');
      const item = source?.items.find(p => p.placeId === id && p.regionOk === true);
      if (item) return { ...item, sourceKeyword: keyword };
    }
    throw new Error(`Missing region-matched place: ${slug}/${id}`);
  });
}
export const COST_STYLE = `${SITE_NAV_CSS}\n${SITE_FOOTER_CSS}
*{box-sizing:border-box}body{margin:0;color:#172d35;background:#f5f7f7;font-family:system-ui,-apple-system,sans-serif;line-height:1.8}a{color:#006b61;text-underline-offset:3px}.cost-wrap{max-width:1040px;margin:auto;padding:36px 24px 64px}.cost-wrap h1{font-size:clamp(28px,4vw,42px);line-height:1.35;letter-spacing:-.04em}.cost-wrap h2{font-size:24px;line-height:1.4;margin-top:0}.cost-wrap section{margin:28px 0;padding:28px;background:white;border:1px solid #dce5e4;border-radius:16px}.cost-wrap,.cost-wrap p,.cost-wrap h1,.cost-wrap h2,.cost-wrap th,.cost-wrap td{word-break:keep-all;overflow-wrap:break-word}.cost-kicker{color:#006b61;font-weight:700}.cost-answer{background:#e5f3ef!important;border-left:4px solid #007c70!important}.cost-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.cost-card{display:block;background:white;border:1px solid #dce5e4;border-radius:16px;padding:24px;text-decoration:none}.cost-card h2{margin:8px 0;font-size:22px}.cost-card p{color:#425c64;margin-bottom:0}.cost-table-scroll{overflow-x:auto}.cost-wrap table{width:100%;border-collapse:collapse;min-width:680px;font-size:14px}.cost-wrap th,.cost-wrap td{text-align:left;padding:12px;border-bottom:1px solid #dce5e4}.cost-wrap th{background:#eff5f3;white-space:nowrap}.cost-wrap td:nth-child(2){white-space:normal;word-break:keep-all}.cost-wrap details{padding:16px 0;border-bottom:1px solid #dce5e4}.cost-wrap summary{cursor:pointer;font-weight:700}.cost-ctas{display:flex;gap:12px;flex-wrap:wrap}.cost-ctas a{display:block;padding:14px 18px;background:#006b61;color:white;border-radius:10px;text-decoration:none}.cost-source{font-size:14px;color:#52656a}.cost-related ul{padding-left:22px}.cost-breadcrumb{font-size:14px;color:#52656a}.cost-photo{margin:0;border:1px solid #dce5e4;border-radius:16px;overflow:hidden;background:#fff}.cost-photo img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;background:#dfe7e6}.cost-photo figcaption{padding:12px 16px 14px;font-size:14px;line-height:1.65;color:#465e66}.cost-photo figcaption strong{color:#172d35}.cost-photo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.cost-photo-grid a{display:block;color:inherit;text-decoration:none;background:#fff;border:1px solid #dce5e4;border-radius:16px;overflow:hidden}.cost-photo-grid img{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;background:#dfe7e6}.cost-photo-grid span{display:block;padding:10px 14px 12px;font-size:14px;font-weight:700;color:#172d35}.cost-photo-note{font-size:13px;color:#52656a;margin-top:10px}@media(max-width:600px){.cost-wrap{padding:24px 16px 40px}.cost-photo-grid{grid-template-columns:1fr}.cost-grid{grid-template-columns:1fr}.cost-wrap section{padding:20px}.cost-ctas{flex-direction:column}.cost-wrap h2{font-size:21px}}`;
function document(title: string, desc: string, path: string, graph: object[], body: string) {
  const url = origin + path;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}"><meta property="og:type" content="${path === '/cost' ? 'website' : 'article'}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@graph':graph}).replace(/</g,'\\u003c')}</script><style>${COST_STYLE}</style></head><body>${siteNav('place')}<main class="cost-wrap">${body}</main>${siteFooter()}</body></html>`;
}

const COST_PHOTOS: Record<string, { src: string; alt: string; caption: string }> = {
  '상가': {
    src: '/cost-images/cost-store-demolition.webp',
    alt: '철거를 앞두고 바닥 마감과 벽 타일이 걷긴 빈 상가 내부, 출입문 옆에 폐기물 봉투가 쌓인 모습',
    caption: '철거 전 내부 모습. 남길 시설과 걷어낼 마감을 사진으로 나눠 두면 업체 견적을 같은 기준으로 비교하기 쉽습니다.',
  },
  '식당': {
    src: '/cost-images/cost-restaurant-demolition.webp',
    alt: '폐업한 식당 주방, 후드 덕트가 열린 천장과 배관이 남은 타일 벽면, 바닥에 자재가 쌓인 모습',
    caption: '주방 철거 현장. 후드·덕트와 급배수 배관이 어디까지 남는지 사진으로 남겨 두면 마감 책임을 가리기 쉽습니다.',
  },
  '카페': {
    src: '/cost-images/cost-cafe-demolition.webp',
    alt: '카페 철거 중인 실내, 카운터 상판이 걷긴 자리의 배관과 천장에서 늘어진 조명 배선, 바닥에 타일 조각이 흩어진 모습',
    caption: '카운터 철거 현장. 카운터 아래 배관과 천장 설비를 남길지 걷어낼지 먼저 정해야 견적이 흔들리지 않습니다.',
  },
  '사무실': {
    src: '/cost-images/cost-office-demolition.webp',
    alt: '원상복구를 앞둔 빈 사무실, 칸막이 자국이 남은 바닥과 천장에서 내려온 통신 배선, 의자 하나가 남은 모습',
    caption: '원상복구 전 모습. 칸막이와 바닥 마감, 통신 배선 철거 책임을 계약서와 사진으로 대조해 두세요.',
  },
};
const photoOf = (theme: string) => theme.includes('카페') ? COST_PHOTOS['카페'] : theme.includes('식당') ? COST_PHOTOS['식당'] : theme.includes('사무실') ? COST_PHOTOS['사무실'] : COST_PHOTOS['상가'];
const photoFigure = (theme: string, label: string) => {
  const ph = photoOf(theme);
  return `<figure class="cost-photo"><img src="${ph.src}" alt="${esc(ph.alt)}" width="1086" height="678" loading="lazy" decoding="async"><figcaption><strong>${esc(label)} 현장 예시</strong> · ${esc(ph.caption)}</figcaption></figure>`;
};
const HUB_PHOTOS = [
  { slug: '안산-상가-원상복구-철거-비용', theme: '상가', label: '상가 원상복구' },
  { slug: '안산-식당-폐업-철거-비용', theme: '식당', label: '식당 폐업 철거' },
  { slug: '안산-카페-철거-비용-폐기물', theme: '카페', label: '카페 철거' },
  { slug: '안산-사무실-원상복구-철거', theme: '사무실', label: '사무실 원상복구' },
];
export function renderCostHub() {
  const title = '철거·원상복구 비용과 견적 비교';
  const desc = '안산·군포·시흥 상가, 식당, 카페, 사무실의 철거·원상복구 범위와 견적 비교 기준을 확인하세요.';
  return document(title + ' · 동네장사', desc, '/cost', [
    {'@type':'CollectionPage',name:title,url:origin+'/cost',description:desc},
    {'@type':'ItemList',itemListElement:COST_PAGES.map((p,i)=>({'@type':'ListItem',position:i+1,name:p.h1,url:origin+costPath(p.slug)}))}
  ], `<p class="cost-kicker">동네장사 · 점포 정리 가이드</p><h1>${title}</h1><p>${desc}</p><p>금액은 현장 견적으로 확인하고, 같은 작업 범위로 비교하세요.</p><section><h2>현장 사진으로 보는 철거 유형</h2><div class="cost-photo-grid">${HUB_PHOTOS.map(h => `<a href="${costPath(h.slug)}"><img src="${photoOf(h.theme).src}" alt="${esc(photoOf(h.theme).alt)}" width="1086" height="678" loading="lazy" decoding="async"><span>${esc(h.label)}</span></a>`).join('')}</div><p class="cost-photo-note">현장 분위기를 보여주는 예시 이미지입니다. 실제 작업 범위와 마감 상태는 현장마다 다릅니다.</p></section><div class="cost-grid">${COST_PAGES.map(p=>`<a class="cost-card" href="${costPath(p.slug)}"><span class="cost-kicker">${esc(p.region)} · ${esc(p.theme)}</span><h2>${esc(p.h1)}</h2><p>${esc(p.desc)}</p></a>`).join('')}</div>`);
}
export function renderCostPage(slug: string) {
  const p = COST_PAGES.find(p => p.slug === slug);
  if (!p) return null;
  const content = contents[slug], places = costPlaces(slug), url = origin + costPath(slug);
  const graph = [
    {'@type':'Article',headline:p.h1,description:p.desc,url,mainEntityOfPage:url,author:{'@type':'Organization',name:'동네장사'},publisher:{'@type':'Organization',name:'동네장사'}},
    {'@type':'BreadcrumbList',itemListElement:[{name:'홈',item:origin+'/'},{name:'철거·원상복구 비용',item:origin+'/cost'},{name:p.h1,item:url}].map((x,i)=>({'@type':'ListItem',position:i+1,...x}))},
    {'@type':'FAQPage',mainEntity:content.faqs.map(f=>({'@type':'Question',name:f.q,acceptedAnswer:{'@type':'Answer',text:f.a}}))}
  ];
  return document(p.title,p.desc,costPath(slug),graph,`
<nav class="cost-breadcrumb" aria-label="현재 위치"><a href="/">홈</a> › <a href="/cost">철거·원상복구 비용</a> › ${esc(p.h1)}</nav>
<h1>${esc(p.h1)}</h1><section class="cost-answer" id="aeo-direct-answer"><p>${inline(content.answer || p.answer)}</p></section>
${photoFigure(p.theme, p.theme === '업체 비교' ? '철거' : `${p.region} ${p.theme}`)}
<div id="cost-body">${content.sections.map(s=>`<section><h2>${esc(s.h)}</h2>${s.paragraphs.map(t=>`<p>${inline(t)}</p>`).join('')}</section>`).join('')}</div>
<section><h2>실측 업체 정보</h2><p>공개 정보로 확인한 비교 후보입니다. 리뷰 미확인은 —로 표시하며, 검색별 순위는 통합 순위가 아닙니다. 유형·지역 키워드에서 먼저 확인한 업체를 싣고, 자리가 모자라면 같은 지역의 다른 수집 키워드로 채웠습니다.</p><div class="cost-table-scroll" role="region" aria-label="업체 비교 표, 가로 스크롤 가능" tabindex="0"><table id="cost-places"><caption>${esc(pageMapping[slug].sourceKeyword)} 수집 키워드로 확인한 업체</caption><thead><tr>${['업체명','카테고리','방문리뷰','블로그리뷰','주소','출처 키워드','검색별 순위'].map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${places.map(x=>`<tr data-place-id="${esc(x.placeId)}"><td><a href="/p/${esc(x.placeId)}">${esc(x.name)}</a></td><td>${esc(x.category)}</td><td>${esc(x.visitorReviewCount)}</td><td>${esc(x.blogCafeReviewCount)}</td><td>${esc(x.fullAddress)}</td><td>${esc(x.sourceKeyword)}</td><td>${esc(x.rank)}</td></tr>`).join('')}</tbody></table></div></section>
<section><h2>견적 비교 체크리스트</h2><ul>${['임대차 계약과 입점 사진으로 복구 범위 확인','남길 시설과 철거할 시설을 목록으로 구분','폐기물 분리·운반·처리의 포함 여부 확인','작업 시간·차량 진입·공용부 보양 조건 확인','견적서 포함·제외 항목과 추가 작업 협의 방식 확인','완료 검수와 시설 마감 책임을 서면으로 확인'].map(x=>`<li>${x}</li>`).join('')}</ul></section>
<section id="cost-faq"><h2>자주 묻는 질문</h2>${content.faqs.map(f=>`<details><summary>${esc(f.q)}</summary><p>${inline(f.a)}</p></details>`).join('')}</section>
<div class="cost-ctas"><a href="/">내 업체 플레이스 순위·점수 무료 진단하기</a><a href="/guide/플레이스정보수정순위">우리 업체 정보 수정·등록 문의</a></div>
<p class="cost-source">업체 정보는 네이버 플레이스 공개 정보를 2026-11-23에 수집한 값이며, 순위는 검색 위치·시점에 따라 달라집니다.</p>
<section class="cost-related" id="cost-related"><h2>함께 확인할 정보</h2><a href="/cost">철거·원상복구 비용 전체 보기</a><ul>${p.partnerSlugs.map(s=>`<li><a href="${costPath(s)}">${esc(COST_PAGES.find(x=>x.slug===s)!.h1)}</a></li>`).join('')}<li><a href="/guide/플레이스경쟁분석">플레이스 경쟁 분석</a></li><li><a href="/guide/플레이스정보수정순위">플레이스 정보 수정과 순위</a></li><li><a href="/rank/${encodeURIComponent(p.sourceKeyword.split(' + ')[0])}">${esc(p.sourceKeyword.split(' + ')[0])} 순위 확인</a></li></ul></section>`);
}
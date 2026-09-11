/**
 * 동네비즈 Apps Script 웹훅 (§6.7 / §8.2-A)
 *
 * 하는 일 2가지 — Worker가 보내는 JSON의 type으로 갈린다.
 *   1. type === 'report_email'  → 사장님에게 리포트 메일 발송 (MailApp)
 *   2. 그 외                     → 진단 로그를 시트에 append (콜드콜 리스트)
 *
 * Cloudflare Workers에는 자체 메일 발송 수단이 없어서, 이미 있던 시트 웹훅을 그대로 재사용한다.
 * 전용 메일 서비스(Resend 등)는 계정·API 키·DNS(SPF/DKIM)가 전부 따라오는데,
 * 이쪽은 무료에 하루 100통이라 현재 유입 규모에는 충분하다.
 *
 * ── 설치 방법 ─────────────────────────────────────────────────────────────
 * 1. 구글 스프레드시트 새로 만들기 → 확장 프로그램 → Apps Script
 * 2. 이 파일 내용을 통째로 붙여넣고 저장
 * 3. ⚠️ 편집기에서 함수 목록으로 authorize 를 고르고 실행(▶)한다.
 *      → Gmail 발송 권한 승인창이 뜬다. 반드시 승인할 것.
 *      배포만 하면 이 권한이 안 붙어서, 메일이 조용히 실패한다(실제로 겪음):
 *        "MailApp.sendEmail을(를) 호출할 수 있는 권한이 없습니다"
 * 4. 배포 → 새 배포 → 유형 '웹 앱'
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자          ← 이걸 안 바꾸면 Worker가 401을 받는다
 * 5. 발급된 웹 앱 URL을 복사해서:
 *      npx wrangler secret put SHEETS_WEBHOOK_URL
 *      (URL은 인자가 아니라 실행 후 프롬프트에 붙여넣는다)
 *
 * 배포 후 코드를 고치면 반드시 '배포 관리 → 편집 → 버전: 새 버전'으로 다시 배포해야
 * 반영된다. 저장만 하면 기존 URL은 옛 코드를 계속 실행한다.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * 권한 승인 전용. 편집기에서 이 함수를 한 번 실행(▶)하면 Gmail 발송 권한 승인창이 뜬다.
 * 승인이 없으면 웹훅은 HTTP 200을 주면서 본문에만 권한 오류를 담아 돌려주므로,
 * 겉보기엔 성공처럼 보이고 메일만 안 간다. 배포 전에 반드시 한 번 실행할 것.
 */
function authorize() {
  var me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: '[동네비즈] Apps Script 권한 승인 완료',
    body: '이 메일이 도착했다면 메일 발송 권한이 정상입니다.\n남은 일일 발송 한도: ' + MailApp.getRemainingDailyQuota() + '통',
    name: '동네비즈',
  });
  Logger.log('발송 완료: ' + me + ' / 남은 한도 ' + MailApp.getRemainingDailyQuota());
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.type === 'report_email') {
      return sendReportEmail_(data);
    }
    return appendDiagnosisRow_(data);
  } catch (err) {
    // 실패해도 Worker 쪽은 죽지 않는다(sent=false로 기록되고 텔레그램 알림이 간다).
    return json_({ ok: false, error: String(err) });
  }
}

/** 사장님에게 맞춤 개선 리포트 메일 발송. 본문은 Worker가 완성해서 보낸다. */
function sendReportEmail_(data) {
  if (!data.to || !data.subject || !data.body) {
    return json_({ ok: false, error: 'to/subject/body 누락' });
  }
  // 한도(일반 gmail 계정 기준 하루 100통)를 넘기면 여기서 예외가 난다.
  // Worker가 sent=0으로 기록하고 텔레그램 알림을 보내므로 리드는 잃지 않는다.
  MailApp.sendEmail({
    to: data.to,
    subject: data.subject,
    body: data.body,
    name: '동네비즈',
    replyTo: 'interpiad@gmail.com',
  });
  // 남은 한도를 같이 돌려준다 — 바닥나기 전에 알아채려면 이 값이 필요하다.
  return json_({ ok: true, quota: MailApp.getRemainingDailyQuota() });
}

/** 진단 1건을 시트에 append. 헤더는 첫 실행 때 자동 생성된다. */
function appendDiagnosisRow_(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var headers = [
    'timestamp', 'type', 'placeName', 'placeId', 'phone', 'category',
    'roadAddress', 'targetKeyword', 'myRank', 'grade', 'visitorReviews', 'shareId',
  ];
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);

  sheet.appendRow(headers.map(function (key) {
    return data[key] !== undefined && data[key] !== null ? data[key] : '';
  }));
  return json_({ ok: true });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

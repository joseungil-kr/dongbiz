/**
 * 운영자 알림 (§8.2-A). 텔레그램 + 구글시트 2개뿐 — 어댑터 계층이나 채널 설정파일을 두지 않는다.
 * 시크릿 미설정 시 조용히 무동작 (기능은 항상 정상, 알림만 안 감).
 *
 * 로컬 개발: worker/.dev.vars 에 아래 값을 채우면 wrangler dev에서도 동작함.
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=...
 *   SHEETS_WEBHOOK_URL=...
 * 배포: npx wrangler secret put TELEGRAM_BOT_TOKEN  (등)
 */

export interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  SHEETS_WEBHOOK_URL?: string;
}

// 운영자에게 텔레그램 메시지 1건 전송.
export async function notify(env: NotifyEnv, message: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
    });
  } catch (err) {
    console.error('텔레그램 알림 전송 실패:', err);
  }
}

// 진단 완료 1건을 구글시트(Apps Script 웹훅)에 append. 콜드콜 영업 리스트로 즉시 활용.
export async function logDiagnosisToSheet(env: NotifyEnv, row: Record<string, unknown>): Promise<void> {
  if (!env.SHEETS_WEBHOOK_URL) return;
  try {
    await fetch(env.SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
  } catch (err) {
    console.error('구글시트 로그 전송 실패:', err);
  }
}

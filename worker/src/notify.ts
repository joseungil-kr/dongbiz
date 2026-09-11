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

/**
 * 고객에게 메일 1통 발송 (§6.7).
 *
 * Cloudflare Workers에는 자체 발송 수단이 없다. 새 메일 서비스(Resend 등)를 붙이면 계정·
 * API 키·DNS(SPF/DKIM)가 전부 따라오므로, **이미 붙어 있는 Apps Script 웹훅을 그대로 재사용**한다.
 * 웹훅 쪽에서 `type === 'report_email'`이면 MailApp.sendEmail을 태우도록 분기해둬야 한다.
 * 무료·하루 100통이라 현재 유입 규모에는 충분하다.
 *
 * 반환값은 "웹훅 호출이 성공했는지"까지만 보장한다 — 실제 수신 여부는 알 수 없다.
 */
export async function sendCustomerEmail(
  env: NotifyEnv,
  mail: { to: string; subject: string; body: string },
): Promise<{ sent: boolean; quota?: number; error?: string }> {
  if (!env.SHEETS_WEBHOOK_URL) return { sent: false, error: 'SHEETS_WEBHOOK_URL 미설정' };
  try {
    const res = await fetch(env.SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'report_email', ...mail }),
    });
    // ⚠️ Apps Script는 스크립트가 예외를 던져도 HTTP 200을 준다. res.ok만 보면 발송 실패를
    // 성공으로 기록한다(실제로 겪음 — 권한 미승인 상태에서 sent=true로 남았다).
    // 반드시 본문의 ok 필드를 확인할 것.
    if (!res.ok) return { sent: false, error: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { ok?: boolean; quota?: number; error?: string } | null;
    if (!body?.ok) {
      const error = body?.error ?? '응답 파싱 실패';
      console.error('리포트 메일 발송 실패(Apps Script):', error);
      return { sent: false, error };
    }
    return { sent: true, quota: body.quota };
  } catch (err: any) {
    console.error('리포트 메일 발송 실패:', err);
    return { sent: false, error: err?.message || String(err) };
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

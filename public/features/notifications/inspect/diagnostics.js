/**
 * الفحص الدقيق للإشعارات: يجمع حالة الجهاز ويرسلها للخادم،
 * ثم يعيد تقريرًا موحّدًا (قنوات + فحوص + آخر الأخطاء).
 */
import { clientQuery, collectClientState } from './checks.js';

export async function fetchPreciseDiagnostics() {
  const client = await collectClientState();
  const params = clientQuery(client);
  const res = await fetch(`/api/notifications/diagnostics?${params}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || payload?.ok === false) {
    const message = payload?.error?.message || `تعذّر الفحص (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, client });
  }
  return { client, report: payload.data };
}

const ICON = { ok: '✅', warn: '⚠️', fail: '❌' };

export function formatPreciseReport({ client, report }) {
  const lines = [
    '— فحص دقيق —',
    `${ICON[report.status] || '•'} النتيجة ${report.score}٪ (${report.status})`,
    `القنوات: داخل التطبيق ${report.channels.inApp ? '✓' : '✗'} • SSE ${report.channels.sse ? '✓' : '✗'} • Push ${report.channels.webPush ? '✓' : '✗'} • أجهزة ${report.channels.webPushDevices}`,
    `الصندوق: ${report.inbox.total} إشعارًا • ${report.inbox.unread} غير مقروء`,
    client?.endpointHost ? `خدمة الدفع: ${client.endpointHost}` : '',
  ];
  for (const item of report.checks) {
    lines.push(`${ICON[item.status] || '•'} ${item.label}: ${item.detail}${item.fix ? ` → ${item.fix}` : ''}`);
  }
  if (report.lastError) lines.push(`آخر خطأ تسليم: ${report.lastError.lastError}`);
  return lines.filter(Boolean).join('\n');
}

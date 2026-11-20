/**
 * فحص شامل للمشروع والأنظمة والإشعارات — بلا تشغيل الخادم.
 * التشغيل: npm run inspect   أو   node tools/inspect/index.mjs --json
 */
import { inspectProject } from './project.mjs';
import { inspectRoutines } from './routines.mjs';
import { inspectNotifications } from './notifications.mjs';

const asJson = process.argv.includes('--json');

function score(checks) {
  if (!checks.length) return 0;
  const points = checks.reduce((sum, item) => sum + (item.status === 'ok' ? 1 : item.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((points / checks.length) * 100);
}

function status(checks) {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'ok';
}

const sections = {
  project: await inspectProject(),
  routines: await inspectRoutines(),
  notifications: await inspectNotifications(),
};
const all = Object.values(sections).flat();
const report = {
  checkedAt: new Date().toISOString(),
  status: status(all),
  score: score(all),
  sections: Object.fromEntries(
    Object.entries(sections).map(([name, checks]) => [name, { status: status(checks), score: score(checks), checks }])
  ),
  totals: {
    ok: all.filter((c) => c.status === 'ok').length,
    warn: all.filter((c) => c.status === 'warn').length,
    fail: all.filter((c) => c.status === 'fail').length,
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const icon = { ok: '✅', warn: '⚠️ ', fail: '❌' };
  console.log(`\n🔎 فحص المشروع والأنظمة والإشعارات — ${report.score}% (${report.status})`);
  for (const [name, checks] of Object.entries(sections)) {
    const labels = { project: 'المشروع', routines: 'الأنظمة والروتينات', notifications: 'الإشعارات' };
    console.log(`\n— ${labels[name] || name}`);
    for (const item of checks) console.log(`  ${icon[item.status] || '•'} ${item.label}: ${item.detail}${item.fix ? ` → ${item.fix}` : ''}`);
  }
  console.log(`\nالإجمالي: ✅ ${report.totals.ok} • ⚠️ ${report.totals.warn} • ❌ ${report.totals.fail}\n`);
}

if (report.status === 'fail') process.exitCode = 1;

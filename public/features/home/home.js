/**
 * الصفحة الرئيسية — المدخل.
 * المسجّل يرى "لوحة اليوم" (روتيناته مباشرة)، والزائر يرى الصفحة التعريفية.
 */
import { appStore, auth } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { mountDashboard } from './dashboard.js';
import { mountLanding } from './landing.js';

export async function mount(root) {
  if (!appStore.state.sessionChecked) await auth.refresh();

  if (appStore.state.authenticated) {
    // الأنماط أساس لرسم لوحة اليوم — ننتظرها قبل الرسم (سريعة ومحلية)
    await loadStyles(['/features/routines/routines.css']);
    await mountDashboard(root);
    return;
  }

  await mountLanding(root);
}

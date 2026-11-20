/**
 * عميل ميزة الروتينات (ميزة فرعية) — كل نداءات API في مكان واحد.
 */
import { api } from '../../assets/core/core.js';

export const routinesApi = {
  list: ({ archived = true } = {}) => api.get(`/api/routines/${archived ? '?archived=1' : ''}`),
  today: () => api.get('/api/routines/today'),
  coach: () => api.get('/api/routines/coach'),
  suggestions: () => api.get('/api/routines/suggestions'),
  library: ({ category = '', q = '' } = {}) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    return api.get(`/api/routines/library${params.size ? `?${params}` : ''}`);
  },
  diagnostics: (query = '') => api.get(`/api/routines/diagnostics${query ? `?${query}` : ''}`),
  history: (days = 30) => api.get(`/api/routines/history?days=${Number(days) || 30}`),

  create: (payload) => api.post('/api/routines', payload),
  update: (id, payload) => api.patch(`/api/routines/${id}`, payload),
  remove: (id) => api.del(`/api/routines/${id}`),
  duplicate: (id) => api.post(`/api/routines/${id}/duplicate`, {}),
  setArchived: (id, archived) => api.patch(`/api/routines/${id}`, { archived }),
  setStatus: (id, status, date) => api.put(`/api/routines/${id}/status`, { status, date }),
  saveSettings: (payload) => api.put('/api/routines/settings', payload),
  reorder: (ids) => api.put('/api/routines/order', { ids }),

  reminders: () => api.get('/api/routines/reminders'),
  nudge: (routineId) => api.post('/api/routines/nudge', routineId ? { routineId } : {}),

  // أنظمة الروتين الجاهزة (٥ أنظمة)
  systems: () => api.get('/api/routines/systems'),
  system: (id) => api.get(`/api/routines/systems/${encodeURIComponent(id)}`),
  applySystem: (id, payload = {}) => api.post(`/api/routines/systems/${encodeURIComponent(id)}/apply`, payload),

  // مركز القيادة — أكثر من ١٢٠ قدرة
  mega: () => api.get('/api/routines/mega'),
  megaCatalog: () => api.get('/api/routines/mega/catalog'),
  saveMegaSettings: (payload) => api.put('/api/routines/mega/settings', payload),
  createGoal: (payload) => api.post('/api/routines/mega/goals', payload),
  updateGoal: (id, payload) => api.patch(`/api/routines/mega/goals/${encodeURIComponent(id)}`, payload),
  deleteGoal: (id) => api.del(`/api/routines/mega/goals/${encodeURIComponent(id)}`),
  claimGoal: (id) => api.post(`/api/routines/mega/goals/${encodeURIComponent(id)}/claim`, {}),
  addJournal: (payload) => api.post('/api/routines/mega/journal', payload),
  deleteJournal: (id) => api.del(`/api/routines/mega/journal/${encodeURIComponent(id)}`),
  setMood: (payload) => api.post('/api/routines/mega/mood', payload),
  logFocus: (payload) => api.post('/api/routines/mega/focus', payload),
  addReview: (payload) => api.post('/api/routines/mega/reviews', payload),
  claimChallenge: (id) => api.post(`/api/routines/mega/challenges/${encodeURIComponent(id)}/claim`, {}),
  saveTemplate: (payload) => api.post('/api/routines/mega/templates', payload),
  deleteTemplate: (id) => api.del(`/api/routines/mega/templates/${encodeURIComponent(id)}`),
  applyTemplate: (id) => api.post(`/api/routines/mega/templates/${encodeURIComponent(id)}/apply`, {}),
  autoPlan: (mode = 'schedule') => api.post('/api/routines/mega/auto-plan', { mode }),
  batch: (action, ids, value) => api.post('/api/routines/mega/batch', { action, ids, value }),
  importData: (routines) => api.post('/api/routines/mega/import', { routines }),
  exportUrl: (format = 'json') => `/api/routines/mega/export?format=${encodeURIComponent(format)}`,
};

/** المنطقة الزمنية للجهاز — تُقترح مرة واحدة على الخادم */
export const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
  } catch {
    return 'Asia/Riyadh';
  }
};

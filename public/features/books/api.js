import { api } from '../../assets/core/core.js';

export const booksApi = {
  status: () => api.get('/api/books/ai/status', { silent: true }),
  models: () => api.get('/api/books/ai/models', { silent: true }),
  help: (payload) => api.post('/api/books/ai/help', payload),
  fixOcr: (payload) => api.post('/api/books/ai/ocr-fix', payload, { silent: true }),
  saveSettings: (payload) => api.put('/api/books/ai/settings', payload),
  activate: (payload) => api.post('/api/books/ai/settings/active', payload),
  removeProvider: (provider) => api.del(`/api/books/ai/settings/${encodeURIComponent(provider)}`),
  test: () => api.post('/api/books/ai/test', {}),
  cloud: (enabled) =>
    api.patch('/api/me', { preferences: { notifications: { cloudAi: Boolean(enabled) } } }),
};

/**
 * ميزة الصفحات القانونية: الشروط والخصوصية.
 * تُخدم من public/legal — ثابتة، بلا جافاسكربت، وبلا كاش.
 */
import path from 'node:path';

export default {
  register(app, ctx) {
    const dir = path.join(ctx.config.publicDir, 'legal');
    const serve = (file) => (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(file, { root: dir }, (err) => {
        if (err) res.status(404).type('text').send('الصفحة غير متاحة بعد');
      });
    };

    app.get('/terms', serve('terms.html'));
    app.get('/privacy', serve('privacy.html'));
    app.get('/legal/terms', serve('terms.html'));
    app.get('/legal/privacy', serve('privacy.html'));
  },
};

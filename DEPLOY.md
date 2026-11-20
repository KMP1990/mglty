# النشر — Netlify + Render (أو Render فقط)

## لماذا فشل نشر Netlify؟

التطبيق ليس موقعًا ثابتًا: خادم **Express** يبني الصفحات، ويسجّل الجلسات،
ويحفظ الحسابات والإشعارات وبيانات `data/` على القرص. Netlify يشغّل ملفات
ثابتة وFunctions قصيرة العمر فقط، ولا يشغّل خادم Node دائمًا.

خطأ `Deploy directory 'dist' does not exist` سببه أن:

- `npm run build` كان يكتب مخرجات البناء في **`public/`** فقط،
  وإعداد Netlify ينتظر `dist/`.
- أصلحنا `tools/build.mjs` لينسخ `public/` إلى **`dist/`** في نهاية البناء.
- في `netlify.toml` صار النشر من `dist`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

لكن `dist` وحده يعرض الأصول فقط، لأن صفحات التطبيق تُبنى في الخادم.
لذلك أضفنا Edge Function تمرّر الصفحات و`/api` إلى خادم Node.

---

## الطريقة الموصى بها: Render للخادم + Netlify للواجهة

### 1) انشر الخادم على Render

المشروع يحتوي `Dockerfile` و`render.yaml`.

1. ارفع المشروع إلى GitHub.
2. من Render: **New → Blueprint** واختر المستودع.
3. Render يقرأ `render.yaml` وينشئ خدمة Docker وقرصًا دائمًا على `/app/data`.
4. انتظر حتى يصبح الرابط يعمل، وتأكد من:

   ```
   https://YOUR-SERVICE.onrender.com/api/healthz
   ```

   يجب أن يرجع `{"ok":true,...}`.

> `render.yaml` يستخدم خطة `starter` لأن القرص الدائم غير متاح في الخطة
> المجانية. بدون قرص ستفقد الحسابات عند كل إعادة نشر.

### 2) اربط Netlify بالخادم

في Netlify:

**Site settings → Environment variables → Add a variable**

```
BACKEND_ORIGIN = https://YOUR-SERVICE.onrender.com
```

ثم:

**Deploys → Trigger deploy → Deploy site**

بعد إعادة النشر:

- `/` و`/books` و`/login` تُمرَّر إلى Render.
- `/assets` و`/vendor` و`/styles` و`/sw.js` تُخدَم من Netlify CDN.
- مخرجات البناء موجودة في `dist/`، فلا يظهر خطأ `dist does not exist`.
- `/api/*` تُمرَّر إلى Render.
- إذا نسيت `BACKEND_ORIGIN` ستظهر صفحة عربية توضّح الخطوة، وليس 404.

### 3) إعدادات مهمة على Render

`render.yaml` يضبط تلقائيًا:

| المتغير | القيمة |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | يُولَّد تلقائيًا |
| `DATA_DIR` | `/app/data` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SECURE` | `true` |

لا تضع `PORT`؛ Render يضبطه تلقائيًا.

---

## الطريقة الأبسط: Render فقط بدون Netlify

إذا لا تحتاج CDN منفصلًا:

1. انشر Blueprint نفسه على Render.
2. افتح رابط `onrender.com` مباشرة.
3. لا تحتاج `BACKEND_ORIGIN` ولا Netlify.

هذه الطريقة أقل تعقيدًا، وكل الطلبات على نفس الخادم.

---

## بدائل أخرى

المشروع يعمل على أي منصة تشغّل Docker مع قرص دائم:

- **Railway:** Deploy from repo → Dockerfile، وأضف Volume على `/app/data`.
- **Fly.io:** `fly launch` ثم volume على `/app/data`.
- **VPS:** `docker compose up -d` مع volume.

المتطلبات الأساسية:

- `SESSION_SECRET` عشوائي طويل.
- `DATA_DIR` على قرص دائم.
- HTTPS (للـPush وCookies الآمنة).
- `TRUST_PROXY=1` خلف Proxy.

---

## ماذا عن Netlify فقط؟

غير ممكن لهذا الإصدار. Netlify لا يشغّل Express ولا يحفظ `data/`.
تحويل التطبيق إلى Netlify Functions يحتاج قاعدة بيانات خارجية
وإعادة كتابة طبقة التخزين والجلسات والمجدول، وهو تغيير معماري كبير
وليس مجرد تعديل مجلد نشر.

---

## التحقق بعد النشر

```bash
curl https://YOUR-SERVICE.onrender.com/api/healthz
curl -I https://YOUR-SITE.netlify.app/
curl -I https://YOUR-SITE.netlify.app/books
```

- يجب أن تكون الصفحات `200` و`content-type: text/html`.
- `/api/healthz` عبر Netlify يجب أن يرجع JSON.
- إذا ظهرت صفحة «الخادم غير مرتبط» راجع `BACKEND_ORIGIN`.
- إذا ظهر 502 راجع أن خدمة Render تعمل وأن الرابط صحيح.

---

## ملاحظات

- ملفات PDF والكتب تبقى على جهاز المستخدم؛ الخادم لا يستقبلها.
- OCR العربي (`public/vendor/tesseract`) يُخدَم من Netlify CDN.
- Service Worker وPush يحتاجان HTTPS، وهو متوفر في Netlify وRender.
- المجدول الدوري (تذكيرات) يعمل على خادم Render الدائم، وليس داخل Edge Function.

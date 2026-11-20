# النشر المجاني — Netlify Functions + Blobs

هذا التطبيق Express كامل، لكنه الآن يعمل **مجانًا بالكامل على Netlify**:

| الطبقة | ماذا تفعل |
|---|---|
| Netlify CDN | يخدم `dist/` (CSS/JS/الخطوط/vendor) |
| Edge Function `proxy` | تمرّر الصفحات و`/api` إلى دالة `server` |
| Netlify Function `server` | تشغّل Express نفسه: الجلسات، الحسابات، الروتينات، الإشعارات |
| Netlify Blobs | تخزين دائم لـ`data/`: المستخدمون، الجلسات، الإشعارات، الروتينات |
| Scheduled Function `reminders` | تشغّل مجدول التذكيرات كل دقيقة بلا خادم دائم |

لا تحتاج Render، ولا قرصًا دائمًا، ولا `BACKEND_ORIGIN`، ولا بطاقة بنكية.
`BACKEND_ORIGIN` بقي **اختياريًا** لمن يريد لاحقًا خادم Node دائمًا مع SSE مباشر.

---

## 1) ارفع المشروع إلى GitHub

المستودع الحالي:

```text
https://github.com/KMP1990/mglty
```

تأكد أن آخر commit يحتوي:

- `netlify.toml`
- `netlify/edge-functions/proxy.js`
- `netlify/functions/server.mjs`
- `netlify/functions/reminders.mjs`
- `server/shared/blob-vfs.js`

---

## 2) اربط Netlify بالمستودع

في Netlify:

1. **Add new site → Import an existing project → GitHub**
2. اختر `KMP1990/mglty`.
3. اترك الإعدادات كما في `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node: `22`
4. اضغط **Deploy**.

Netlify يثبّت التبعيات تلقائيًا، ويبني `dist/`، وينشر:
- Edge Function واحدة،
- دالة `server`،
- دالة `reminders` المجدولة.

---

## 3) متغيّر واحد اختياري (مستحسن)

سر الجلسات يُنشأ تلقائيًا ويُحفظ في Netlify Blobs، لذلك الموقع يعمل بدون أي
متغيرات. لكن يمكنك تثبيته من:

**Site configuration → Environment variables**

```text
SESSION_SECRET = أي-نص-عشوائي-طويل
```

هذا يضمن بقاء الجلسات ثابتة حتى لو حُذف مخزن Blobs أو أُعيد إنشاؤه.
لا تضف `PORT` ولا `DATA_DIR`؛ الدالة تضبطهما.

`BACKEND_ORIGIN` **غير مطلوب** في هذا الوضع. لا تضفه إلا إذا قررت تشغيل
خادم Render/Railway منفصل.

---

## 4) تحقق بعد النشر

```bash
curl https://mgla.netlify.app/api/healthz
# {"ok":true,...}

curl -I https://mgla.netlify.app/
# 200 text/html

curl https://mgla.netlify.app/api/routines/mega
# 401 بلا جلسة — طبيعي
```

ثم من المتصفح:

1. افتح `/signup` وأنشئ حسابًا.
2. أنشئ روتينًا وأنجزه.
3. أعد تحميل الصفحة — يجب أن يبقى الحساب والروتين.
4. افتح `/routines` واضغط **مركز القيادة** — يجب أن تظهر ١٢٠ قدرة.

---

## كيف تعمل البيانات بلا قرص؟

`server/shared/blob-vfs.js` يركّب طبقة توافق فوق `fs/promises`:

- كل مسار داخل `DATA_DIR` يُحوَّل إلى مفتاح في Netlify Blobs.
- `readJsonSafe` و`writeJsonSafe` والجلسات والحضور والمجدول تعمل كما هي.
- الكتابة الذرّية تصبح `store.set` واحدة (Blob واحد = عملية ذرّية).
- `ensureBlobSecret()` ينشئ سر الجلسات مرة واحدة ويحفظه في `_meta/session-secret`.
- مفاتيح VAPID تُحفظ في Blobs، لذلك Web Push يبقى صالحًا بعد إعادة التشغيل.

### ملاحظات دقيقة

- **SSE** لا يبقى مفتوحًا داخل دوال Netlify، لذلك الواجهة تتحول تلقائيًا إلى
  تحديث كل ٢٠ ثانية. إشعارات Web Push الخارجية تعمل طبيعيًا.
- **المجدول** يعمل عبر Scheduled Function كل دقيقة، وليس `setInterval` داخل دالة عابرة.
- **الحدود المجانية**: ١٢٥ ألف استدعاء دالة شهريًا. المجدول يستهلك نحو ٤٣ ألفًا،
  وباقي الاستدعاءات للتطبيق. إذا تجاوزتها، قلّل جدول `reminders.mjs` إلى `*/5 * * * *`.
- **Blobs** مجاني ضمن حدود Netlify، ويحفظ الجلسات والبيانات بين الطلبات.

---

## استكشاف الأخطاء

### الصفحة تظهر «الخادم غير مرتبط»

- تأكد أن النشر جاء من Git وليس سحب مجلد `dist` يدويًا.
- افتح **Deploys → Deploy log** وابحث عن `server` و`reminders`.
- أعد النشر: **Deploys → Trigger deploy → Clear cache and deploy site**.

### `/api/healthz` يرجع 500

افتح **Functions → server → Logs**. الأسباب الشائعة:

- حزمة `@netlify/blobs` غير مثبتة: نفّذ `npm install` ثم ارفع `package-lock.json`.
- ملفات الأنظمة غير موجودة في الحزمة: تحقق من `included_files` في `netlify.toml`.
- تعذّر الوصول إلى Blobs: تأكد أن الموقع منشور من Git على Netlify وليس محليًا.

### الدخول ينجح ثم تنتهي الجلسة بسرعة

اضبط `SESSION_SECRET` في Netlify وأعد النشر. هذا يثبّت التوقيع بين كل الدوال.

### المجدول لا يرسل

- تأكد أن `reminders.mjs` ظهر في **Functions**.
- جدولته `* * * * *` (كل دقيقة).
- Web Push يحتاج HTTPS واشتراكًا من صفحة الإشعارات.

---

## الخيار الاختياري: خادم دائم (Render/Railway)

إذا أردت لاحقًا SSE مباشرًا ومجدولًا داخل عملية Node دائمة:

1. انشر `Dockerfile` على Render/Railway.
2. أضف قرصًا دائمًا على `/app/data` (مدفوع في Render).
3. في Netlify أضف:
   ```text
   BACKEND_ORIGIN = https://YOUR-SERVICE.onrender.com
   ```
4. أعد نشر Netlify. سيتحوّل Edge Function إلى ذلك الخادم بدل دالة `server`.

هذا **ليس مطلوبًا** للنسخة المجانية.

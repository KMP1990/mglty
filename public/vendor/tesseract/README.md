# Tesseract OCR (vendored)

هذه ملفات محلية لمحرك OCR العربي داخل المتصفح، حتى تعمل قراءة صور الصفحات
بلا مفتاح وبلا طلبات خارجية:

- `tesseract.esm.min.js` و`worker.min.js` من Tesseract.js (Apache-2.0).
- `tesseract-core-*-lstm.wasm(.js)` من tesseract.js-core (Apache-2.0).
- `lang/ara.traineddata.gz` من tessdata (Apache-2.0).

تُستخدم فقط عند عدم توفر نموذج رؤية مجاني، أو لتحسين النص المستخرج من
صفحات PDF ذات خطوط تالفة.

/**
 * قارئ الصور المجاني (OCR عربي) — بلا مفتاح ولا اختيار نموذج.
 * -----------------------------------------------------------------
 * عندما لا يوجد نموذج رؤية سحابي مجاني، نقرأ نص صورة الصفحة محليًا
 * بمحرك Tesseract العربي، ثم يشرحه المساعد المجاني. النتائج تُخزَّن
 * مؤقتًا حتى لا نعيد قراءة الصفحة نفسها في كل سؤال.
 */

import { repairOcrText } from './ocr-text.js';

const VENDOR = '/vendor/tesseract';
const MAX_EDGE = 1700;
const cache = new Map();
const workers = new Map();

function imageToDataUrl(source) {
  if (typeof source === 'string') {
    if (source.startsWith('data:image/')) return Promise.resolve(source);
    return fetch(source, { credentials: 'same-origin' })
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('تعذّر قراءة الصورة'));
            reader.readAsDataURL(blob);
          })
      );
  }
  if (!(source instanceof HTMLImageElement)) return Promise.resolve('');
  const image = source;
  return new Promise((resolve) => {
    const draw = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) return resolve('');
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return resolve('');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        resolve('');
      }
    };
    if (image.complete && image.naturalWidth) draw();
    else {
      image.addEventListener('load', draw, { once: true });
      image.addEventListener('error', () => resolve(''), { once: true });
    }
  });
}

function cleanOcrText(value) {
  const lines = String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^(?:page|www\.|https?:\/\/|\d{1,4})$/i.test(line))
    .filter((line) => line.length > 1);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function getWorker(lang = 'ara', onProgress) {
  if (workers.has(lang)) return workers.get(lang);
  const promise = (async () => {
    const module = await import(`${VENDOR}/tesseract.esm.min.js`);
    const api = module.default || module;
    const worker = await api.createWorker(lang, 1, {
      workerPath: `${VENDOR}/worker.min.js`,
      corePath: `${VENDOR}/`,
      langPath: `${VENDOR}/lang`,
      workerBlobURL: false,
      logger: (event) => {
        if (event?.status && onProgress) onProgress(event);
      },
    });
    try {
      await worker.setParameters({ preserve_interword_spaces: '1' });
    } catch {
      /* اختياري حسب إصدار المحرك */
    }
    return worker;
  })().catch((error) => {
    workers.delete(lang);
    throw error;
  });
  workers.set(lang, promise);
  return promise;
}

/**
 * @param {HTMLImageElement|string} source صورة الصفحة
 * @param {{key?: string, onProgress?: Function}} options
 * @returns {Promise<{text: string, confidence: number, cached?: boolean}>}
 */
export async function ocrImage(source, { key = '', onProgress } = {}) {
  const dataUrl = await imageToDataUrl(source);
  if (!dataUrl) return { text: '', confidence: 0 };
  const cacheKey = key || `${dataUrl.length}:${dataUrl.slice(-64)}`;
  if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };

  // قارئان: عربي + إنجليزي على نفس الصورة. الإنجليزي لا يُعرض للقارئ،
  // بل يُستخدم كإشارة ثانية للأرقام/المصطلحات في مرحلة التصحيح.
  const [arWorker, enWorker] = await Promise.all([
    getWorker('ara', onProgress),
    getWorker('eng').catch(() => null),
  ]);
  const [arResult, enResult] = await Promise.all([
    arWorker.recognize(dataUrl),
    enWorker ? enWorker.recognize(dataUrl).catch(() => null) : Promise.resolve(null),
  ]);
  const result = {
    text: repairOcrText(cleanOcrText(arResult?.data?.text)),
    englishText: cleanOcrText(enResult?.data?.text),
    confidence: Number(arResult?.data?.confidence) || 0,
    englishConfidence: Number(enResult?.data?.confidence) || 0,
    bilingual: Boolean(enWorker),
  };
  cache.set(cacheKey, result);
  return result;
}

export function clearOcrCache() {
  cache.clear();
}

export async function terminateOcr() {
  const list = [...workers.values()];
  workers.clear();
  await Promise.all(
    list.map(async (promise) => {
      try {
        const worker = await promise;
        await worker.terminate();
      } catch {
        /* ignore */
      }
    })
  );
}

/**
 * اختبارات «خلية الجودة» ودمج النماذج — بلا شبكة ولا مزوّدات.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, chooseBest, fuseCandidates } from '../server/features/books/assistant/quality.js';
import { normalizePageBriefs } from '../server/features/books/assistant/shape.js';
import { extractFacts } from '../server/features/books/assistant/facts.js';
import { runLocal } from '../server/features/books/assistant/local.js';
import { correctOcrText } from '../server/features/books/assistant/ocr-fix.js';
import { repairOcrText } from '../public/features/books/ocr-text.js';

test('الخلاصة المشوّهة تُرفض ولا تُعرض', () => {
  const score = scoreCandidate(
    { summary: 'الفكرةههههههه مكررة وحروفها تالفة تمامًا ولا تصلح للعرض أبدًا.' },
    { task: 'summary', keywords: [] }
  );
  assert.ok(score < -100);
});

test('الخلاصة الواضحة تتفوق على مقدمة قصيرة عامة', () => {
  const keywords = ['الفهم', 'القراءة'];
  const good = {
    summary: 'الفهم العميق يعني ربط الفكرة الجديدة بالمعرفة السابقة. القراءة النشطة والتلخيص يثبتان الفهم في الذاكرة.',
    keywords,
  };
  const thin = { summary: 'هذه الصفحة تتحدث عن الفهم.', keywords: [] };
  const best = chooseBest([{ parsed: thin }, { parsed: good }], {
    task: 'summary',
    keywords,
    pageText: 'الفهم العميق يعني ربط الفكرة الجديدة بالمعرفة السابقة. القراءة النشطة والتلخيص يثبتان الفهم في الذاكرة.',
  });
  assert.equal(best.parsed, good);
});

test('دمج النماذج يجمع الفائدة ويزيل تكرار الكلمات والنقاط', () => {
  const best = {
    parsed: {
      summary: 'خلاصة واضحة للصفحة.',
      keywords: ['الفهم'],
      points: ['نقطة أولى'],
      followUps: ['سؤال أول'],
    },
  };
  const other = {
    parsed: {
      keywords: ['الفهم', 'القراءة'],
      points: ['نقطة أولى', 'نقطة ثانية'],
      followUps: ['سؤال أول', 'سؤال ثانٍ'],
    },
  };
  const fused = fuseCandidates(best, [other]);
  assert.deepEqual(fused.parsed.keywords, ['الفهم', 'القراءة']);
  assert.deepEqual(fused.parsed.points, ['نقطة أولى', 'نقطة ثانية']);
  assert.equal(fused.parsed.followUps.length, 2);
});

test('ملخصات الصفحات تُنظّف من تكرار نفس رقم الصفحة', () => {
  const out = normalizePageBriefs([
    { page: '1', text: 'الخلاصة الأولى للصفحة.' },
    { page: '1', text: 'الخلاصة نفسها مكررة.' },
    { page: '2', text: 'خلاصة الصفحة الثانية.' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].page, '2');
});

test('يستخرج العدد من جملة «وعددها ٦»', () => {
  const facts = extractFacts('الأشياء الاحتكارية هي الأشياء التي تحتكر السوق وتمنع المنافسة. وعددها 6 أنواع مختلفة.');
  assert.equal(facts[0]?.value, '6');
  assert.match(facts[0]?.text || '', /وعددها 6/);
});

test('الملخص المحلي لا يكتفي بالتعريف ويضم العدد', () => {
  const text = 'الأشياء الاحتكارية هي الأشياء التي تحتكر السوق وتمنع المنافسة. وعددها 6 أنواع: الاحتكار الكامل، واحتكار القلة، والاحتكار الطبيعي، واحتكار الشراء، والاحتكار القانوني، واحتكار القطاع العام.';
  const result = runLocal({ task: 'summary', pageText: text, pageNumbers: [4] });
  assert.match(result.summary, /6/);
  assert.equal(result.facts?.[0]?.value, '6');
  assert.ok(result.summary.indexOf('الأشياء الاحتكارية') < result.summary.indexOf('وعددها'));
});

test('تصحيح OCR المحلي يصلح المسافات والحروف المقطوعة', () => {
  const raw = 'حتى لو لميكن الجمهور يفهمهاء لخلق انطباع بأنك خبيرومثقف. المعرفةالحقيقية.';
  const fixed = repairOcrText(raw);
  assert.match(fixed, /لم يكن/);
  assert.match(fixed, /يفهمها/);
  assert.match(fixed, /خبير ومثقف/);
  assert.match(fixed, /المعرفة الحقيقية/);
});

test('تصحيح OCR يرجع نصًا محليًا سليمًا عند غياب النماذج', async () => {
  const result = await correctOcrText({
    configs: [],
    arabicText: 'المتلاعب يستخدم هذه المصطلحات لإبهارنا وإرياكناء وإخفاء افتقاره إلى المعرفةالحقيقية.',
    englishText: '',
  });
  assert.equal(result.corrected, false);
  assert.match(result.text, /وإرباكنا/);
  assert.match(result.text, /المعرفة الحقيقية/);
});

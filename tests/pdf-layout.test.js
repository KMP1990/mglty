/**
 * ترتيب نصوص PDF: الصفحات ذات العمودين كانت تدمج العمودين في سطر واحد،
 * فيخرج النص مشوّشًا. نحمي إعادة بناء الأعمدة باختبار مباشر.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capLongChapters, linesFromPdfItems } from '../public/features/books/parse.js';

const item = (str, x, y, width = 90) => ({ str, width, transform: [1, 0, 0, 12, x, y] });

test('يقرأ العمود الأيمن كاملًا قبل الأيسر في الصفحة العربية', () => {
  const items = [];
  for (let i = 0; i < 3; i += 1) {
    items.push(item(`يمين ${i + 1}`, 400, 700 - i * 20));
    items.push(item(`يسار ${i + 1}`, 100, 700 - i * 20));
  }
  const lines = linesFromPdfItems(items, 600);
  assert.deepEqual(
    lines.map((line) => line.text),
    ['يمين 1', 'يمين 2', 'يمين 3', 'يسار 1', 'يسار 2', 'يسار 3']
  );
});

test('يحافظ على ترتيب الأسطر في صفحة عمود واحد', () => {
  const items = [
    item('السطر الأول', 80, 700),
    item('السطر الثاني', 80, 680),
    item('السطر الثالث', 80, 660),
  ];
  const lines = linesFromPdfItems(items, 600);
  assert.deepEqual(
    lines.map((line) => line.text),
    ['السطر الأول', 'السطر الثاني', 'السطر الثالث']
  );
});

test('يعيد الكلمات إذا خزّن PDF الحروف داخل العنصر بترتيب بصري', () => {
  const visual = (word) => Array.from(word).reverse().join('');
  const items = [];
  let x = 60;
  for (const word of ['الإباحية', 'تأثير', 'تحت', 'دماغك']) {
    const chunk = visual(word);
    items.push({ str: chunk, width: chunk.length * 10, transform: [1, 0, 0, 18, x, 700] });
    x += chunk.length * 10 + 10;
  }
  const lines = linesFromPdfItems(items, 600);
  assert.deepEqual(lines.map((line) => line.text), ['دماغك تحت تأثير الإباحية']);
});

test('يصلح السطر الذي يخلط كلمة منطقية ومقاطع بصرية', () => {
  const visual = (word) => Array.from(word).reverse().join('');
  const items = [];
  let x = 60;
  for (const word of ['الإباحية', 'تأثير', 'تحت']) {
    const chunk = visual(word);
    items.push({ str: chunk, width: chunk.length * 10, transform: [1, 0, 0, 18, x, 700] });
    x += chunk.length * 10 + 10;
  }
  items.push({ str: 'دماغك', width: 50, transform: [1, 0, 0, 18, x, 700] });
  const lines = linesFromPdfItems(items, 600);
  assert.deepEqual(lines.map((line) => line.text), ['دماغك تحت تأثير الإباحية']);
});

test('يصلح سطرًا مختلطًا عربي وإنجليزي مخزّنًا بصريًا', () => {
  // "نص عربي مع English word" مخزّن بصريًا: الكلمات معكوسة والإنجليزية معكوسة أيضًا
  const visual = (word) => Array.from(word).reverse().join('');
  const items = [];
  let x = 60;
  for (const word of ['عربي', 'نص', 'word', 'English', 'مع']) {
    const chunk = visual(word);
    items.push({ str: chunk, width: chunk.length * 10, transform: [1, 0, 0, 18, x, 700] });
    x += chunk.length * 10 + 10;
  }
  const lines = linesFromPdfItems(items, 600);
  const text = lines.map((line) => line.text).join(' ');
  // الكلمة الإنجليزية تبقى مقروءة وبنفس ترتيب كلماتها
  assert.match(text, /English\s+word/);
  assert.doesNotMatch(text, /hsilgnE/);
});

test('يعرض الكلمة الإنجليزية داخل سطر عربي سليم دون قلبها', () => {
  const items = [
    item('هذا نص', 300, 700),
    item('mixed', 200, 700, 50),
    item('مع عربي', 80, 700),
  ];
  const lines = linesFromPdfItems(items, 600);
  const text = lines.map((line) => line.text).join(' ');
  assert.match(text, /mixed/);
});

test('يضم الحرف المفصول بعرض صفر إلى كلمته بدل سطر مستقل', () => {
  // نمط Word: «النفس» ثم «ي» كعنصر بعرض صفر على خط أساس أعلى قليلًا.
  const items = [
    { str: 'النفس', width: 60, transform: [1, 0, 0, 14, 200, 700] },
    { str: 'ي', width: 0, transform: [1, 0, 0, 14, 198, 704] },
  ];
  const lines = linesFromPdfItems(items, 600);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'النفسي');
});

test('لا يضيف مسافة بين التشكيلة وحرفها المفصول', () => {
  const items = [
    { str: 'قد يبدو الخوض ف', width: 100, transform: [1, 0, 0, 14, 300, 700] },
    { str: 'ي', width: 0, transform: [1, 0, 0, 14, 301, 704] },
    { str: ' ', width: 10, transform: [1, 0, 0, 14, 285, 700] },
    { str: 'الواقع', width: 60, transform: [1, 0, 0, 14, 200, 700] },
  ];
  const lines = linesFromPdfItems(items, 600);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'قد يبدو الخوض في الواقع');
});

test('يردّ تركيبات لام–ألف المعكوسة التي تنتجها خطوط Word', () => {
  const items = [
    { str: 'األساس', width: 60, transform: [1, 0, 0, 14, 300, 700] },
    { str: 'اإلنسانية', width: 70, transform: [1, 0, 0, 14, 200, 700] },
    { str: 'عىل', width: 30, transform: [1, 0, 0, 14, 150, 700] },
  ];
  const lines = linesFromPdfItems(items, 600);
  assert.equal(lines[0].text, 'الأساس الإنسانية على');
});

test('لا يقسّم فصلًا مليئًا بصور الصفحات إلى فصول وهمية', () => {
  const image = `<figure><img src="data:image/jpeg;base64,${'A'.repeat(200000)}" alt="صفحة"></figure>`;
  const parts = capLongChapters([{ title: 'الصفحات ١–٦', html: image.repeat(6) }], 5000);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].title, 'الصفحات ١–٦');
});

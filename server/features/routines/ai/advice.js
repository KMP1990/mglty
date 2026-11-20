/**
 * صياغة النصائح (ميزة فرعية داخل ai).
 * قواعد سلوكية مبنية على الاكتشافات + طبقة اختيارية لمزوّد LLM.
 */
import { askLlm } from '../../../shared/llm.js';

const TIPS = {
  startSmall: {
    id: 'start-small',
    kind: 'build',
    title: 'ابدأ بخطوة أصغر',
    body: 'أصعب جزء في الروتين هو بدايته. قلّل أول خطوة حتى تصبح سخيفة السهولة (صفحة واحدة، 30 ثانية تمدد) — الإنجاز يبني الاستمرار.',
  },
  noRoutines: {
    id: 'no-routines',
    kind: 'build',
    title: 'أنشئ روتينًا واحدًا فقط',
    body: 'البداية بروتين واحد يسهل تكراره هكذا: فعل بسيط + وقت ثابت. أضف «قراءة صفحة بعد القهوة» مثلاً.',
  },
  morning: {
    id: 'morning-anchor',
    kind: 'structure',
    title: 'اربط الروتين بعادة موجودة',
    body: 'ربط الروتين بعادة تفعلها أصلًا (بعد القهوة، بعد الوضوء، قبل النوم) يرفع الالتزام أكثر من ربطه بوقت محدد.',
  },
  overload: {
    id: 'overload',
    kind: 'structure',
    title: 'خفّف جدول اليوم',
    body: 'عدد الروتينات المجدولة اليوم كبير. اختر ثلاثًا فقط تصنع فرقًا، وأجّل الباقي — الالتزام أهم من الكمية.',
  },
  weakTime: {
    id: 'move-time',
    kind: 'timing',
    title: 'انقل هذا الروتين لنافذة أقوى',
    body: 'نسب إنجاز هذا الروتين منخفضة في وقته الحالي. جرّبه في النافذة التي تنجح فيها أكثر.',
  },
  late: {
    id: 'late',
    kind: 'reminder',
    title: 'خصّص تذكيرًا قبل الموعد',
    body: 'الروتين الذي يمرّ وقته بلا إشعار يفوت غالبًا. اضبط تذكيره قبل عشر دقائق ليكون حاضرًا ذهنك.',
  },
  streak: {
    id: 'protect-streak',
    kind: 'motivation',
    title: 'احمِ سلسلتك',
    body: 'السلسلة احتكاكها كيميائي أكثر منها عدديًا: الحفاظ عليها يجعل اليوم المتعب مجرد خطوة صغيرة.',
  },
  rest: {
    id: 'rest-day',
    kind: 'rest',
    title: 'افترض يوم راحة مجدولًا',
    body: 'يوم بلا روتينات مجدولة لا يكسر سلسلتك — لكن الأفضل أن تخطط له مسبقًا بدل أن تشعر بالتقصير.',
  },
  energy: {
    id: 'energy-base',
    kind: 'balance',
    title: 'أضف روتين طاقة',
    body: 'لا روتين ماء/حركة/نوم في قائمتك. تكلفة الطاقة المنخفضة لا تظهر كأمر واضح، لكنها تُسقط كل الروتينات الأخرى.',
  },
  evening: {
    id: 'evening-review',
    kind: 'reflection',
    title: 'مراجعة ليلية قصيرة',
    body: 'دقيقة واحدة قبل النوم: ماذا نجح؟ ما نحتاج تبسيطه غدًا؟ المراجعة تحوّل التكرار إلى عادة واعية.',
  },
};

export function buildAdvice({ insights, plan, routines }) {
  const out = [];
  const push = (tip) => {
    if (!tip || out.some((t) => t.id === tip.id)) return;
    out.push({ ...tip, severity: out.length === 0 ? 'primary' : 'secondary' });
  };

  if (insights.signals.noRoutines) push(TIPS.noRoutines);
  if (insights.today.total === 0 && !insights.signals.noRoutines) push(TIPS.rest);
  if (insights.today.total > 7) push(TIPS.overload);
  if (insights.streak >= 3) push(TIPS.streak);
  if (insights.needed?.energy === 'missing' && routines.length > 0) push(TIPS.energy);

  const weakest = insights.weakest.find((r) => r.scheduled >= 2 && r.rate < 60);
  if (weakest) {
    push({
      ...TIPS.weakTime,
      body: `«${weakest.title}» أُنجز ${weakest.rate}% من المرات. جرّب تبسيط الخطوة الأولى أو نقل وقته إلى فترة نجاحك.`,
      routineId: weakest.id,
    });
  }

  const lateBlock = plan.blocks.find((b) => b.flag === 'late');
  if (lateBlock) push({ ...TIPS.late, routineId: lateBlock.id, body: TIPS.late.body });

  if (routines.length > 0 && !routines.some((r) => r.time)) push(TIPS.morning);
  if (insights.weakestDay && insights.weakestDay.scheduled >= 3 && insights.weakestDay.rate < 40) {
    push({
      id: 'weak-day',
      kind: 'structure',
      title: 'يوم ضعيف في الأسبوع',
      body: 'نسبة إنجازك في أحد أيام الأسبوع أقل بوضوح. حدّد ذلك اليوم كنهج أخف أو اجعله يوم راحة مقصود.',
    });
  }
  push(TIPS.startSmall);

  return out.slice(0, 5).map((t, index) => ({ ...t, order: index + 1 }));
}

/**
 * طبقة LLM اختيارية — تُعيد نصًّا عربيًا قصيرًا أو null عند أي فشل.
 * لا تعتمد عليها الوظائف الأساسية أبدًا.
 */
export async function askModel(llm, facts, logger) {
  const prompt = [
    'أنت مدرب روتين محترم وموجز. اكتب نصيحتين بالعربية الفصحى المبسطة، كل واحدة في سطر مستقل، بلا مقدمات ولا عناوين.',
    'اعتمد على الأرقام التالية ولا تخترع أرقامًا جديدة:',
    JSON.stringify(facts, null, 0),
  ].join('\n');

  return askLlm(llm, {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 220,
    timeoutMs: 12_000,
    logger,
  });
}

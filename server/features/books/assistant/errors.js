/**
 * أخطاء النماذج — تُسجَّل للمطوّر ولا تُعرض كرسالة مخيفة للقارئ.
 */
export function failureCode(error) {
  return error?.code || 'failed';
}

export function failureSummary(failures = []) {
  const counts = {};
  for (const failure of failures) {
    const code = failureCode(failure);
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

/**
 * رسالة عامة لا تطلب مفتاحًا ولا تفضح مزوّدًا.
 * null = لا نعرض أي تحذير، الملخص المحلي يكفي.
 */
export function publicNotice() {
  return null;
}

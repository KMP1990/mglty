const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const NAME_RE = /^[\p{L}\p{M}\p{N} _.\-']{2,40}$/u;
export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'iloveyou',
  'admin123', 'welcome1', 'abc12345', 'letmein1', '11111111', '00000000', 'majalati', 'routinee', '123123123',
]);

export const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase().normalize('NFKC');

export function validateEmail(email) {
  if (!email) return 'البريد الإلكتروني مطلوب';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'صيغة البريد الإلكتروني غير صحيحة';
  return null;
}

export function validateName(name) {
  if (!name) return 'الاسم مطلوب';
  if (name.length < 2) return 'الاسم قصير جدًا (حرفان على الأقل)';
  if (name.length > 40) return 'الاسم طويل جدًا (40 حرفًا كحد أقصى)';
  if (!NAME_RE.test(name)) return 'الاسم يحتوي على رموز غير مسموحة';
  if (!/[\p{L}]/u.test(name)) return 'اكتب حرفًا واحدًا على الأقل';
  return null;
}

export function passwordChecks(password) {
  const p = String(password ?? '');
  const checks = {
    length: p.length >= 8,
    long: p.length >= 12,
    lower: /[a-z]/.test(p),
    upper: /[A-Z]/.test(p),
    digit: /\d/.test(p),
    symbol: /[^A-Za-z0-9\s]/.test(p),
    noSpaces: p.length > 0 && !/\s/.test(p),
    notCommon: p.length > 0 && !COMMON_PASSWORDS.has(p.toLowerCase()),
  };
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 12) score += 1;
  score += [checks.lower, checks.upper, checks.digit, checks.symbol].filter(Boolean).length >= 2 ? 1 : 0;
  score += [checks.lower, checks.upper, checks.digit, checks.symbol].filter(Boolean).length >= 3 ? 1 : 0;
  if (!checks.notCommon) score = 0;
  return { checks, score: Math.min(4, score) };
}

/** سياسة كلمة المرور: 8 حروف على الأقل + ليست شائعة + بلا فراغات */
export function validatePassword(password) {
  const p = String(password ?? '');
  if (!p) return 'كلمة المرور مطلوبة';
  if (p.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
  if (p.length > 128) return 'كلمة المرور طويلة جدًا (128 حرفًا كحد أقصى)';
  if (/\s/.test(p)) return 'لا يمكن استخدام المسافات في كلمة المرور';
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return 'كلمة المرور شائعة جدًا، اختر كلمة أقوى';
  return null;
}

export function validateSignup(body) {
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  const errors = {};
  const nameErr = validateName(name);
  const emailErr = validateEmail(email);
  const passErr = validatePassword(password);
  if (nameErr) errors.name = nameErr;
  if (emailErr) errors.email = emailErr;
  if (passErr) errors.password = passErr;
  if (body.acceptTerms !== true && body.acceptTerms !== 'on') errors.acceptTerms = 'يجب الموافقة على الشروط';
  return { errors, value: { name, email, password } };
}

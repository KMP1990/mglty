/**
 * طبقة قراءة/كتابة مركز القيادة.
 * تحوّل state.mega القديم أو الغائب إلى بنية كاملة، ثم تحسب الحزمة التحليلية.
 */
import { buildGoals, buildMega } from './analytics.js';
import { localDate } from '../schedule.js';

export function defaultMega() {
  return {
    version: 1,
    goals: [],
    journal: [],
    moods: {},
    focus: [],
    reviews: [],
    challenges: {},
    badges: {},
    templates: [],
    claimedPoints: 0,
    settings: {
      weekStart: 'sun',
      dayStart: '07:00',
      dayEnd: '23:00',
      dailyBudget: 120,
      autoBalance: true,
      gentleMode: true,
      identity: '',
      celebration: '',
      environment: '',
      focusMinutes: 25,
      reviewDay: 'sun',
      vacationUntil: null,
    },
  };
}

export function normalizeMega(state) {
  const base = defaultMega();
  const current = state?.mega && typeof state.mega === 'object' ? state.mega : {};
  return {
    ...base,
    ...current,
    goals: Array.isArray(current.goals) ? current.goals.slice(0, 30) : [],
    journal: Array.isArray(current.journal) ? current.journal.slice(-200) : [],
    moods: current.moods && typeof current.moods === 'object' ? current.moods : {},
    focus: Array.isArray(current.focus) ? current.focus.slice(-200) : [],
    reviews: Array.isArray(current.reviews) ? current.reviews.slice(-100) : [],
    challenges: current.challenges && typeof current.challenges === 'object' ? current.challenges : {},
    badges: current.badges && typeof current.badges === 'object' ? current.badges : {},
    templates: Array.isArray(current.templates) ? current.templates.slice(0, 30) : [],
    claimedPoints: Math.max(0, Number(current.claimedPoints) || 0),
    settings: { ...base.settings, ...(current.settings && typeof current.settings === 'object' ? current.settings : {}) },
  };
}

function applyGoalBadge(board, goals) {
  const completed = goals.filter((goal) => goal.complete).length;
  board.badges = board.badges.map((badge) =>
    badge.id === 'goal-getter'
      ? { ...badge, earned: completed > 0, progress: Math.min(100, completed * 100) }
      : badge
  );
  const earned = board.badges.filter((badge) => badge.earned);
  board.summary.earnedBadges = earned.length;
  board.summary.points += completed * 40;
  return board;
}

/** قراءة موحّدة: يحسب، يزامن الشارات المكتسبة، ويكتب فقط عند تغيّر الشارات. */
export async function loadMega(store, userId, now = Date.now()) {
  const state = await store.read(userId);
  const mega = normalizeMega(state);
  state.mega = mega;
  const timeZone = state.settings.timeZone || 'Asia/Riyadh';
  const today = localDate(now, timeZone);
  const routines = state.routines || [];
  const board = buildMega({ state, routines, logs: state.logs || {}, timeZone, today, now });
  const goals = buildGoals(mega.goals, { ...board, journal: mega.journal, focus: mega.focus, reviews: mega.reviews });
  board.goals = goals;
  applyGoalBadge(board, goals);

  const claimed = Object.values(mega.challenges).filter((item) => item?.claimedAt).length;
  if (claimed) {
    board.summary.points += claimed * 100;
    mega.claimedPoints = claimed * 100;
  }

  let changed = false;
  for (const badge of board.badges) {
    if (badge.earned && !mega.badges[badge.id]) {
      mega.badges[badge.id] = new Date(now).toISOString();
      changed = true;
    }
  }
  // نحفظ أيضًا الأهداف المكتملة كي لا تبقى بلا تاريخ إتمام.
  const completedGoals = new Set(goals.filter((goal) => goal.complete).map((goal) => goal.id));
  mega.goals = mega.goals.map((goal) => {
    if (!completedGoals.has(goal.id) || goal.completedAt) return goal;
    changed = true;
    return { ...goal, completedAt: new Date(now).toISOString() };
  });
  if (changed) {
    state.mega = mega;
    await store.write(userId, state);
  }
  board.settings = mega.settings;
  board.badges = board.badges.map((badge) => ({ ...badge, earnedAt: mega.badges[badge.id] || null }));
  board.journal = [...mega.journal].reverse().slice(0, 20);
  board.focus = mega.focus.slice(-20).reverse();
  board.reviews = [...mega.reviews].reverse().slice(0, 12);
  board.moods = mega.moods;
  board.goals = goals;
  board.templates = mega.templates;
  board.catalogStats = null;
  return { state, mega, board, goals, timeZone, today };
}

/** حزمة مختصرة للواجهة الرئيسية — بلا حسابات ثقيلة على كل فتح. */
export function quickMegaSummary(board) {
  return {
    momentum: board.summary.momentum,
    points: board.summary.points,
    level: board.summary.level,
    streak: board.summary.streak,
    burnout: board.burnout,
    mission: board.mission,
    nextBestAction: board.nextBestAction,
  };
}

/**
 * GYMONIC — Gamification System
 * XP, levels, achievements, and daily challenges.
 */

const GAMIFICATION_KEY = 'gymonic_gamification';

// ─── XP Table ───────────────────────────────────────────────────────
const XP_PER_REP = 2;
const XP_PER_WORKOUT = 50;
const XP_FORM_BONUS_MULTIPLIER = 0.5; // Score/100 * multiplier * base XP
const XP_STREAK_BONUS = 25;           // Per streak day

// Level thresholds (XP needed to reach each level)
const LEVELS = [
  { level: 1,  title: 'Beginner',       xpNeeded: 0,     icon: '🌱' },
  { level: 2,  title: 'Starter',        xpNeeded: 100,   icon: '🏃' },
  { level: 3,  title: 'Learner',        xpNeeded: 300,   icon: '📖' },
  { level: 4,  title: 'Regular',        xpNeeded: 600,   icon: '💪' },
  { level: 5,  title: 'Dedicated',      xpNeeded: 1000,  icon: '🔥' },
  { level: 6,  title: 'Strong',         xpNeeded: 1500,  icon: '🏋️' },
  { level: 7,  title: 'Warrior',        xpNeeded: 2200,  icon: '⚔️' },
  { level: 8,  title: 'Elite',          xpNeeded: 3000,  icon: '🏆' },
  { level: 9,  title: 'Champion',       xpNeeded: 4000,  icon: '👑' },
  { level: 10, title: 'Legend',         xpNeeded: 5500,  icon: '🌟' },
  { level: 11, title: 'Titan',          xpNeeded: 7500,  icon: '⚡' },
  { level: 12, title: 'Mythic',         xpNeeded: 10000, icon: '🔮' },
];

// ─── Achievement Definitions ────────────────────────────────────────
const ACHIEVEMENTS = [
  // Workout count
  { id: 'first_workout',   name: 'First Step',          icon: '🎯', desc: 'Complete your first workout',            check: s => s.totalWorkouts >= 1 },
  { id: 'five_workouts',   name: 'Getting Started',     icon: '🏁', desc: 'Complete 5 workouts',                    check: s => s.totalWorkouts >= 5 },
  { id: 'ten_workouts',    name: 'Dedicated',           icon: '💎', desc: 'Complete 10 workouts',                   check: s => s.totalWorkouts >= 10 },
  { id: 'twenty_five',     name: 'Quarter Century',     icon: '🎖️', desc: 'Complete 25 workouts',                   check: s => s.totalWorkouts >= 25 },
  { id: 'fifty_workouts',  name: 'Half Century',        icon: '🏅', desc: 'Complete 50 workouts',                   check: s => s.totalWorkouts >= 50 },

  // Streak
  { id: 'streak_3',        name: 'Hat Trick',           icon: '🔥', desc: '3-day workout streak',                   check: s => s.streak >= 3 },
  { id: 'streak_7',        name: 'Full Week',           icon: '📅', desc: '7-day workout streak',                   check: s => s.streak >= 7 },
  { id: 'streak_14',       name: 'Two Weeks Strong',    icon: '💪', desc: '14-day workout streak',                  check: s => s.streak >= 14 },
  { id: 'streak_30',       name: 'Monthly Warrior',     icon: '⚔️', desc: '30-day workout streak',                  check: s => s.streak >= 30 },

  // Form score
  { id: 'score_80',        name: 'Good Form',           icon: '✅', desc: 'Achieve 80+ average form score',         check: s => s.bestScore >= 80 },
  { id: 'score_90',        name: 'Perfect Form',        icon: '🌟', desc: 'Achieve 90+ average form score',         check: s => s.bestScore >= 90 },
  { id: 'score_95',        name: 'Flawless',            icon: '💯', desc: 'Achieve 95+ average form score',         check: s => s.bestScore >= 95 },

  // Reps
  { id: 'reps_100',        name: 'Century',             icon: '💯', desc: 'Complete 100 total reps',                check: s => s.totalReps >= 100 },
  { id: 'reps_500',        name: 'Half K',              icon: '🔢', desc: 'Complete 500 total reps',                check: s => s.totalReps >= 500 },
  { id: 'reps_1000',       name: 'Thousand Club',       icon: '🏆', desc: 'Complete 1,000 total reps',              check: s => s.totalReps >= 1000 },

  // Body parts
  { id: 'all_parts',       name: 'Full Body',           icon: '🧬', desc: 'Train all 6 body parts at least once',   check: s => s.uniqueBodyParts >= 6 },

  // XP levels
  { id: 'level_5',         name: 'Leveling Up',         icon: '⬆️', desc: 'Reach Level 5',                         check: s => s.level >= 5 },
  { id: 'level_10',        name: 'Double Digits',       icon: '🔟', desc: 'Reach Level 10',                        check: s => s.level >= 10 },
];

// ─── Daily Challenges ───────────────────────────────────────────────
const DAILY_CHALLENGES = [
  { id: 'reps_50',       name: 'Rep Machine',       desc: 'Complete 50 reps today',         target: 50,  type: 'reps',     xpReward: 30 },
  { id: 'reps_100',      name: 'Century Crusher',   desc: 'Complete 100 reps today',        target: 100, type: 'reps',     xpReward: 60 },
  { id: 'score_85',      name: 'Form Focus',        desc: 'Average 85+ form score',         target: 85,  type: 'score',    xpReward: 40 },
  { id: 'workout_2',     name: 'Double Session',    desc: 'Complete 2 workouts today',      target: 2,   type: 'workouts', xpReward: 50 },
  { id: 'minutes_20',    name: 'Endurance Test',    desc: 'Workout for 20+ minutes total',  target: 20,  type: 'minutes',  xpReward: 35 },
  { id: 'exercises_5',   name: 'Variety Pack',      desc: 'Do 5 different exercises',       target: 5,   type: 'exercises', xpReward: 40 },
];

export class GamificationSystem {
  constructor(progressTracker) {
    this.pt = progressTracker;
    this.data = this._load();
  }

  // ─── XP & Levels ──────────────────────────────────────────────────
  addWorkoutXP(totalReps, avgScore, streak) {
    let xp = XP_PER_WORKOUT;
    xp += totalReps * XP_PER_REP;
    if (avgScore) xp += Math.round(avgScore * XP_FORM_BONUS_MULTIPLIER);
    if (streak > 1) xp += Math.min(streak, 30) * XP_STREAK_BONUS;

    const oldLevel = this.getLevel();
    this.data.totalXP += xp;
    this.data.lastXPGain = xp;
    const newLevel = this.getLevel();

    if (newLevel.level > oldLevel.level) {
      this.data.levelUpPending = true;
      this.data.newLevel = newLevel;
    }

    this._save();
    return { xpGained: xp, oldLevel, newLevel, leveledUp: newLevel.level > oldLevel.level };
  }

  getTotalXP() { return this.data.totalXP; }

  getLevel() {
    let current = LEVELS[0];
    for (const level of LEVELS) {
      if (this.data.totalXP >= level.xpNeeded) current = level;
      else break;
    }
    return current;
  }

  getNextLevel() {
    const current = this.getLevel();
    return LEVELS.find(l => l.level === current.level + 1) || null;
  }

  getLevelProgress() {
    const current = this.getLevel();
    const next = this.getNextLevel();
    if (!next) return { percent: 100, xpInLevel: 0, xpNeeded: 0 };

    const xpInLevel = this.data.totalXP - current.xpNeeded;
    const xpNeeded = next.xpNeeded - current.xpNeeded;
    return {
      percent: Math.round((xpInLevel / xpNeeded) * 100),
      xpInLevel,
      xpNeeded,
    };
  }

  consumeLevelUp() {
    if (this.data.levelUpPending) {
      this.data.levelUpPending = false;
      const level = this.data.newLevel;
      this.data.newLevel = null;
      this._save();
      return level;
    }
    return null;
  }

  // ─── Achievements ─────────────────────────────────────────────────
  checkAchievements() {
    const stats = this._getCheckStats();
    const newlyUnlocked = [];

    for (const ach of ACHIEVEMENTS) {
      if (this.data.unlockedAchievements.includes(ach.id)) continue;
      if (ach.check(stats)) {
        this.data.unlockedAchievements.push(ach.id);
        newlyUnlocked.push(ach);
      }
    }

    if (newlyUnlocked.length > 0) this._save();
    return newlyUnlocked;
  }

  getAchievements() {
    const unlocked = new Set(this.data.unlockedAchievements);
    return ACHIEVEMENTS.map(ach => ({
      ...ach,
      unlocked: unlocked.has(ach.id),
    }));
  }

  getUnlockedCount() {
    return this.data.unlockedAchievements.length;
  }

  // ─── Daily Challenge ──────────────────────────────────────────────
  getDailyChallenge() {
    const today = new Date().toDateString();

    // Generate new challenge daily
    if (this.data.dailyChallenge?.date !== today) {
      const seed = new Date().getDate() + new Date().getMonth() * 31;
      const challenge = DAILY_CHALLENGES[seed % DAILY_CHALLENGES.length];
      this.data.dailyChallenge = { ...challenge, date: today, completed: false };
      this._save();
    }

    // Compute progress
    const challenge = this.data.dailyChallenge;
    const todaySessions = this.pt.getAllSessions().filter(s =>
      new Date(s.date).toDateString() === today
    );

    let current = 0;
    switch (challenge.type) {
      case 'reps':
        current = todaySessions.reduce((s, sess) => s + (sess.totalReps || 0), 0);
        break;
      case 'score':
        const scores = todaySessions.filter(s => s.avgScore).map(s => s.avgScore);
        current = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        break;
      case 'workouts':
        current = todaySessions.length;
        break;
      case 'minutes':
        current = Math.round(todaySessions.reduce((s, sess) => s + (sess.duration || 0), 0) / 60);
        break;
      case 'exercises':
        const exSet = new Set();
        todaySessions.forEach(s => (s.exercises || []).forEach(e => exSet.add(e.name)));
        current = exSet.size;
        break;
    }

    const completed = current >= challenge.target;
    if (completed && !challenge.completed) {
      challenge.completed = true;
      this.data.totalXP += challenge.xpReward;
      this.data.challengesCompleted = (this.data.challengesCompleted || 0) + 1;
      this._save();
    }

    return { ...challenge, current, progress: Math.min(100, Math.round((current / challenge.target) * 100)), completed };
  }

  // ─── Stats for Display ────────────────────────────────────────────
  getStats() {
    return {
      totalXP: this.data.totalXP,
      level: this.getLevel(),
      nextLevel: this.getNextLevel(),
      levelProgress: this.getLevelProgress(),
      achievementsUnlocked: this.getUnlockedCount(),
      achievementsTotal: ACHIEVEMENTS.length,
      challengesCompleted: this.data.challengesCompleted || 0,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────
  _getCheckStats() {
    const pb = this.pt.getPersonalBests();
    const freq = this.pt.getBodyPartFrequency();
    return {
      totalWorkouts: this.pt.getTotalWorkouts(),
      totalReps: this.pt.getTotalRepsAllTime(),
      streak: this.pt.getCurrentStreak(),
      bestScore: pb.bestScore || 0,
      level: this.getLevel().level,
      uniqueBodyParts: Object.keys(freq).length,
    };
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(GAMIFICATION_KEY) || 'null') || {
        totalXP: 0,
        unlockedAchievements: [],
        dailyChallenge: null,
        challengesCompleted: 0,
        levelUpPending: false,
        newLevel: null,
        lastXPGain: 0,
      };
    } catch {
      return { totalXP: 0, unlockedAchievements: [], dailyChallenge: null, challengesCompleted: 0, levelUpPending: false, newLevel: null, lastXPGain: 0 };
    }
  }

  _save() {
    localStorage.setItem(GAMIFICATION_KEY, JSON.stringify(this.data));
  }
}

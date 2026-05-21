/**
 * GYMONIC — Progress Tracker (localStorage)
 * Saves workout sessions, provides history & stats.
 */

const STORAGE_KEY = 'gymonic_sessions';
const STREAK_KEY = 'gymonic_streak';

// ─── Session Data Model ─────────────────────────────────────────────
/**
 * Session object shape:
 * {
 *   id: string,
 *   date: string (ISO),
 *   duration: number (seconds),
 *   bodyParts: string[],
 *   exercises: [{ name, sets, reps, fsmId, hasAI }],
 *   totalReps: number,
 *   avgScore: number | null,
 *   repScores: number[],
 *   exercisesCompleted: number,
 * }
 */

export class ProgressTracker {
  constructor() {
    this._sessions = this._load();
  }

  // ─── Save Session ──────────────────────────────────────────────────
  saveSession(sessionData) {
    const session = {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: new Date().toISOString(),
      duration: sessionData.duration || 0,
      bodyParts: sessionData.bodyParts || [],
      exercises: (sessionData.exercises || []).map(e => ({
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        fsmId: e.fsmId || null,
        hasAI: e.hasAIValidation || false,
      })),
      totalReps: sessionData.totalReps || 0,
      avgScore: sessionData.avgScore || null,
      repScores: sessionData.repScores || [],
      exercisesCompleted: sessionData.exercisesCompleted || 0,
    };

    this._sessions.unshift(session); // newest first
    // Keep last 100 sessions
    if (this._sessions.length > 100) this._sessions = this._sessions.slice(0, 100);
    this._save();
    this._updateStreak();

    return session;
  }

  // ─── Getters ───────────────────────────────────────────────────────
  getAllSessions() {
    return [...this._sessions];
  }

  getRecentSessions(count = 7) {
    return this._sessions.slice(0, count);
  }

  getTotalWorkouts() {
    return this._sessions.length;
  }

  getTotalRepsAllTime() {
    return this._sessions.reduce((sum, s) => sum + (s.totalReps || 0), 0);
  }

  getTotalDurationMinutes() {
    const totalSec = this._sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    return Math.round(totalSec / 60);
  }

  getAvgScoreAllTime() {
    const scored = this._sessions.filter(s => s.avgScore !== null && s.avgScore > 0);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((sum, s) => sum + s.avgScore, 0) / scored.length);
  }

  // ─── Streak ────────────────────────────────────────────────────────
  getCurrentStreak() {
    const streak = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count":0,"lastDate":""}');
    return streak.count;
  }

  _updateStreak() {
    const streak = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count":0,"lastDate":""}');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    if (streak.lastDate === today) {
      // Already worked out today, streak unchanged
      return;
    }

    if (streak.lastDate === yesterday || streak.count === 0) {
      // Consecutive day → increment streak
      streak.count++;
    } else {
      // Streak broken → reset to 1
      streak.count = 1;
    }

    streak.lastDate = today;
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  }

  // ─── Weekly Stats ──────────────────────────────────────────────────
  getWeeklyStats() {
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const thisWeek = this._sessions.filter(s => new Date(s.date).getTime() > weekAgo);

    return {
      workouts: thisWeek.length,
      totalReps: thisWeek.reduce((sum, s) => sum + (s.totalReps || 0), 0),
      totalMinutes: Math.round(thisWeek.reduce((sum, s) => sum + (s.duration || 0), 0) / 60),
      avgScore: thisWeek.filter(s => s.avgScore).length > 0
        ? Math.round(thisWeek.filter(s => s.avgScore).reduce((sum, s) => sum + s.avgScore, 0) / thisWeek.filter(s => s.avgScore).length)
        : null,
      bodyParts: [...new Set(thisWeek.flatMap(s => s.bodyParts))],
    };
  }

  // ─── Body Part Frequency ──────────────────────────────────────────
  getBodyPartFrequency() {
    const freq = {};
    for (const session of this._sessions) {
      for (const bp of (session.bodyParts || [])) {
        freq[bp] = (freq[bp] || 0) + 1;
      }
    }
    return freq;
  }

  // ─── Personal Bests ───────────────────────────────────────────────
  getPersonalBests() {
    let bestScore = 0;
    let mostReps = 0;
    let longestSession = 0;

    for (const s of this._sessions) {
      if (s.avgScore && s.avgScore > bestScore) bestScore = s.avgScore;
      if (s.totalReps > mostReps) mostReps = s.totalReps;
      if (s.duration > longestSession) longestSession = s.duration;
    }

    return {
      bestScore: bestScore || null,
      mostReps: mostReps || null,
      longestSessionMin: longestSession ? Math.round(longestSession / 60) : null,
    };
  }

  // ─── Clear (for testing) ──────────────────────────────────────────
  clearAll() {
    this._sessions = [];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STREAK_KEY);
  }

  // ─── Persistence ──────────────────────────────────────────────────
  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._sessions));
    } catch (e) {
      console.warn('Failed to save progress:', e);
    }
  }
}

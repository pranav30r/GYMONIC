/**
 * GYMONIC — Goal System
 * Users set fitness goals, system tracks progress automatically.
 */

const GOALS_KEY = 'gymonic_goals';

// ─── Goal Types ─────────────────────────────────────────────────────
export const GOAL_TYPES = [
  {
    id: 'weekly_workouts',
    name: 'Weekly Workouts',
    icon: '📅',
    unit: 'workouts',
    period: 'week',
    defaults: [3, 4, 5, 6, 7],
    description: 'How many times per week you want to train',
  },
  {
    id: 'weekly_reps',
    name: 'Weekly Reps',
    icon: '🔁',
    unit: 'reps',
    period: 'week',
    defaults: [100, 200, 300, 500],
    description: 'Total reps target per week',
  },
  {
    id: 'form_score',
    name: 'Form Score',
    icon: '🎯',
    unit: 'score',
    period: 'ongoing',
    defaults: [70, 80, 85, 90],
    description: 'Maintain average form score above this',
  },
  {
    id: 'streak',
    name: 'Streak Days',
    icon: '🔥',
    unit: 'days',
    period: 'ongoing',
    defaults: [7, 14, 30, 60],
    description: 'Consecutive days working out',
  },
  {
    id: 'weekly_minutes',
    name: 'Weekly Minutes',
    icon: '⏱️',
    unit: 'minutes',
    period: 'week',
    defaults: [30, 60, 90, 120],
    description: 'Total workout time per week',
  },
];

export class GoalSystem {
  constructor(progressTracker) {
    this.progressTracker = progressTracker;
    this.goals = this._load();
  }

  // ─── CRUD ──────────────────────────────────────────────────────────
  addGoal(typeId, targetValue) {
    const type = GOAL_TYPES.find(t => t.id === typeId);
    if (!type) return null;

    // Remove existing goal of same type
    this.goals = this.goals.filter(g => g.typeId !== typeId);

    const goal = {
      id: `g_${Date.now()}`,
      typeId,
      targetValue,
      createdAt: new Date().toISOString(),
    };
    this.goals.push(goal);
    this._save();
    return goal;
  }

  removeGoal(typeId) {
    this.goals = this.goals.filter(g => g.typeId !== typeId);
    this._save();
  }

  getGoals() {
    return this.goals.map(g => ({
      ...g,
      type: GOAL_TYPES.find(t => t.id === g.typeId),
      ...this._computeProgress(g),
    }));
  }

  hasGoal(typeId) {
    return this.goals.some(g => g.typeId === typeId);
  }

  // ─── Progress Computation ─────────────────────────────────────────
  _computeProgress(goal) {
    const weekly = this.progressTracker.getWeeklyStats();
    const streak = this.progressTracker.getCurrentStreak();
    const avgScore = this.progressTracker.getAvgScoreAllTime();

    let current = 0;
    switch (goal.typeId) {
      case 'weekly_workouts':
        current = weekly.workouts;
        break;
      case 'weekly_reps':
        current = weekly.totalReps;
        break;
      case 'form_score':
        current = avgScore || 0;
        break;
      case 'streak':
        current = streak;
        break;
      case 'weekly_minutes':
        current = weekly.totalMinutes;
        break;
    }

    const progress = Math.min(100, Math.round((current / goal.targetValue) * 100));
    const isCompleted = current >= goal.targetValue;

    return { current, progress, isCompleted };
  }

  // ─── Persistence ──────────────────────────────────────────────────
  _load() {
    try {
      return JSON.parse(localStorage.getItem(GOALS_KEY) || '[]');
    } catch { return []; }
  }

  _save() {
    localStorage.setItem(GOALS_KEY, JSON.stringify(this.goals));
  }
}

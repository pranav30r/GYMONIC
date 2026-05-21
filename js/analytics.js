/**
 * GYMONIC — Analytics Engine
 * Computes trends, charts data, body part heatmaps from session history.
 */

export class AnalyticsEngine {
  constructor(progressTracker) {
    this.pt = progressTracker;
  }

  // ─── Score Trend (last N sessions) ────────────────────────────────
  getScoreTrend(count = 10) {
    const sessions = this.pt.getRecentSessions(count).reverse(); // oldest first
    return sessions.map(s => ({
      date: new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: s.avgScore || 0,
      reps: s.totalReps,
    }));
  }

  // ─── Weekly Volume (last 4 weeks) ─────────────────────────────────
  getWeeklyVolume() {
    const sessions = this.pt.getAllSessions();
    const weeks = [];
    const now = Date.now();

    for (let w = 0; w < 4; w++) {
      const weekStart = now - (w + 1) * 7 * 86400000;
      const weekEnd = now - w * 7 * 86400000;
      const weekSessions = sessions.filter(s => {
        const t = new Date(s.date).getTime();
        return t > weekStart && t <= weekEnd;
      });

      weeks.unshift({
        label: w === 0 ? 'This Week' : w === 1 ? 'Last Week' : `${w + 1}w ago`,
        workouts: weekSessions.length,
        reps: weekSessions.reduce((sum, s) => sum + (s.totalReps || 0), 0),
        minutes: Math.round(weekSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60),
      });
    }

    return weeks;
  }

  // ─── Body Part Distribution ───────────────────────────────────────
  getBodyPartDistribution() {
    const freq = this.pt.getBodyPartFrequency();
    const total = Object.values(freq).reduce((a, b) => a + b, 0) || 1;
    const parts = [
      { id: 'chest', name: 'Chest', color: '#FF6B6B' },
      { id: 'back', name: 'Back', color: '#4ECDC4' },
      { id: 'shoulders', name: 'Shoulders', color: '#45B7D1' },
      { id: 'arms', name: 'Arms', color: '#F7DC6F' },
      { id: 'legs', name: 'Legs', color: '#BB8FCE' },
      { id: 'core', name: 'Core', color: '#F0B27A' },
    ];

    return parts.map(p => ({
      ...p,
      count: freq[p.id] || 0,
      percent: Math.round(((freq[p.id] || 0) / total) * 100),
    }));
  }

  // ─── Exercise Performance ─────────────────────────────────────────
  getExerciseStats() {
    const sessions = this.pt.getAllSessions();
    const exerciseMap = {};

    for (const session of sessions) {
      for (const ex of (session.exercises || [])) {
        if (!exerciseMap[ex.name]) {
          exerciseMap[ex.name] = { name: ex.name, sessions: 0, hasAI: ex.hasAI };
        }
        exerciseMap[ex.name].sessions++;
      }
    }

    return Object.values(exerciseMap).sort((a, b) => b.sessions - a.sessions);
  }

  // ─── Consistency (days active in last 30 days) ────────────────────
  getConsistencyMap() {
    const sessions = this.pt.getAllSessions();
    const now = Date.now();
    const days = [];

    for (let d = 29; d >= 0; d--) {
      const dayStart = new Date(now - d * 86400000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      const active = sessions.some(s => {
        const t = new Date(s.date).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      });

      days.push({
        date: dayStart,
        day: dayStart.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0),
        active,
      });
    }

    return days;
  }

  // ─── Summary Stats ────────────────────────────────────────────────
  getSummaryStats() {
    return {
      totalWorkouts: this.pt.getTotalWorkouts(),
      totalReps: this.pt.getTotalRepsAllTime(),
      totalMinutes: this.pt.getTotalDurationMinutes(),
      avgScore: this.pt.getAvgScoreAllTime(),
      streak: this.pt.getCurrentStreak(),
      personalBests: this.pt.getPersonalBests(),
    };
  }
}

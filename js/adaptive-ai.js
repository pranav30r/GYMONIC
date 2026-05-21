/**
 * GYMONIC — Adaptive AI Workout Engine
 * Analyzes history and generates smart workout recommendations.
 */

export class AdaptiveAI {
  constructor(progressTracker) {
    this.pt = progressTracker;
  }

  /**
   * Generate a smart workout based on user history.
   * Prioritizes: neglected body parts, exercises with low scores, progressive overload.
   */
  generateSmartWorkout(allExercises, bodyParts) {
    const freq = this.pt.getBodyPartFrequency();
    const sessions = this.pt.getAllSessions();
    const totalWorkouts = sessions.length;

    // If no history, return balanced beginner workout
    if (totalWorkouts < 3) {
      return this._beginnerWorkout(allExercises);
    }

    // 1. Find neglected body parts
    const neglected = this._findNeglectedParts(freq, bodyParts);

    // 2. Find exercises needing form improvement
    const needsPractice = this._findWeakExercises(sessions);

    // 3. Build smart workout
    const workout = [];
    const used = new Set();

    // Add 1-2 exercises for neglected body parts
    for (const partId of neglected.slice(0, 2)) {
      const partExercises = allExercises.filter(e =>
        e.primaryMuscle === partId && !used.has(e.id)
      );
      // Prefer AI-validated
      const pick = partExercises.find(e => e.hasAIValidation) || partExercises[0];
      if (pick) {
        used.add(pick.id);
        workout.push({ ...pick, sets: pick.defaultSets, reps: pick.defaultReps, reason: `Train ${partId} — you haven't worked it recently` });
      }
    }

    // Add exercises that need form improvement (with AI)
    for (const exName of needsPractice.slice(0, 2)) {
      const ex = allExercises.find(e => e.name === exName && !used.has(e.id));
      if (ex) {
        used.add(ex.id);
        workout.push({ ...ex, sets: ex.defaultSets, reps: ex.defaultReps, reason: `Practice form — your score was low last time` });
      }
    }

    // Fill remaining with progressive overload
    const recentExercises = this._getRecentExercises(sessions);
    for (const exName of recentExercises) {
      if (workout.length >= 6) break;
      const ex = allExercises.find(e => e.name === exName && !used.has(e.id));
      if (ex) {
        used.add(ex.id);
        const overload = this._getProgressiveOverload(ex, sessions);
        workout.push({ ...ex, sets: overload.sets, reps: overload.reps, reason: overload.reason });
      }
    }

    // If still too few, add random AI exercises
    if (workout.length < 4) {
      const aiExercises = allExercises.filter(e => e.hasAIValidation && !used.has(e.id));
      for (const ex of aiExercises) {
        if (workout.length >= 5) break;
        used.add(ex.id);
        workout.push({ ...ex, sets: ex.defaultSets, reps: ex.defaultReps, reason: 'Balanced training' });
      }
    }

    return workout;
  }

  /**
   * Get a tip based on recent performance.
   */
  getDailyTip() {
    const sessions = this.pt.getRecentSessions(5);
    const streak = this.pt.getCurrentStreak();
    const tips = [];

    if (sessions.length === 0) {
      return { icon: '🚀', text: "Start your first workout today — every journey begins with rep one!" };
    }

    // Streak-based tips
    if (streak >= 7) {
      tips.push({ icon: '🔥', text: `${streak}-day streak! You're on fire. Don't break the chain!` });
    } else if (streak >= 3) {
      tips.push({ icon: '💪', text: `${streak} days strong. Keep pushing — consistency beats perfection!` });
    } else if (streak === 0) {
      tips.push({ icon: '⚡', text: "Get back on track today. One workout is all it takes!" });
    }

    // Score-based tips
    const recentScores = sessions.filter(s => s.avgScore).map(s => s.avgScore);
    if (recentScores.length > 0) {
      const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      if (avg >= 85) {
        tips.push({ icon: '🏆', text: `Average form score: ${Math.round(avg)}. Elite level — try increasing difficulty!` });
      } else if (avg >= 70) {
        tips.push({ icon: '📈', text: `Form score: ${Math.round(avg)}. Good foundation — focus on the corrections to hit 85+!` });
      } else {
        tips.push({ icon: '🎯', text: `Form score: ${Math.round(avg)}. Slow down each rep and focus on the AI feedback.` });
      }
    }

    // Body part balance
    const freq = this.pt.getBodyPartFrequency();
    const maxPart = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const minPart = Object.entries(freq).sort((a, b) => a[1] - b[1])[0];
    if (maxPart && minPart && maxPart[0] !== minPart[0]) {
      const diff = maxPart[1] - minPart[1];
      if (diff > 3) {
        tips.push({ icon: '⚖️', text: `You've trained ${maxPart[0]} ${maxPart[1]}x but ${minPart[0]} only ${minPart[1]}x. Add some ${minPart[0]} work today!` });
      }
    }

    // Bug fix #7: guard against empty tips array to prevent undefined.icon crash
    if (tips.length === 0) {
      return { icon: '💪', text: 'Stay consistent — every rep counts!' };
    }
    return tips[Math.floor(Math.random() * tips.length)];
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  _beginnerWorkout(allExercises) {
    const aiExercises = allExercises.filter(e => e.hasAIValidation && e.difficulty === 'beginner');
    return aiExercises.slice(0, 4).map(ex => ({
      ...ex, sets: 3, reps: 10, reason: 'Great exercise for beginners with AI form checking',
    }));
  }

  _findNeglectedParts(freq, bodyParts) {
    const allParts = bodyParts.map(bp => bp.id);
    const sorted = allParts.sort((a, b) => (freq[a] || 0) - (freq[b] || 0));
    return sorted.slice(0, 3); // Top 3 least trained
  }

  _findWeakExercises(sessions) {
    const exerciseScores = {};
    for (const s of sessions.slice(0, 10)) {
      if (!s.avgScore || s.avgScore >= 80) continue;
      for (const ex of (s.exercises || [])) {
        if (ex.hasAI) {
          if (!exerciseScores[ex.name] || exerciseScores[ex.name] > s.avgScore) {
            exerciseScores[ex.name] = s.avgScore;
          }
        }
      }
    }
    return Object.entries(exerciseScores)
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);
  }

  _getRecentExercises(sessions) {
    const recent = sessions.slice(0, 5);
    const names = new Set();
    for (const s of recent) {
      for (const ex of (s.exercises || [])) {
        names.add(ex.name);
      }
    }
    return [...names];
  }

  _getProgressiveOverload(exercise, sessions) {
    // Find last time this exercise was done
    for (const s of sessions) {
      const match = (s.exercises || []).find(e => e.name === exercise.name);
      if (match) {
        // Add 1 rep or 1 set compared to last time
        const newReps = Math.min(match.reps + 2, 20);
        const newSets = match.sets;
        return {
          sets: newSets,
          reps: newReps,
          reason: `Progressive overload — was ${match.reps} reps, now ${newReps}`,
        };
      }
    }
    return { sets: exercise.defaultSets, reps: exercise.defaultReps, reason: 'Standard volume' };
  }
}

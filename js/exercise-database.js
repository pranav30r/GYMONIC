/**
 * GYMONIC — Exercise Database & Body Part Mapping
 * Maps muscles → exercises with difficulty, validation status, and sets/reps defaults.
 */

// ─── Body Parts ─────────────────────────────────────────────────────
export const BODY_PARTS = [
  { id: 'chest',     name: 'Chest',     icon: '🫁', color: '#FF6B6B' },
  { id: 'back',      name: 'Back',      icon: '🔙', color: '#4ECDC4' },
  { id: 'shoulders', name: 'Shoulders', icon: '🏔️', color: '#45B7D1' },
  { id: 'arms',      name: 'Arms',      icon: '💪', color: '#F7DC6F' },
  { id: 'legs',      name: 'Legs',      icon: '🦵', color: '#BB8FCE' },
  { id: 'core',      name: 'Core',      icon: '🎯', color: '#F0B27A' },
];

// ─── Exercise Database ──────────────────────────────────────────────
export const EXERCISES = [
  // ── CHEST ──────────────────────────────────────────
  {
    id: 'push_up',
    name: 'Push-Up',
    icon: '🫳',
    primaryMuscle: 'chest',
    secondaryMuscles: ['arms'],
    bodyParts: ['chest', 'arms'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: true,
    fsmId: 'push_up',
    description: 'Classic bodyweight chest builder',
  },
  {
    id: 'wide_push_up',
    name: 'Wide Push-Up',
    icon: '🫳',
    primaryMuscle: 'chest',
    secondaryMuscles: ['shoulders'],
    bodyParts: ['chest', 'shoulders'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 10,
    hasAIValidation: true,
    fsmId: 'push_up',  // Reuses push-up FSM with wider hand position
    description: 'Wider hand placement targets outer chest',
  },
  {
    id: 'diamond_push_up',
    name: 'Diamond Push-Up',
    icon: '💎',
    primaryMuscle: 'chest',
    secondaryMuscles: ['arms'],
    bodyParts: ['chest', 'arms'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 8,
    hasAIValidation: true,
    fsmId: 'push_up',
    description: 'Hands together — targets inner chest & triceps',
  },
  {
    id: 'decline_push_up',
    name: 'Decline Push-Up',
    icon: '📐',
    primaryMuscle: 'chest',
    secondaryMuscles: ['shoulders'],
    bodyParts: ['chest', 'shoulders'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 10,
    hasAIValidation: true,
    fsmId: 'push_up',
    description: 'Feet elevated — targets upper chest',
  },
  {
    id: 'chest_fly',
    name: 'Chest Fly (Dumbbell)',
    icon: '🦋',
    primaryMuscle: 'chest',
    secondaryMuscles: [],
    bodyParts: ['chest'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: false,
    fsmId: null,
    description: 'Isolation movement for chest stretch',
  },

  // ── BACK ───────────────────────────────────────────
  {
    id: 'superman',
    name: 'Superman Hold',
    icon: '🦸',
    primaryMuscle: 'back',
    secondaryMuscles: ['core'],
    bodyParts: ['back', 'core'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 10,
    hasAIValidation: false,
    fsmId: null,
    description: 'Lie face down, lift arms and legs',
  },
  {
    id: 'reverse_snow_angel',
    name: 'Reverse Snow Angel',
    icon: '👼',
    primaryMuscle: 'back',
    secondaryMuscles: ['shoulders'],
    bodyParts: ['back', 'shoulders'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: false,
    fsmId: null,
    description: 'Strengthens upper back and rear delts',
  },
  {
    id: 'bent_over_row',
    name: 'Bent-Over Row',
    icon: '🚣',
    primaryMuscle: 'back',
    secondaryMuscles: ['arms'],
    bodyParts: ['back', 'arms'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 10,
    hasAIValidation: false,
    fsmId: null,
    description: 'Compound back builder with dumbbells',
  },

  // ── SHOULDERS ──────────────────────────────────────
  {
    id: 'lateral_raise',
    name: 'Lateral Raise',
    icon: '🤸',
    primaryMuscle: 'shoulders',
    secondaryMuscles: [],
    bodyParts: ['shoulders'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 15,
    hasAIValidation: true,
    fsmId: 'lateral_raise',
    description: 'Targets side delts for wider shoulders',
  },
  {
    id: 'front_raise',
    name: 'Front Raise',
    icon: '🙆',
    primaryMuscle: 'shoulders',
    secondaryMuscles: [],
    bodyParts: ['shoulders'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: false,
    fsmId: null,
    description: 'Targets front delts',
  },
  {
    id: 'shoulder_press',
    name: 'Shoulder Press',
    icon: '🏋️',
    primaryMuscle: 'shoulders',
    secondaryMuscles: ['arms'],
    bodyParts: ['shoulders', 'arms'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 10,
    hasAIValidation: false,
    fsmId: null,
    description: 'Overhead pressing for overall delt development',
  },
  {
    id: 'pike_push_up',
    name: 'Pike Push-Up',
    icon: '⛰️',
    primaryMuscle: 'shoulders',
    secondaryMuscles: ['arms'],
    bodyParts: ['shoulders', 'arms'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 8,
    hasAIValidation: true,
    fsmId: 'push_up',
    description: 'Bodyweight shoulder press alternative',
  },

  // ── ARMS ───────────────────────────────────────────
  {
    id: 'bicep_curl',
    name: 'Bicep Curl',
    icon: '💪',
    primaryMuscle: 'arms',
    secondaryMuscles: [],
    bodyParts: ['arms'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: true,
    fsmId: 'bicep_curl',
    description: 'Classic arm builder with dumbbells',
  },
  {
    id: 'hammer_curl',
    name: 'Hammer Curl',
    icon: '🔨',
    primaryMuscle: 'arms',
    secondaryMuscles: [],
    bodyParts: ['arms'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: true,
    fsmId: 'bicep_curl',  // Same FSM, different grip
    description: 'Neutral grip targets brachialis and forearms',
  },
  {
    id: 'tricep_dip',
    name: 'Tricep Dip (Bench)',
    icon: '🪑',
    primaryMuscle: 'arms',
    secondaryMuscles: ['chest'],
    bodyParts: ['arms', 'chest'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: false,
    fsmId: null,
    description: 'Targets triceps using a bench or chair',
  },
  {
    id: 'tricep_extension',
    name: 'Overhead Tricep Extension',
    icon: '🔺',
    primaryMuscle: 'arms',
    secondaryMuscles: [],
    bodyParts: ['arms'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: false,
    fsmId: null,
    description: 'Isolates the long head of the tricep',
  },

  // ── LEGS ───────────────────────────────────────────
  {
    id: 'squat',
    name: 'Squat',
    icon: '🦵',
    primaryMuscle: 'legs',
    secondaryMuscles: ['core'],
    bodyParts: ['legs', 'core'],
    difficulty: 'beginner',
    defaultSets: 4,
    defaultReps: 12,
    hasAIValidation: true,
    fsmId: 'squat',
    description: 'King of leg exercises — quads, glutes, hamstrings',
  },
  {
    id: 'lunge',
    name: 'Lunges',
    icon: '🚶',
    primaryMuscle: 'legs',
    secondaryMuscles: ['core'],
    bodyParts: ['legs', 'core'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 10,
    hasAIValidation: false,
    fsmId: null,
    description: 'Unilateral leg exercise for balance and strength',
  },
  {
    id: 'wall_sit',
    name: 'Wall Sit',
    icon: '🧱',
    primaryMuscle: 'legs',
    secondaryMuscles: [],
    bodyParts: ['legs'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 1,  // Time-based: 30-60 seconds
    hasAIValidation: false,
    fsmId: null,
    description: 'Isometric hold against wall — builds endurance',
  },
  {
    id: 'calf_raise',
    name: 'Calf Raise',
    icon: '🦶',
    primaryMuscle: 'legs',
    secondaryMuscles: [],
    bodyParts: ['legs'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 20,
    hasAIValidation: false,
    fsmId: null,
    description: 'Isolates calf muscles',
  },
  {
    id: 'sumo_squat',
    name: 'Sumo Squat',
    icon: '🏯',
    primaryMuscle: 'legs',
    secondaryMuscles: ['core'],
    bodyParts: ['legs', 'core'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: true,
    fsmId: 'squat',
    description: 'Wide stance targets inner thighs and glutes',
  },

  // ── CORE ───────────────────────────────────────────
  {
    id: 'plank',
    name: 'Plank',
    icon: '📏',
    primaryMuscle: 'core',
    secondaryMuscles: ['shoulders'],
    bodyParts: ['core', 'shoulders'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 1,  // Time-based
    hasAIValidation: false,
    fsmId: null,
    description: 'Isometric core hold — foundation exercise',
  },
  {
    id: 'crunch',
    name: 'Crunch',
    icon: '🔄',
    primaryMuscle: 'core',
    secondaryMuscles: [],
    bodyParts: ['core'],
    difficulty: 'beginner',
    defaultSets: 3,
    defaultReps: 15,
    hasAIValidation: false,
    fsmId: null,
    description: 'Basic ab exercise',
  },
  {
    id: 'mountain_climber',
    name: 'Mountain Climber',
    icon: '🏔️',
    primaryMuscle: 'core',
    secondaryMuscles: ['legs', 'shoulders'],
    bodyParts: ['core', 'legs'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 20,
    hasAIValidation: false,
    fsmId: null,
    description: 'Dynamic core + cardio exercise',
  },
  {
    id: 'leg_raise',
    name: 'Lying Leg Raise',
    icon: '🦿',
    primaryMuscle: 'core',
    secondaryMuscles: [],
    bodyParts: ['core'],
    difficulty: 'intermediate',
    defaultSets: 3,
    defaultReps: 12,
    hasAIValidation: false,
    fsmId: null,
    description: 'Targets lower abs',
  },
];

// ─── Query Functions ────────────────────────────────────────────────

/**
 * Get exercises for selected body parts.
 * @param {string[]} bodyPartIds - Array of body part IDs
 * @returns {Object[]} Matching exercises, sorted by AI-validated first
 */
export function getExercisesForBodyParts(bodyPartIds) {
  const partSet = new Set(bodyPartIds);
  const matched = EXERCISES.filter(ex =>
    ex.bodyParts.some(bp => partSet.has(bp))
  );

  // Sort: AI-validated first, then by difficulty
  const diffOrder = { beginner: 0, intermediate: 1, advanced: 2 };
  matched.sort((a, b) => {
    if (a.hasAIValidation !== b.hasAIValidation) return b.hasAIValidation ? 1 : -1;
    return (diffOrder[a.difficulty] || 0) - (diffOrder[b.difficulty] || 0);
  });

  return matched;
}

/**
 * Generate a smart workout — pick 4-6 exercises per body part selection.
 * @param {string[]} bodyPartIds
 * @returns {Object[]} Selected exercises with sets/reps
 */
export function generateWorkout(bodyPartIds) {
  const all = getExercisesForBodyParts(bodyPartIds);
  const workout = [];
  const used = new Set();

  // Pick ~2-3 exercises per body part, prioritizing AI-validated ones
  for (const partId of bodyPartIds) {
    const partExercises = all.filter(ex =>
      ex.primaryMuscle === partId && !used.has(ex.id)
    );

    // Take up to 3: prioritize AI-validated
    const aiExercises = partExercises.filter(e => e.hasAIValidation);
    const nonAiExercises = partExercises.filter(e => !e.hasAIValidation);

    const picked = [...aiExercises.slice(0, 2), ...nonAiExercises.slice(0, 1)].slice(0, 3);

    for (const ex of picked) {
      used.add(ex.id);
      workout.push({
        ...ex,
        sets: ex.defaultSets,
        reps: ex.defaultReps,
      });
    }
  }

  // If too few exercises, add secondary muscle exercises
  if (workout.length < 4) {
    for (const ex of all) {
      if (!used.has(ex.id) && workout.length < 6) {
        used.add(ex.id);
        workout.push({ ...ex, sets: ex.defaultSets, reps: ex.defaultReps });
      }
    }
  }

  return workout;
}

/**
 * Get exercise by ID.
 */
export function getExerciseById(id) {
  return EXERCISES.find(ex => ex.id === id) || null;
}

/**
 * Get all exercises (for custom workout builder).
 */
export function getAllExercises() {
  return [...EXERCISES];
}

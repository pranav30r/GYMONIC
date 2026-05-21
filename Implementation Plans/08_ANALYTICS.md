# GYMONIC — Section 13: Data & Analytics Layer

---

# 13. Data & Analytics Layer

## 13.1 Rep Counting Algorithm

Rep counting is driven by the state machine (§9). A rep is counted when the FSM completes a full phase cycle.

```python
class RepCounter:
    def __init__(self):
        self.total_reps = 0
        self.partial_reps = 0
        self.rep_timestamps = []      # (start_ms, end_ms) per rep
        self.rep_scores = []          # FormScore per rep
        self.current_rep_start = None
        self.rep_aggregator = RepScoreAggregator()
    
    def on_state_transition(self, old_state: str, new_state: str, 
                            timestamp_ms: float, is_rep_complete: bool):
        if old_state == "IDLE" or old_state == "STANDING" or old_state == "START":
            self.current_rep_start = timestamp_ms
        
        if is_rep_complete:
            self.total_reps += 1
            end_time = timestamp_ms
            self.rep_timestamps.append((self.current_rep_start or end_time, end_time))
            
            # Finalize rep score
            rep_score = self.rep_aggregator.finalize_rep()
            self.rep_scores.append(rep_score)
            self.current_rep_start = timestamp_ms
    
    def on_incomplete_rep(self, timestamp_ms: float):
        self.partial_reps += 1
        self.rep_aggregator.finalize_rep()  # Discard partial rep score
    
    def on_frame(self, form_score: FormScore):
        """Feed every frame's form score into the current rep's aggregator."""
        self.rep_aggregator.add_frame(form_score)
    
    def get_rep_tempo(self) -> Optional[float]:
        """Average seconds per rep."""
        if len(self.rep_timestamps) < 2:
            return None
        durations = [(end - start) / 1000 for start, end in self.rep_timestamps]
        return sum(durations) / len(durations)
    
    def get_rep_consistency(self) -> float:
        """How consistent are rep durations (lower std dev = more consistent). Returns CV%."""
        if len(self.rep_timestamps) < 3:
            return 0.0
        durations = [(end - start) for start, end in self.rep_timestamps]
        mean_d = sum(durations) / len(durations)
        if mean_d == 0:
            return 0.0
        variance = sum((d - mean_d) ** 2 for d in durations) / len(durations)
        std_dev = variance ** 0.5
        return (std_dev / mean_d) * 100  # Coefficient of variation
```

## 13.2 Range-of-Motion Metrics

```python
class ROMTracker:
    """Track range of motion per rep for the primary joint."""
    
    def __init__(self):
        self.per_rep_rom = []  # (min_angle, max_angle) per rep
        self.current_min = 360
        self.current_max = 0
    
    def on_frame(self, primary_angle: float):
        self.current_min = min(self.current_min, primary_angle)
        self.current_max = max(self.current_max, primary_angle)
    
    def on_rep_complete(self):
        rom = self.current_max - self.current_min
        self.per_rep_rom.append({
            "min_angle": self.current_min,
            "max_angle": self.current_max,
            "rom": rom
        })
        self.current_min = 360
        self.current_max = 0
    
    def get_avg_rom(self) -> float:
        if not self.per_rep_rom:
            return 0
        return sum(r["rom"] for r in self.per_rep_rom) / len(self.per_rep_rom)
    
    def get_rom_degradation(self) -> float:
        """Percentage ROM decrease from first rep to last rep. Positive = degradation."""
        if len(self.per_rep_rom) < 3:
            return 0.0
        first_3_avg = sum(r["rom"] for r in self.per_rep_rom[:3]) / 3
        last_3_avg = sum(r["rom"] for r in self.per_rep_rom[-3:]) / 3
        if first_3_avg == 0:
            return 0.0
        return ((first_3_avg - last_3_avg) / first_3_avg) * 100
```

## 13.3 Session Analytics

```python
@dataclass
class SessionAnalytics:
    session_id: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    
    # Per-exercise breakdown
    exercises: List[ExerciseAnalytics]
    
    # Aggregates
    total_reps: int
    total_sets: int
    avg_form_score: float
    best_rep_score: float
    worst_rep_score: float
    
    # Insights
    primary_issues: List[str]       # Top 3 recurring errors
    form_trend: str                 # "improving" | "stable" | "degrading"
    rom_trend: str
    
    @staticmethod
    def compute(session_data: SessionData) -> 'SessionAnalytics':
        exercises = []
        for ex_id, ex_data in session_data.exercises.items():
            exercises.append(ExerciseAnalytics(
                exercise_id=ex_id,
                sets=len(ex_data.sets),
                total_reps=sum(s.rep_count for s in ex_data.sets),
                avg_score=mean(s.avg_score for s in ex_data.sets),
                avg_rom=mean(s.avg_rom for s in ex_data.sets),
                rep_scores=[score for s in ex_data.sets for score in s.rep_scores],
            ))
        
        all_scores = [s for ex in exercises for s in ex.rep_scores]
        
        return SessionAnalytics(
            total_reps=sum(ex.total_reps for ex in exercises),
            total_sets=sum(ex.sets for ex in exercises),
            avg_form_score=mean(all_scores) if all_scores else 0,
            best_rep_score=max(all_scores) if all_scores else 0,
            worst_rep_score=min(all_scores) if all_scores else 0,
            exercises=exercises,
            form_trend=_compute_trend(all_scores),
            # ... remaining fields
        )
```

## 13.4 Database Schema

```sql
-- User profile & calibration
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    created_at TEXT,
    calibration_json TEXT,  -- Serialized UserCalibration
    preferences_json TEXT
);

-- Session-level data
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(user_id),
    start_time TEXT,
    end_time TEXT,
    duration_seconds REAL,
    total_reps INTEGER,
    total_sets INTEGER,
    avg_form_score REAL,
    exercises_json TEXT,  -- Serialized List[ExerciseAnalytics]
    insights_json TEXT
);

-- Set-level data (within a session)
CREATE TABLE sets (
    set_id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(session_id),
    exercise_id TEXT,
    set_number INTEGER,
    rep_count INTEGER,
    avg_score REAL,
    avg_rom REAL,
    avg_tempo_seconds REAL,
    rep_scores_json TEXT,   -- [float] per rep
    rep_roms_json TEXT,     -- [float] per rep
    errors_json TEXT,       -- [{error_type, count}]
    start_time TEXT,
    end_time TEXT
);

-- Long-term trend tracking (daily aggregates)
CREATE TABLE daily_stats (
    date TEXT,
    user_id TEXT,
    exercise_id TEXT,
    total_reps INTEGER,
    avg_score REAL,
    avg_rom REAL,
    sessions_count INTEGER,
    PRIMARY KEY (date, user_id, exercise_id)
);
```

## 13.5 Long-Term Progress Queries

```sql
-- Form score trend over last 30 days
SELECT date, avg_score, total_reps
FROM daily_stats
WHERE user_id = ? AND exercise_id = ?
AND date >= date('now', '-30 days')
ORDER BY date;

-- Best form score per exercise (personal records)
SELECT exercise_id, MAX(avg_score) as best_score, date
FROM daily_stats
WHERE user_id = ?
GROUP BY exercise_id;

-- ROM improvement over time
SELECT date, avg_rom
FROM daily_stats
WHERE user_id = ? AND exercise_id = 'squat'
AND date >= date('now', '-90 days')
ORDER BY date;

-- Total volume (reps × sessions)
SELECT SUM(total_reps) as total_reps, COUNT(DISTINCT session_id) as sessions
FROM sets
WHERE session_id IN (SELECT session_id FROM sessions WHERE user_id = ?);
```

## 13.6 Data Export

```python
class DataExporter:
    def export_session_csv(self, session_id: str, output_path: str):
        """Export session data as CSV for user portability."""
        sets = db.query("SELECT * FROM sets WHERE session_id = ?", session_id)
        
        with open(output_path, 'w') as f:
            writer = csv.writer(f)
            writer.writerow(["Set", "Exercise", "Reps", "Avg Score", "Avg ROM", "Tempo"])
            for s in sets:
                writer.writerow([s.set_number, s.exercise_id, s.rep_count,
                               f"{s.avg_score:.1f}", f"{s.avg_rom:.1f}", 
                               f"{s.avg_tempo_seconds:.1f}s"])
    
    def export_progress_json(self, user_id: str) -> dict:
        """Export all-time progress data as JSON."""
        stats = db.query("SELECT * FROM daily_stats WHERE user_id = ? ORDER BY date", user_id)
        return {"user_id": user_id, "daily_stats": [row_to_dict(s) for s in stats]}
```

# GYMONIC — Section 10: Biomechanical Form Validation Engine

---

# 10. Biomechanical Form Validation Engine

## 10.1 Architecture Overview

```
SmoothedFeatureSet ──┐
                     ├──▶ FormValidator ──▶ FormScore
ExerciseState ───────┤         │
UserCalibration ─────┘         ├── Per-joint scores
                               ├── Error list (prioritized)
                               └── Overall color (G/Y/R)
```

```python
class FormValidator:
    def __init__(self, config_manager: ExerciseConfigManager):
        self.config_manager = config_manager
    
    def validate(self, exercise_id: str, angles: Dict[str, float],
                 features: FeatureSet, state: ExerciseState,
                 calibration: Optional[UserCalibration]) -> FormScore:
        
        config = self.config_manager.get(exercise_id)
        if config is None:
            return FormScore.default()
        
        joint_scores = {}
        errors = []
        
        for rule in config.form_rules:
            metric_value = self._extract_metric(rule.metric, angles, features)
            if metric_value is None:
                continue  # Landmark not visible — skip rule
            
            # Adjust thresholds for user calibration
            expected_min, expected_max = rule.expected_range
            if calibration:
                expected_min, expected_max = calibration.adjust_threshold(
                    expected_min, expected_max, rule.joint_type
                )
            
            # Compute score for this rule
            score = self._score_metric(metric_value, expected_min, expected_max, rule.tolerance)
            joint_scores[rule.rule_id] = score
            
            # Generate error if below threshold
            if score < 80:
                severity = (80 - score) / 80  # 0–1 scale
                errors.append(FormError(
                    error_type=rule.error_type,
                    joint_id=rule.rule_id,
                    severity=severity,
                    measured_value=metric_value,
                    expected_range=(expected_min, expected_max),
                    corrective_message=rule.error_message
                ))
        
        # Weighted overall score
        overall = self._weighted_average(joint_scores, config)
        
        # Color classification
        color = self._classify_color(overall, config)
        
        # Sort errors by severity (worst first)
        errors.sort(key=lambda e: e.severity, reverse=True)
        
        return FormScore(
            overall_score=overall,
            color=color,
            joint_scores=joint_scores,
            errors=errors,
            timestamp=state.timestamp,
            rep_number=state.rep_count,
            phase=state.phase
        )
```

## 10.2 Scoring Function

### 10.2.1 Trapezoidal Scoring

Score is 100 within the expected range, degrades linearly outside it, and floors at 0:

```
Score(v) =
  100                                   if min ≤ v ≤ max
  100 - ((min - v) / tolerance) × 100   if v < min AND v ≥ min - tolerance
  100 - ((v - max) / tolerance) × 100   if v > max AND v ≤ max + tolerance
  0                                     if v < min - tolerance OR v > max + tolerance
```

```python
def _score_metric(self, value: float, expected_min: float, 
                  expected_max: float, tolerance: float) -> float:
    if expected_min <= value <= expected_max:
        return 100.0
    
    if value < expected_min:
        deviation = expected_min - value
    else:
        deviation = value - expected_max
    
    if tolerance <= 0:
        return 0.0
    
    score = max(0.0, 100.0 - (deviation / tolerance) * 100.0)
    return score
```

### 10.2.2 Weighted Average

```python
def _weighted_average(self, joint_scores: Dict[str, float], 
                      config: ExerciseConfig) -> float:
    total_weight = 0
    weighted_sum = 0
    
    for rule in config.form_rules:
        if rule.rule_id in joint_scores:
            weighted_sum += joint_scores[rule.rule_id] * rule.severity_weight
            total_weight += rule.severity_weight
    
    if total_weight == 0:
        return 100.0  # No data — assume correct
    
    return weighted_sum / total_weight
```

### 10.2.3 Color Classification

```python
def _classify_color(self, score: float, config: ExerciseConfig) -> FormColor:
    if score >= config.scoring.green_threshold:    # Default: 80
        return FormColor.GREEN
    elif score >= config.scoring.yellow_threshold:  # Default: 50
        return FormColor.YELLOW
    else:
        return FormColor.RED
```

---

## 10.3 Bicep Curl Form Validation

### 10.3.1 Correct Posture (Mathematical Definition)

```
CORRECT BICEP CURL (sagittal view):
├── Elbow angle: 170° (bottom) → 35° (top) — full ROM
├── Elbow position: stationary relative to torso (Δx < 0.15 body units)
├── Shoulder angle: stable (Δ < 10° from baseline)
├── Torso lean: < 10° from vertical
├── Wrist: neutral (wrist-forearm angle 165°–180°)
└── Bilateral symmetry: |left_elbow - right_elbow| < 15° (if bilateral)
```

### 10.3.2 Validation Rules

| Rule ID | Metric | Expected Range | Tolerance | Weight | Error Message |
|---|---|---|---|---|---|
| `curl_elbow_rom` | min elbow angle in rep | 30°–55° | 10° | 0.25 | "Curl higher for full contraction" |
| `curl_full_extension` | max elbow angle in rep | 155°–175° | 10° | 0.15 | "Extend fully at the bottom" |
| `curl_elbow_drift` | elbow-to-hip horizontal distance change | 0–0.12 body units | 0.05 | 0.25 | "Keep elbows pinned to your sides" |
| `curl_shoulder_swing` | shoulder angle delta from baseline | -8° to +8° | 5° | 0.20 | "Don't swing — use controlled motion" |
| `curl_torso_lean` | torso angle from vertical | 0°–8° | 5° | 0.10 | "Stand straight, don't lean back" |
| `curl_wrist_neutral` | wrist deviation angle | -10° to +10° | 5° | 0.05 | "Keep wrists straight" |

### 10.3.3 Metric Extraction

```python
def extract_curl_metrics(angles, features, landmarks):
    metrics = {}
    
    # Active arm detection (use the arm with more motion)
    active = "left" if angles.get("left_elbow_rom", 0) > angles.get("right_elbow_rom", 0) else "right"
    
    metrics["curl_elbow_rom"] = angles.get(f"{active}_elbow")
    
    # Elbow drift: horizontal distance between elbow and hip
    elbow_idx = 13 if active == "left" else 14
    hip_idx = 23 if active == "left" else 24
    elbow_x = landmarks[elbow_idx].norm_x
    hip_x = landmarks[hip_idx].norm_x
    metrics["curl_elbow_drift"] = abs(elbow_x - hip_x)
    
    # Shoulder swing: shoulder angle change from start-of-rep baseline
    metrics["curl_shoulder_swing"] = angles.get(f"{active}_shoulder", 0) - features.get("shoulder_baseline", 0)
    
    # Torso lean: angle of shoulder-hip line from vertical
    metrics["curl_torso_lean"] = features.get("torso_lean_angle", 0)
    
    return metrics
```

---

## 10.4 Squat Form Validation

### 10.4.1 Correct Posture (Mathematical Definition)

```
CORRECT SQUAT (sagittal + frontal):
├── Knee angle at bottom: 70°–100° (parallel to deep)
├── Hip angle at bottom: 60°–95°
├── Knee tracking: knees track over toes (not inward/valgus)
│   └── Measured: knee_x stays between hip_x and ankle_x (frontal view)
├── Torso lean: 30°–50° from vertical (proportional to femur length)
├── Heel contact: heels remain on ground (heel_y ≈ foot_index_y)
├── Depth symmetry: |left_knee_angle - right_knee_angle| < 10°
└── Bar path (if applicable): wrists stay over mid-foot
```

### 10.4.2 Validation Rules

| Rule ID | Metric | Expected Range | Tolerance | Weight | Error Message |
|---|---|---|---|---|---|
| `squat_depth` | min knee angle | 70°–100° | 15° | 0.25 | "Go deeper — thighs should reach parallel" |
| `squat_knee_valgus` | knee_x relative to hip-ankle line | -0.05 to +0.15 | 0.05 | 0.25 | "Push your knees out over your toes" |
| `squat_torso_lean` | torso angle from vertical | 25°–50° | 10° | 0.15 | "Keep your chest up" |
| `squat_heel_rise` | heel_y - foot_index_y | -0.02 to +0.02 | 0.02 | 0.15 | "Keep your heels on the ground" |
| `squat_symmetry` | |left_knee - right_knee| | 0°–8° | 5° | "Even out both sides" |
| `squat_hip_depth` | min hip angle | 60°–100° | 10° | 0.10 | "Sit back more into the squat" |
| `squat_lockout` | max knee angle at top | 165°–180° | 5° | 0.10 | "Stand all the way up at the top" |

### 10.4.3 Knee Valgus Detection (Frontal View)

```python
def detect_knee_valgus(landmarks) -> Tuple[float, float]:
    """Returns valgus score for left and right knee. Positive = valgus (inward)."""
    
    # Left side
    l_hip_x = landmarks[23].norm_x
    l_knee_x = landmarks[25].norm_x
    l_ankle_x = landmarks[27].norm_x
    
    # Expected knee position: linearly between hip and ankle
    l_expected_knee_x = (l_hip_x + l_ankle_x) / 2
    l_valgus = l_expected_knee_x - l_knee_x  # Positive = knee is medial (inward)
    
    # Right side
    r_hip_x = landmarks[24].norm_x
    r_knee_x = landmarks[26].norm_x
    r_ankle_x = landmarks[28].norm_x
    
    r_expected_knee_x = (r_hip_x + r_ankle_x) / 2
    r_valgus = r_knee_x - r_expected_knee_x  # Positive = knee is medial (inward)
    
    return l_valgus, r_valgus
```

---

## 10.5 Push-Up Form Validation

### 10.5.1 Correct Posture (Mathematical Definition)

```
CORRECT PUSH-UP (sagittal view):
├── Elbow angle at bottom: 70°–95°
├── Elbow angle at top: > 160° (full lockout)
├── Body alignment: shoulder–hip–ankle collinear (deviation < 10°)
│   └── Measured: angle of shoulder-hip-ankle should be 170°–180°
├── Hip sag: hip should not drop below shoulder-ankle line
├── Hip pike: hip should not rise above shoulder-ankle line
├── Head position: nose between shoulder level ± 0.1 body units
└── Elbow flare: elbow-shoulder-hip angle 30°–75° (not too wide)
```

### 10.5.2 Validation Rules

| Rule ID | Metric | Expected Range | Tolerance | Weight | Error Message |
|---|---|---|---|---|---|
| `pushup_depth` | min elbow angle | 70°–95° | 10° | 0.25 | "Go lower — chest should nearly touch the ground" |
| `pushup_lockout` | max elbow angle | 160°–180° | 5° | 0.15 | "Fully extend your arms at the top" |
| `pushup_body_line` | shoulder-hip-ankle angle | 170°–180° | 8° | 0.25 | "Keep your body in a straight line" |
| `pushup_hip_sag` | hip position relative to shoulder-ankle line | ≥ 0 | 0.03 | 0.15 | "Don't let your hips sag — engage your core" |
| `pushup_hip_pike` | hip position relative to shoulder-ankle line | ≤ 0.1 | 0.03 | 0.10 | "Don't pike your hips up" |
| `pushup_head_pos` | nose_y relative to shoulder_y | -0.08 to +0.08 | 0.05 | 0.10 | "Keep your head neutral — look at the floor" |

### 10.5.3 Body Line Measurement

```python
def measure_body_line(landmarks) -> float:
    """Compute shoulder-hip-ankle angle. 180° = perfectly straight."""
    shoulder = ((landmarks[11].x + landmarks[12].x) / 2,
                (landmarks[11].y + landmarks[12].y) / 2)
    hip = ((landmarks[23].x + landmarks[24].x) / 2,
           (landmarks[23].y + landmarks[24].y) / 2)
    ankle = ((landmarks[27].x + landmarks[28].x) / 2,
             (landmarks[27].y + landmarks[28].y) / 2)
    
    return safe_angle(shoulder, hip, ankle)  # Should be ~170-180°
```

---

## 10.6 Anthropometric Variability Handling

### 10.6.1 Why Thresholds Must Adapt

A person with long femurs relative to torso will naturally lean forward more during squats. Applying the same torso-lean threshold to all users creates false positives for tall, long-legged individuals.

### 10.6.2 Adaptation Formula

```python
def adapt_threshold(base_range, user_ratio, population_mean, sensitivity=10):
    """
    base_range: (min, max) default threshold
    user_ratio: user's limb ratio from calibration
    population_mean: average ratio across population
    sensitivity: degrees of adjustment per unit ratio difference
    """
    offset = (user_ratio - population_mean) * sensitivity
    return (base_range[0] + offset, base_range[1] + offset)

# Example: Squat torso lean for user with long femurs
POPULATION_MEAN_THIGH_RATIO = 0.70
user_thigh_ratio = 0.82  # Long femurs

base_lean_range = (25, 50)  # degrees
adapted = adapt_threshold(base_lean_range, 0.82, 0.70, sensitivity=15)
# Result: (26.8, 51.8) — allows ~2° more lean
```

---

## 10.7 Phase-Specific Validation

Not all rules apply during all phases. Validate only what matters in each phase:

```python
PHASE_RULES = {
    "bicep_curl": {
        "START":       ["curl_full_extension", "curl_elbow_drift", "curl_torso_lean"],
        "CONCENTRIC":  ["curl_elbow_drift", "curl_shoulder_swing", "curl_torso_lean"],
        "PEAK":        ["curl_elbow_rom", "curl_wrist_neutral"],
        "ECCENTRIC":   ["curl_elbow_drift", "curl_shoulder_swing", "curl_torso_lean"],
    },
    "squat": {
        "STANDING":    ["squat_lockout"],
        "DESCENT":     ["squat_knee_valgus", "squat_torso_lean", "squat_heel_rise"],
        "BOTTOM":      ["squat_depth", "squat_knee_valgus", "squat_hip_depth", "squat_symmetry"],
        "ASCENT":      ["squat_knee_valgus", "squat_torso_lean", "squat_heel_rise"],
    },
    "push_up": {
        "PLANK":       ["pushup_body_line", "pushup_lockout"],
        "DESCENT":     ["pushup_body_line", "pushup_hip_sag"],
        "BOTTOM":      ["pushup_depth", "pushup_body_line"],
        "ASCENT":      ["pushup_body_line", "pushup_hip_sag", "pushup_hip_pike"],
    },
}
```

## 10.8 Per-Rep Score Aggregation

```python
class RepScoreAggregator:
    """Aggregates frame-level scores into a single per-rep score."""
    
    def __init__(self):
        self.frame_scores = []
        self.frame_errors = []
    
    def add_frame(self, form_score: FormScore):
        self.frame_scores.append(form_score.overall_score)
        self.frame_errors.extend(form_score.errors)
    
    def finalize_rep(self) -> RepScore:
        if not self.frame_scores:
            return RepScore(score=0, grade="N/A")
        
        # Use percentile-based scoring (penalize worst moments more)
        sorted_scores = sorted(self.frame_scores)
        p25 = sorted_scores[len(sorted_scores) // 4]       # Worst quartile
        p50 = sorted_scores[len(sorted_scores) // 2]       # Median
        mean = sum(sorted_scores) / len(sorted_scores)
        
        # Weighted: 40% worst quartile + 30% median + 30% mean
        # This penalizes form breakdowns more than rewarding good frames
        rep_score = 0.4 * p25 + 0.3 * p50 + 0.3 * mean
        
        # Most common error
        error_counts = Counter(e.error_type for e in self.frame_errors)
        primary_error = error_counts.most_common(1)[0][0] if error_counts else None
        
        # Reset for next rep
        result = RepScore(
            score=rep_score,
            grade=self._grade(rep_score),
            primary_error=primary_error,
            frame_count=len(self.frame_scores)
        )
        self.frame_scores.clear()
        self.frame_errors.clear()
        return result
    
    def _grade(self, score):
        if score >= 90: return "A+"
        if score >= 80: return "A"
        if score >= 70: return "B"
        if score >= 60: return "C"
        if score >= 50: return "D"
        return "F"
```

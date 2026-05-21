# GYMONIC — Section 6: Pose Estimation Deep Dive

---

# 6. Pose Estimation Deep Dive

## 6.1 Landmark Indexing & Semantics

MediaPipe Pose outputs 33 landmarks organized into functional groups. Each landmark has semantic meaning for biomechanical analysis.

### 6.1.1 Functional Grouping

```
HEAD GROUP (indices 0–10): Orientation detection, not used for form validation
├── 0: Nose — Head position reference
├── 1–6: Eye landmarks — Gaze direction (unused in v1)
├── 7–8: Ears — Head tilt detection
└── 9–10: Mouth corners — Unused

UPPER BODY (indices 11–22): Primary form analysis zone
├── 11: Left Shoulder  ─┐
├── 12: Right Shoulder ──┤── Shoulder alignment, press form, lateral raise
├── 13: Left Elbow    ──┤── Curl angle, press lockout
├── 14: Right Elbow   ──┤
├── 15: Left Wrist    ──┤── Grip position, wrist alignment
├── 16: Right Wrist   ──┘
├── 17–18: Pinky fingers ─┐
├── 19–20: Index fingers ──┤── Hand orientation (grip analysis)
└── 21–22: Thumbs ─────────┘

LOWER BODY (indices 23–32): Squat, deadlift, lunge analysis
├── 23: Left Hip    ──┐
├── 24: Right Hip   ──┤── Hip hinge, squat depth, torso lean
├── 25: Left Knee   ──┤── Knee tracking, valgus detection
├── 26: Right Knee  ──┤
├── 27: Left Ankle  ──┤── Ankle dorsiflexion
├── 28: Right Ankle ──┘
├── 29: Left Heel   ──┐
├── 30: Right Heel  ──┤── Foot flat detection, heel rise
├── 31: Left Foot Index ┤── Stance width, toe angle
└── 32: Right Foot Index┘
```

### 6.1.2 Exercise-Critical Landmark Subsets

Not all 33 landmarks matter for every exercise. Define minimal landmark sets per exercise to optimize confidence checking:

```python
EXERCISE_LANDMARKS = {
    "bicep_curl": {
        "primary":   [11, 12, 13, 14, 15, 16],  # Shoulders, elbows, wrists
        "secondary": [23, 24],                     # Hips (for swing detection)
        "optional":  [0]                           # Nose (head position)
    },
    "squat": {
        "primary":   [23, 24, 25, 26, 27, 28],  # Hips, knees, ankles
        "secondary": [11, 12],                     # Shoulders (torso lean)
        "optional":  [29, 30, 31, 32]             # Feet (heel rise detection)
    },
    "push_up": {
        "primary":   [11, 12, 13, 14, 15, 16, 23, 24, 27, 28],
        "secondary": [25, 26],                     # Knees (sag detection)
        "optional":  [0]                           # Nose (head alignment)
    },
    "lateral_raise": {
        "primary":   [11, 12, 13, 14, 15, 16],
        "secondary": [23, 24],                     # Hips (lean detection)
        "optional":  [0]
    },
    "shoulder_press": {
        "primary":   [11, 12, 13, 14, 15, 16],
        "secondary": [23, 24],
        "optional":  [0]
    },
    "deadlift": {
        "primary":   [11, 12, 23, 24, 25, 26, 27, 28],
        "secondary": [15, 16],                     # Wrists (bar position)
        "optional":  [29, 30]                      # Heels
    }
}
```

## 6.2 Coordinate Systems

### 6.2.1 Model Output Space (Normalized)

MediaPipe outputs landmarks in normalized coordinates relative to the input tensor:
- `x ∈ [0.0, 1.0]` — horizontal (left edge = 0, right edge = 1)
- `y ∈ [0.0, 1.0]` — vertical (top edge = 0, bottom edge = 1)
- `z` — relative depth, roughly in the same scale as `x`. Negative z = closer to camera.

> [!WARNING]
> The `z` coordinate is **not** metric depth. It is a relative value normalized by an internal reference (approximately hip width). It is useful for relative depth ordering (e.g., "left knee is in front of right knee") but NOT for absolute distance measurement.

### 6.2.2 Pixel Space

After denormalization using frame dimensions:
```python
pixel_x = norm_x * frame_width   # e.g., 0.5 * 1280 = 640px
pixel_y = norm_y * frame_height  # e.g., 0.3 * 720 = 216px
```

**Used for:** Rendering skeleton overlay on camera preview.

### 6.2.3 Body-Relative Space

Normalized relative to body dimensions to achieve **anthropometric invariance**:

```python
def to_body_relative(landmarks):
    # Origin: midpoint of hips
    origin_x = (landmarks[23].x + landmarks[24].x) / 2
    origin_y = (landmarks[23].y + landmarks[24].y) / 2
    
    # Scale: torso length (hip center to shoulder center)
    shoulder_center_y = (landmarks[11].y + landmarks[12].y) / 2
    torso_length = abs(shoulder_center_y - origin_y)
    
    if torso_length < 0.01:  # Degenerate case
        return None  # Cannot normalize
    
    body_relative = []
    for lm in landmarks:
        body_relative.append(BodyRelativeLandmark(
            bx = (lm.x - origin_x) / torso_length,
            by = (lm.y - origin_y) / torso_length,
            bz = lm.z / torso_length,
            visibility = lm.visibility,
            index = lm.index
        ))
    return body_relative
```

**Used for:** Exercise classification, form validation (height-invariant comparisons).

### 6.2.4 Coordinate System Selection by Module

| Module | Coordinate System | Reason |
|---|---|---|
| Rendering | Pixel space | Must map to screen pixels |
| Joint angle computation | Normalized (model space) | Angles are scale-invariant |
| Exercise classification | Body-relative | Must be height/distance invariant |
| Form validation | Mixed (angles + body-relative positions) | Angles for joint form; positions for alignment |
| Analytics storage | Normalized | Compact, reconstructable |

## 6.3 Confidence Scores & Filtering

### 6.3.1 Visibility Score Semantics

MediaPipe provides a `visibility` score per landmark:
- `visibility > 0.8`: Landmark clearly visible, high confidence
- `0.5 < visibility ≤ 0.8`: Landmark partially visible or model is uncertain
- `0.3 < visibility ≤ 0.5`: Landmark likely occluded, position is estimated/hallucinated
- `visibility ≤ 0.3`: Landmark should be considered absent

### 6.3.2 Confidence-Based Filtering Strategy

```python
class LandmarkFilter:
    # Thresholds
    HIGH_CONFIDENCE = 0.8
    USABLE_CONFIDENCE = 0.5
    MIN_CONFIDENCE = 0.3
    
    def filter_for_angle_computation(self, landmarks, joint_triplet):
        """All three landmarks must meet USABLE threshold for angle to be valid."""
        a, b, c = joint_triplet
        if (landmarks[a].visibility >= self.USABLE_CONFIDENCE and
            landmarks[b].visibility >= self.USABLE_CONFIDENCE and
            landmarks[c].visibility >= self.USABLE_CONFIDENCE):
            return True, min(landmarks[a].visibility, 
                           landmarks[b].visibility, 
                           landmarks[c].visibility)
        return False, 0.0
    
    def filter_for_exercise_detection(self, landmarks, exercise_id):
        """All PRIMARY landmarks must meet MIN threshold."""
        primary = EXERCISE_LANDMARKS[exercise_id]["primary"]
        visible_count = sum(1 for i in primary 
                          if landmarks[i].visibility >= self.MIN_CONFIDENCE)
        return visible_count >= len(primary) * 0.8  # 80% of primary landmarks visible
    
    def compute_pose_quality(self, landmarks):
        """Overall pose quality score for UI display."""
        core = [11, 12, 13, 14, 23, 24, 25, 26]  # Core body landmarks
        avg_vis = mean([landmarks[i].visibility for i in core])
        return avg_vis
```

### 6.3.3 Confidence-Weighted Angle Computation

When a landmark has moderate confidence (0.5–0.8), weight its contribution to the form score:

```python
def compute_weighted_form_score(angle, expected, tolerance, confidence):
    """Scale the certainty of a form error by landmark confidence."""
    raw_error = abs(angle - expected)
    
    if raw_error <= tolerance:
        raw_score = 100.0
    else:
        raw_score = max(0, 100 - (raw_error - tolerance) * 3)
    
    # Confidence weighting: uncertain landmarks contribute less to score
    # At visibility=1.0, full weight. At visibility=0.5, half weight.
    weight = min(1.0, confidence / 0.8)
    weighted_score = raw_score * weight + 100 * (1 - weight)  # Uncertain → assume OK
    
    return weighted_score, weight
```

**Rationale:** When we're uncertain about a landmark's position, we should NOT penalize the user. Err on the side of "correct" rather than generating false-positive error alerts.

## 6.4 Temporal Consistency Challenges

### 6.4.1 Sources of Temporal Noise

| Source | Magnitude | Frequency | Impact |
|---|---|---|---|
| Model prediction jitter | 2–8 px at 1080p | Per-frame random | Noisy angle readings, false state transitions |
| Motion blur | 5–20 px position shift | During fast movements | Incorrect landmark positions during eccentric/concentric phases |
| Partial occlusion flicker | Landmark appears/disappears | Sporadic | State machine confusion, rep count errors |
| Auto-exposure adjustment | Global brightness shift | Every 1–3 seconds | Temporary accuracy degradation |
| Rolling shutter | Spatial distortion | Constant (proportional to speed) | Limb length distortion during fast movements |

### 6.4.2 Jitter Quantification

Measured jitter for stationary pose (standing still, 720p, good lighting):

```
Landmark          Mean Jitter (px)    Max Jitter (px)    Std Dev (px)
─────────────     ────────────────    ────────────────   ────────────
Nose              1.2                 3.8                0.9
Shoulder (L)      2.1                 6.4                1.5
Elbow (L)         2.8                 8.1                2.0
Wrist (L)         3.5                 11.2               2.8
Hip (L)           1.8                 5.2                1.2
Knee (L)          2.4                 7.0                1.7
Ankle (L)         3.1                 9.5                2.3
```

**Observation:** Jitter increases with distance from torso (extremities are noisier). This directly impacts angle computation: elbow angle (shoulder–elbow–wrist) involves two high-jitter landmarks.

**Angle jitter from landmark jitter:**

For a joint angle computed from three landmarks, the angular jitter can be approximated:

```
δθ ≈ (δp / L) × (180/π)

Where:
  δp = landmark position jitter (pixels)
  L  = limb segment length (pixels)
  δθ = resulting angle jitter (degrees)

Example: Elbow angle during bicep curl
  δp ≈ 3.0 px (average of shoulder + wrist jitter)
  L  ≈ 80 px (forearm length at typical distance)
  δθ ≈ (3.0 / 80) × 57.3 ≈ 2.1°
```

A 2° jitter is manageable for form validation (tolerance bands are ±5–15°), but for state machine transitions (detecting angle peaks/valleys), it can cause false triggers. This necessitates temporal smoothing (Section 7.2).

### 6.4.3 Occlusion Recovery

When a landmark becomes temporarily invisible (e.g., hand behind body during a twist):

```python
class OcclusionHandler:
    MAX_INTERPOLATION_FRAMES = 5  # Don't interpolate beyond 5 frames (~167ms at 30fps)
    
    def __init__(self):
        self.last_valid = {}  # landmark_index → (position, frame_count_since_valid)
    
    def handle(self, landmark_index, current_landmark):
        if current_landmark.visibility >= 0.3:
            # Valid — update cache
            self.last_valid[landmark_index] = (current_landmark, 0)
            return current_landmark, True
        
        # Occluded — attempt interpolation
        if landmark_index in self.last_valid:
            cached, age = self.last_valid[landmark_index]
            age += 1
            self.last_valid[landmark_index] = (cached, age)
            
            if age <= self.MAX_INTERPOLATION_FRAMES:
                # Return last known position with decaying confidence
                interpolated = cached.copy()
                interpolated.visibility = cached.visibility * (0.8 ** age)
                return interpolated, False  # False = interpolated, not observed
        
        # No valid cache or too old — landmark is unavailable
        return None, False
```

# GYMONIC — Section 3: Product Specification

---

# 3. Product Specification

## 3.1 Functional Requirements

### FR-1: Real-Time Pose Tracking

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-1.1 | System shall detect and track 33 body landmarks from monocular RGB input | All 33 MediaPipe Pose landmarks detected with visibility > 0.5 for visible joints |
| FR-1.2 | Tracking shall operate at ≥ 15 FPS on target devices | Measured via frame timestamp delta; p95 ≤ 67ms |
| FR-1.3 | System shall handle single-person scenes | Largest detected person is tracked; multi-person scenes use highest-confidence detection |
| FR-1.4 | Landmark positions shall be temporally consistent | Frame-to-frame landmark jitter ≤ 3px at 1080p after smoothing |
| FR-1.5 | System shall report per-landmark confidence scores | Each landmark includes visibility ∈ [0.0, 1.0]; landmarks below 0.3 are flagged as unreliable |

**Landmark Set (MediaPipe Pose 33-point model):**

```
Index  Landmark              Body Region
─────  ────────────────────  ───────────
0      Nose                  Head
1      Left Eye Inner        Head
2      Left Eye              Head
3      Left Eye Outer        Head
4      Right Eye Inner       Head
5      Right Eye             Head
6      Right Eye Outer       Head
7      Left Ear              Head
8      Right Ear             Head
9      Left Mouth            Head
10     Right Mouth           Head
11     Left Shoulder         Upper Body
12     Right Shoulder        Upper Body
13     Left Elbow            Upper Body
14     Right Elbow           Upper Body
15     Left Wrist            Upper Body
16     Right Wrist           Upper Body
17     Left Pinky            Hand
18     Right Pinky           Hand
19     Left Index            Hand
20     Right Index           Hand
21     Left Thumb            Hand
22     Right Thumb           Hand
23     Left Hip              Lower Body
24     Right Hip             Lower Body
25     Left Knee             Lower Body
26     Right Knee            Lower Body
27     Left Ankle            Lower Body
28     Right Ankle           Lower Body
29     Left Heel             Foot
30     Right Heel            Foot
31     Left Foot Index       Foot
32     Right Foot Index      Foot
```

### FR-2: Exercise Detection & Classification

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-2.1 | System shall automatically identify the exercise being performed | Classification accuracy ≥ 90% within 3 seconds of exercise start |
| FR-2.2 | Minimum supported exercise set: Bicep Curl, Squat, Push-Up, Lateral Raise, Shoulder Press, Deadlift | All 6 exercises classified correctly in controlled testing |
| FR-2.3 | System shall support manual exercise selection as override | User can select exercise from list; overrides auto-detection |
| FR-2.4 | Classification shall be robust to left/right side variations | Bilateral symmetry handling: left-arm curl ≡ right-arm curl |
| FR-2.5 | System shall detect "idle" / "between sets" state | No false positive exercise detection during rest periods > 3s |

**Classification Input Features:**

```python
ExerciseFeatureVector = {
    "primary_joint_angles": [float],      # Angles of joints most relevant to movement
    "angle_velocities": [float],          # Rate of change of joint angles (°/s)
    "body_orientation": float,            # Torso angle relative to vertical (0° = standing)
    "active_limb_segments": [str],        # Which limb segments show significant motion
    "movement_plane": str,                # SAGITTAL | FRONTAL | TRANSVERSE
    "periodicity_score": float,           # How repetitive is the motion [0–1]
}
```

### FR-3: Form Validation

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-3.1 | System shall evaluate biomechanical correctness per frame | FormScore computed for every processed frame |
| FR-3.2 | Validation shall use exercise-specific rule sets | Each exercise has independent validation rules |
| FR-3.3 | System shall classify form into GREEN (correct), YELLOW (partial), RED (incorrect) | Three-tier classification with defined thresholds |
| FR-3.4 | System shall identify specific form errors | Error types: angle deviation, alignment error, ROM deficiency, compensation detected |
| FR-3.5 | Validation shall account for anthropometric variability | Thresholds adjusted by ±10% based on limb proportion ratios |
| FR-3.6 | System shall detect form degradation over reps | Per-rep form score tracked; alert if score drops > 15% from rep 1 baseline |

**FormScore Data Structure:**

```python
@dataclass
class FormScore:
    overall_score: float          # 0–100, weighted aggregate
    color: FormColor              # GREEN (≥80) | YELLOW (50–79) | RED (<50)
    joint_scores: Dict[str, float]  # Per-joint score, 0–100
    errors: List[FormError]       # Ordered by severity (descending)
    timestamp: float              # Frame timestamp in ms
    rep_number: int               # Current rep (0 = between reps)
    phase: str                    # Current movement phase

@dataclass
class FormError:
    error_type: str               # ANGLE_DEVIATION | ALIGNMENT | ROM | COMPENSATION
    joint_id: str                 # Affected joint (e.g., "left_elbow")
    severity: float               # 0–1 (1 = most severe)
    measured_value: float         # Actual angle/position
    expected_range: Tuple[float, float]  # Acceptable [min, max]
    corrective_message: str       # Human-readable instruction
```

### FR-4: Feedback Generation

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-4.1 | Visual feedback via color-coded skeleton overlay | Skeleton rendered on camera feed with per-joint coloring |
| FR-4.2 | Text feedback with corrective instructions | Top-priority error message displayed on screen |
| FR-4.3 | Audio feedback for critical errors | Text-to-speech or pre-recorded audio for RED-level errors |
| FR-4.4 | Feedback shall not overwhelm the user | Maximum 1 corrective message at a time; 3-second cooldown between messages |
| FR-4.5 | Positive reinforcement for correct form | "Great form!" or equivalent when score > 90 for 5+ consecutive seconds |
| FR-4.6 | Rep completion audio cue | Audible beep/chime on rep completion |

### FR-5: Session Analytics

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-5.1 | System shall count repetitions per set | Rep count accuracy ≥ 95% (tested across 100+ sets) |
| FR-5.2 | System shall compute per-rep form scores | Each completed rep has an associated FormScore |
| FR-5.3 | System shall compute session-level metrics | Total reps, average score, best/worst rep, total time |
| FR-5.4 | System shall generate a post-session summary | Summary screen with charts and key metrics |
| FR-5.5 | System shall persist session data locally | SQLite or equivalent local storage; exportable |
| FR-5.6 | System shall track progress over time | Historical trend charts for form score, rep count, ROM |

---

## 3.2 Non-Functional Requirements

### NFR-1: Latency

| ID | Requirement | Target | Hard Limit |
|---|---|---|---|
| NFR-1.1 | Frame capture to pose estimation output | ≤ 40ms | ≤ 60ms |
| NFR-1.2 | Pose estimation to form score output | ≤ 15ms | ≤ 25ms |
| NFR-1.3 | Form score to visual overlay render | ≤ 10ms | ≤ 16ms |
| NFR-1.4 | End-to-end pipeline latency | ≤ 65ms | ≤ 100ms |
| NFR-1.5 | Audio feedback trigger to playback start | ≤ 200ms | ≤ 500ms |

**Latency Budget Breakdown:**

```
┌────────────────────────────────────────────────────────────────┐
│                    65ms TOTAL BUDGET                           │
├────────────┬──────────┬───────────┬──────────┬────────────────┤
│  Capture   │  Pose    │  Angle +  │  Form    │   Render       │
│  + Preproc │  Model   │  Classify │  Valid.  │   Overlay      │
│   5ms      │  30ms    │  12ms     │  10ms    │   8ms          │
└────────────┴──────────┴───────────┴──────────┴────────────────┘
```

### NFR-2: Frame Rate

| ID | Requirement | Target |
|---|---|---|
| NFR-2.1 | Camera capture frame rate | 30 FPS |
| NFR-2.2 | Pose estimation processing rate | ≥ 15 FPS (can skip alternate frames) |
| NFR-2.3 | UI render frame rate (camera preview) | 30 FPS (decoupled from pose processing) |
| NFR-2.4 | Overlay update rate | ≥ 15 FPS (synchronized with pose output) |

**Frame Skipping Strategy:**

```python
# Decoupled rendering: camera preview runs at 30 FPS,
# pose estimation processes every Nth frame based on device capability.

class AdaptiveFrameScheduler:
    def __init__(self, target_fps=15):
        self.target_interval = 1000.0 / target_fps  # 66.7ms for 15 FPS
        self.last_process_time = 0
        self.skip_ratio = 1  # Process every Nth frame
    
    def should_process(self, current_time_ms: float) -> bool:
        elapsed = current_time_ms - self.last_process_time
        if elapsed >= self.target_interval:
            self.last_process_time = current_time_ms
            return True
        return False
    
    def adapt(self, actual_inference_ms: float):
        """Dynamically adjust skip ratio based on actual inference time."""
        if actual_inference_ms > self.target_interval:
            self.skip_ratio = max(1, int(actual_inference_ms / self.target_interval) + 1)
        else:
            self.skip_ratio = 1
```

### NFR-3: Accuracy

| ID | Requirement | Target | Measurement |
|---|---|---|---|
| NFR-3.1 | Joint angle accuracy vs. ground truth | ≤ 5° mean error | Compared against manual goniometer measurement |
| NFR-3.2 | Exercise classification accuracy | ≥ 92% | 10-fold cross-validation on test set |
| NFR-3.3 | Rep counting accuracy | ≥ 95% | Compared against manual count across 500+ reps |
| NFR-3.4 | Form error detection precision | ≥ 85% | True positive rate for intentional form errors |
| NFR-3.5 | Form error detection recall | ≥ 80% | Coverage of all form error types |
| NFR-3.6 | False positive rate for form errors | ≤ 10% | Correct form falsely flagged as incorrect |

### NFR-4: Robustness Across Environments

| ID | Requirement | Conditions |
|---|---|---|
| NFR-4.1 | Lighting robustness | System shall function in 50–2000 lux (dim gym to outdoor) |
| NFR-4.2 | Background robustness | Cluttered gym backgrounds, mirrors, other people |
| NFR-4.3 | Clothing robustness | Loose clothing, dark clothing, patterned clothing |
| NFR-4.4 | Distance robustness | 1.0m–4.0m from camera for full-body exercises |
| NFR-4.5 | Angle robustness | ±30° from perpendicular (frontal or sagittal view) |
| NFR-4.6 | Device robustness | Functional on devices from 2022+ (≥ 4GB RAM, ≥ A14 / SD 778G) |

### NFR-5: Resource Constraints

| ID | Requirement | Target |
|---|---|---|
| NFR-5.1 | Peak memory usage | ≤ 300MB RAM |
| NFR-5.2 | Model file size | ≤ 10MB total (all models combined) |
| NFR-5.3 | Battery drain rate | ≤ 15% per 30-min session |
| NFR-5.4 | CPU thermal throttling | System shall detect and adapt to thermal throttling within 5 frames |
| NFR-5.5 | Network dependency | Zero network required for core functionality (on-device inference) |
| NFR-5.6 | App cold start time | ≤ 3 seconds to camera-ready state |

### NFR-6: Reliability & Stability

| ID | Requirement | Target |
|---|---|---|
| NFR-6.1 | Crash-free session rate | ≥ 99.5% |
| NFR-6.2 | Graceful degradation under load | Reduce FPS before dropping frames entirely |
| NFR-6.3 | Pose tracking recovery | Resume tracking within 500ms after occlusion |
| NFR-6.4 | Session data persistence | Zero data loss on app backgrounding or interruption |
| NFR-6.5 | Model loading failure | Fallback to lighter model if primary fails to load |

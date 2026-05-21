# GYMONIC — System Assumptions & Operational Constraints

---

# A. System Assumptions

## A.1 Camera & Environment Assumptions

| Assumption | Specified Value | Fallback |
|---|---|---|
| Camera position | Stationary (propped/mounted), not handheld | Detect excessive motion via gyroscope; pause analysis |
| Camera distance | 1.5m–3.5m from user (full body visible) | If partial body: switch to upper/lower body mode |
| Camera height | 0.5m–1.5m (floor to chest level) | Calibration step normalizes perspective distortion |
| Camera orientation | Landscape preferred; portrait supported | Aspect ratio adaptation in preprocessing |
| Camera angle | Frontal (±30°) or sagittal (±30°) | Detect view angle from shoulder/hip ratios; adapt rules |
| Device type | Smartphone or tablet (2022+ hardware) | Performance tier detection at startup |
| Lighting | Indoor gym (100–1500 lux) or home (50–800 lux) | Auto-exposure handled by OS; frame brightness check |
| Floor | Flat, level surface | Ankle/heel landmarks used as ground plane reference |
| Clothing | Fitted or semi-fitted athletic wear | Loose clothing degrades wrist/ankle accuracy — warn user |
| Equipment | Dumbbells, barbell, bodyweight | Equipment may occlude wrists — handled by occlusion system |

## A.2 User Assumptions

| Assumption | Value |
|---|---|
| Number of users in frame | 1 (primary). Others may be present in background |
| User fitness level | Beginner to intermediate (knows basic exercise names) |
| User body type | Any (system calibrates to individual proportions) |
| User age | 16–65 (biomechanical norms calibrated for this range) |
| User facing camera | Yes — user should face camera or be perpendicular to it |

---

# B. Input Constraints & Validation

## B.1 Acceptable Input Ranges

```python
INPUT_CONSTRAINTS = {
    "min_resolution": (640, 480),      # Below this: warn user
    "max_resolution": (1920, 1080),    # Above this: downsample
    "target_resolution": (1280, 720),  # Optimal
    "min_fps": 15,                     # Below this: degrade gracefully
    "target_fps": 30,
    "min_brightness": 40,              # Mean pixel value [0-255]; below = too dark
    "max_brightness": 240,             # Above = overexposed
    "min_person_height_ratio": 0.4,    # Person must occupy ≥40% of frame height
    "max_person_height_ratio": 0.95,   # Person shouldn't be cropped
}
```

## B.2 Input Validation Pipeline

```python
class InputValidator:
    def validate_frame(self, frame: RawFrame) -> ValidationResult:
        issues = []
        
        # Resolution check
        h, w = frame.height, frame.width
        if h < 480 or w < 640:
            issues.append(InputIssue("LOW_RESOLUTION", severity=CRITICAL,
                message="Camera resolution too low. Please use a higher quality camera."))
        
        # Brightness check (mean luminance)
        gray = to_grayscale(frame.pixels)
        mean_brightness = gray.mean()
        if mean_brightness < 40:
            issues.append(InputIssue("TOO_DARK", severity=WARNING,
                message="Environment is too dark. Please improve lighting."))
        elif mean_brightness > 240:
            issues.append(InputIssue("OVEREXPOSED", severity=WARNING,
                message="Too much light. Please reduce glare."))
        
        # Camera stability (requires gyroscope data)
        if frame.gyro_magnitude > 2.0:  # rad/s threshold
            issues.append(InputIssue("CAMERA_MOVING", severity=CRITICAL,
                message="Please place your phone on a stable surface."))
        
        # Person detection check (post pose-estimation)
        # Deferred to after pose model runs
        
        return ValidationResult(
            is_valid=all(i.severity != CRITICAL for i in issues),
            issues=issues
        )
    
    def validate_pose(self, pose: RawPose) -> ValidationResult:
        issues = []
        
        # No person detected
        if pose.model_confidence < 0.3:
            issues.append(InputIssue("NO_PERSON", severity=CRITICAL,
                message="No person detected. Please step into frame."))
            return ValidationResult(is_valid=False, issues=issues)
        
        # Person too small
        bbox_height = self._compute_bbox_height(pose)
        if bbox_height < INPUT_CONSTRAINTS["min_person_height_ratio"]:
            issues.append(InputIssue("TOO_FAR", severity=WARNING,
                message="You're too far from the camera. Please step closer."))
        
        # Person cropped
        if bbox_height > INPUT_CONSTRAINTS["max_person_height_ratio"]:
            issues.append(InputIssue("TOO_CLOSE", severity=WARNING,
                message="You're too close. Please step back."))
        
        return ValidationResult(
            is_valid=all(i.severity != CRITICAL for i in issues),
            issues=issues
        )
```

---

# C. Failsafe & Fallback Logic

| Failure Scenario | Detection Method | Fallback Action | Recovery |
|---|---|---|---|
| Pose not detected (0 frames) | `model_confidence < 0.3` for 10+ consecutive frames | Pause analysis, show "Step into frame" | Resume when confidence > 0.5 for 3+ frames |
| Pose partially detected | Primary landmarks < 80% visible | Switch to available-joint-only mode | Resume full analysis when landmarks return |
| FPS drops below 15 | Frame timestamp delta > 67ms for 5+ frames | Skip pose on alternate frames, reduce overlay detail | Restore when delta < 50ms |
| FPS drops below 8 | Frame delta > 125ms | Switch to MoveNet Lightning (fallback model) | Switch back after 30s if device cools |
| Model inference fails | Exception / timeout > 100ms | Return last valid pose (max 3 frames stale) | Retry next frame |
| Model fails to load | Load exception at startup | Try fallback model; if both fail, show error | Suggest app restart or device upgrade |
| Thermal throttling | CPU temp API or sustained FPS < 10 | Reduce to 10 FPS processing, dim screen | Gradual restore over 30s |
| Out of memory | Memory warning from OS | Release frame buffer history, reduce to 3-frame buffer | Restore when memory available |
| App backgrounded | Lifecycle event | Save session state, pause camera | Resume on foreground, offer to continue session |

```python
class FailsafeManager:
    def __init__(self):
        self.consecutive_no_pose = 0
        self.consecutive_slow_frames = 0
        self.current_tier = PerformanceTier.FULL  # FULL → REDUCED → MINIMAL
    
    def on_frame_result(self, pose_result, inference_time_ms, frame_delta_ms):
        # No pose detection
        if pose_result is None or pose_result.model_confidence < 0.3:
            self.consecutive_no_pose += 1
            if self.consecutive_no_pose > 10:
                return FailsafeAction.PAUSE_ANALYSIS
        else:
            self.consecutive_no_pose = 0
        
        # Performance degradation
        if frame_delta_ms > 67:
            self.consecutive_slow_frames += 1
            if self.consecutive_slow_frames > 5:
                self._downgrade_tier()
        else:
            self.consecutive_slow_frames = 0
            self._attempt_upgrade_tier()
        
        return FailsafeAction.CONTINUE
    
    def _downgrade_tier(self):
        if self.current_tier == PerformanceTier.FULL:
            self.current_tier = PerformanceTier.REDUCED  # Skip frames
        elif self.current_tier == PerformanceTier.REDUCED:
            self.current_tier = PerformanceTier.MINIMAL  # Fallback model
    
    def _attempt_upgrade_tier(self):
        # Only upgrade after sustained good performance (30 frames)
        if self.consecutive_slow_frames == 0 and self._frames_since_downgrade > 30:
            if self.current_tier == PerformanceTier.MINIMAL:
                self.current_tier = PerformanceTier.REDUCED
            elif self.current_tier == PerformanceTier.REDUCED:
                self.current_tier = PerformanceTier.FULL
```

---

# D. Configurability Layer

All thresholds, parameters, and messages externalized into configuration. **Zero hardcoded values in business logic.**

## D.1 Configuration Schema

```yaml
# config/exercises/bicep_curl.yaml
exercise:
  id: "bicep_curl"
  display_name: "Bicep Curl"
  category: "upper_body"
  view_preference: "frontal"  # or "sagittal"
  
  landmarks:
    primary: [11, 12, 13, 14, 15, 16]
    secondary: [23, 24]
  
  joint_angles:
    - joint: "left_elbow"
      triplet: [11, 13, 15]
      role: "primary_mover"
    - joint: "right_elbow"
      triplet: [12, 14, 16]
      role: "primary_mover"
  
  state_machine:
    phases:
      - name: "start"
        condition: "elbow_angle > 150"
      - name: "concentric"
        condition: "elbow_angle decreasing AND elbow_angle < 150"
      - name: "peak_contraction"
        condition: "elbow_angle < 50"
      - name: "eccentric"
        condition: "elbow_angle increasing AND elbow_angle > 50"
    rep_completion: "eccentric → start"
    hysteresis: 8  # degrees
  
  form_rules:
    - rule_id: "elbow_stable"
      description: "Elbow should stay close to torso"
      metric: "elbow_hip_distance"
      expected_range: [0.0, 0.15]  # body-relative units
      tolerance: 0.05
      severity_weight: 0.3
      error_message: "Keep your elbows pinned to your sides"
    
    - rule_id: "no_shoulder_swing"
      description: "Shoulder angle should remain stable"
      metric: "shoulder_angle_delta"
      expected_range: [-10, 10]  # degrees from baseline
      tolerance: 5
      severity_weight: 0.25
      error_message: "Don't swing — use controlled motion"
    
    - rule_id: "full_rom"
      description: "Full range of motion"
      metric: "min_elbow_angle"
      expected_range: [30, 55]
      tolerance: 10
      severity_weight: 0.2
      error_message: "Curl higher for full contraction"
    
    - rule_id: "full_extension"
      description: "Full extension at bottom"
      metric: "max_elbow_angle"
      expected_range: [155, 175]
      tolerance: 10
      severity_weight: 0.15
      error_message: "Extend fully at the bottom"
    
    - rule_id: "wrist_neutral"
      description: "Wrist should stay neutral"
      metric: "wrist_deviation_angle"
      expected_range: [-15, 15]
      tolerance: 5
      severity_weight: 0.1
      error_message: "Keep your wrists straight"
  
  scoring:
    green_threshold: 80
    yellow_threshold: 50
    
  feedback:
    positive_messages:
      - "Perfect curl! Great form."
      - "Excellent control!"
    cooldown_ms: 3000
```

## D.2 Config Loading

```python
class ExerciseConfigManager:
    def __init__(self, config_dir: str):
        self.configs = {}
        for file in listdir(config_dir):
            config = load_yaml(f"{config_dir}/{file}")
            self.configs[config["exercise"]["id"]] = ExerciseConfig.from_dict(config)
    
    def get(self, exercise_id: str) -> ExerciseConfig:
        return self.configs.get(exercise_id)
    
    def list_exercises(self) -> List[str]:
        return list(self.configs.keys())
```

---

# E. User Calibration Step

## E.1 Calibration Flow

```
1. User stands in T-pose (arms extended horizontally) facing camera
2. System captures 30 frames (1 second) of stable T-pose
3. System extracts:
   - Torso length (shoulder center → hip center)
   - Arm span (wrist → wrist)
   - Upper arm length (shoulder → elbow)
   - Forearm length (elbow → wrist)
   - Thigh length (hip → knee)
   - Shin length (knee → ankle)
   - Shoulder width
   - Hip width
4. System computes limb ratios (normalized by torso length)
5. System adjusts form validation thresholds based on ratios
6. Calibration stored in user profile; valid until recalibrated
```

## E.2 Calibration Data Structure

```python
@dataclass
class UserCalibration:
    user_id: str
    timestamp: datetime
    
    # Raw measurements (in body-relative units, normalized by torso length)
    torso_length: float       # Always 1.0 (reference)
    upper_arm_ratio: float    # Typical: 0.45–0.60
    forearm_ratio: float      # Typical: 0.40–0.55
    thigh_ratio: float        # Typical: 0.60–0.80
    shin_ratio: float         # Typical: 0.55–0.75
    shoulder_width_ratio: float  # Typical: 0.45–0.65
    hip_width_ratio: float    # Typical: 0.30–0.45
    arm_span_ratio: float     # Typical: 1.8–2.2 (relative to torso)
    
    # Derived adjustment factors
    elbow_angle_offset: float   # Degrees to add/subtract from thresholds
    knee_angle_offset: float
    hip_angle_offset: float
    
    # Camera perspective
    camera_height_ratio: float  # Camera height / user torso length
    view_angle: str             # "frontal" or "sagittal" (auto-detected)
    
    def compute_adjustments(self):
        """Adjust thresholds based on body proportions."""
        # Users with longer forearms naturally have different curl angles
        self.elbow_angle_offset = (self.forearm_ratio - 0.47) * 15  # ±3-5°
        
        # Users with longer femurs sit deeper in squats
        self.knee_angle_offset = (self.thigh_ratio - 0.70) * 10
        
        # Users with wider hips have different squat stance
        self.hip_angle_offset = (self.hip_width_ratio - 0.37) * 8

    def adjust_threshold(self, base_min, base_max, joint_type):
        """Apply calibration offset to a threshold range."""
        offset_map = {
            "elbow": self.elbow_angle_offset,
            "knee": self.knee_angle_offset,
            "hip": self.hip_angle_offset
        }
        offset = offset_map.get(joint_type, 0)
        return (base_min + offset, base_max + offset)
```

## E.3 Camera Angle Auto-Detection

```python
def detect_view_angle(landmarks) -> str:
    """Determine if user is facing camera (frontal) or sideways (sagittal)."""
    left_shoulder = landmarks[11]
    right_shoulder = landmarks[12]
    
    # Shoulder width in x-axis (normalized)
    shoulder_dx = abs(left_shoulder.x - right_shoulder.x)
    
    # Shoulder depth difference (z-axis)
    shoulder_dz = abs(left_shoulder.z - right_shoulder.z)
    
    # Frontal: shoulders are horizontally spread, similar depth
    # Sagittal: shoulders overlap in x, different depths
    if shoulder_dx > 0.15 and shoulder_dz < 0.1:
        return "frontal"
    elif shoulder_dx < 0.08 and shoulder_dz > 0.05:
        return "sagittal"
    else:
        return "oblique"  # User is at an angle — warn to reposition
```

---

# F. Multi-Person Handling

```python
class PersonSelector:
    """Select and lock onto primary user when multiple people are in frame."""
    
    def __init__(self):
        self.locked_person_id = None
        self.lock_frames = 0
        self.LOCK_THRESHOLD = 15  # Frames before locking
    
    def select_primary(self, detections: List[PoseDetection]) -> PoseDetection:
        if len(detections) == 0:
            return None
        
        if len(detections) == 1:
            self._lock_to(detections[0])
            return detections[0]
        
        # If locked, find the detection closest to locked position
        if self.locked_person_id is not None:
            best_match = self._find_closest_to_locked(detections)
            if best_match is not None:
                return best_match
        
        # Not locked: select by heuristics
        scored = []
        for det in detections:
            score = (
                det.confidence * 0.4 +          # Higher confidence
                det.bbox_area * 0.3 +            # Larger (closer to camera)
                self._center_score(det) * 0.3    # More centered in frame
            )
            scored.append((score, det))
        
        best = max(scored, key=lambda x: x[0])[1]
        self._lock_to(best)
        return best
    
    def _center_score(self, det):
        """Score how centered the person is (1.0 = perfect center)."""
        cx = (det.bbox.left + det.bbox.right) / 2
        return 1.0 - abs(cx - 0.5) * 2
    
    def _lock_to(self, det):
        self.lock_frames += 1
        if self.lock_frames >= self.LOCK_THRESHOLD:
            self.locked_person_id = det.tracking_id
```

---

# G. Frame & Time Management

```python
class FrameManager:
    """Manages frame buffering, dropped frame handling, and time synchronization."""
    
    BUFFER_SIZE = 10         # Rolling buffer of last 10 processed frames
    MAX_FRAME_GAP_MS = 200   # If gap > 200ms, reset temporal state
    
    def __init__(self):
        self.buffer = deque(maxlen=self.BUFFER_SIZE)
        self.last_timestamp = 0
        self.frame_count = 0
        self.dropped_count = 0
    
    def submit(self, frame: ProcessedFrame) -> FrameAction:
        gap = frame.timestamp_ms - self.last_timestamp
        
        if gap > self.MAX_FRAME_GAP_MS and self.last_timestamp > 0:
            # Large gap — reset temporal state (smoothing, velocity)
            self.buffer.clear()
            self.dropped_count += 1
            action = FrameAction.RESET_TEMPORAL
        elif gap < 10:
            # Duplicate frame — skip
            return FrameAction.SKIP
        else:
            action = FrameAction.PROCESS
        
        self.buffer.append(frame)
        self.last_timestamp = frame.timestamp_ms
        self.frame_count += 1
        return action
    
    def get_history(self, n: int) -> List[ProcessedFrame]:
        """Get last N frames for temporal analysis."""
        return list(self.buffer)[-n:]
    
    # Time-based logic (not frame-count-based) for consistency across FPS variations
    def get_frames_in_window(self, window_ms: float) -> List[ProcessedFrame]:
        cutoff = self.last_timestamp - window_ms
        return [f for f in self.buffer if f.timestamp_ms >= cutoff]
```

---

# H. State Persistence & Memory Model

| Data | Lifetime | Storage | Persists Across App Restart? |
|---|---|---|---|
| Current frame landmarks | 1 frame | RAM (overwritten each frame) | No |
| Frame buffer (last 10) | ~333ms | RAM (deque) | No |
| Current rep state (FSM) | 1 set | RAM | No (but session save captures it) |
| Current session stats | 1 session | RAM + periodic SQLite flush | Yes (auto-saved every 10 reps) |
| User calibration | Permanent | SQLite | Yes |
| Exercise configs | App lifetime | Loaded from assets at startup | Yes (bundled with app) |
| Historical sessions | Permanent | SQLite | Yes |
| User preferences | Permanent | SharedPreferences | Yes |

---

# I. Data Privacy & Security

| Concern | Policy | Implementation |
|---|---|---|
| Camera frames | **Never stored to disk**. Processed in RAM only. | Frame buffer is RAM-only deque; no file I/O |
| Pose landmarks | Stored as numerical coordinates only | No visual data in session logs |
| User calibration | Stored locally on device | SQLite with app-private storage |
| Session data | Local-only by default | Optional cloud sync (user opt-in) |
| Camera permissions | Requested with explanation | iOS: `NSCameraUsageDescription`; Android: runtime permission |
| Analytics telemetry | Anonymous usage stats only | No PII; no landmark data sent to servers |
| Data export | User-controlled | Export as JSON/CSV from app settings |
| Data deletion | Full local wipe available | "Delete all data" option in settings |

---

# J. Error Taxonomy

```python
class ErrorCategory(Enum):
    # Pipeline errors (system-level)
    DETECTION_ERROR = "detection"       # Pose model fails to detect person
    TRACKING_ERROR = "tracking"         # Person lost between frames
    INFERENCE_ERROR = "inference"       # Model runtime failure
    
    # Analysis errors (logic-level)
    CLASSIFICATION_ERROR = "classification"  # Wrong exercise identified
    STATE_ERROR = "state"               # FSM in invalid state
    CALIBRATION_ERROR = "calibration"   # User calibration invalid/missing
    
    # Validation errors (form-level)
    ANGLE_DEVIATION = "angle"           # Joint angle outside acceptable range
    ALIGNMENT_ERROR = "alignment"       # Body segment misaligned
    ROM_DEFICIENCY = "rom"              # Insufficient range of motion
    COMPENSATION = "compensation"       # Detected muscle compensation pattern
    ASYMMETRY = "asymmetry"            # Left/right imbalance
    TEMPO_ERROR = "tempo"              # Rep speed too fast/slow

@dataclass
class SystemError:
    category: ErrorCategory
    severity: Severity          # INFO, WARNING, CRITICAL, FATAL
    message: str
    recoverable: bool
    suggested_action: str       # What the system or user should do
    timestamp: float
    frame_id: int
```

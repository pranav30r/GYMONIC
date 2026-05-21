# GYMONIC — Sections 7–8: Mathematical Modeling & Exercise Recognition

---

# 7. Mathematical Modeling & Computation

## 7.1 Joint Angle Calculation

### 7.1.1 Vector Formulation

Given three landmarks A (proximal), B (joint), C (distal), the joint angle θ at B is the angle between vectors BA and BC.

```
        A (proximal)
       /
      / ← vector BA
     /
    B ←── θ (angle at joint)
     \
      \ ← vector BC
       \
        C (distal)
```

**Vector definitions:**
```
BA = A - B = (Ax - Bx, Ay - By)
BC = C - B = (Cx - Bx, Cy - By)
```

### 7.1.2 Dot Product Derivation

The angle between two vectors is derived from the dot product identity:

```
BA · BC = |BA| × |BC| × cos(θ)

Therefore:
cos(θ) = (BA · BC) / (|BA| × |BC|)

Expanding the dot product:
BA · BC = (Ax - Bx)(Cx - Bx) + (Ay - By)(Cy - By)

Magnitudes:
|BA| = √((Ax - Bx)² + (Ay - By)²)
|BC| = √((Cx - Bx)² + (Cy - By)²)

Final formula:
θ = arccos( (BA · BC) / (|BA| × |BC|) )
```

Convert to degrees: `θ_degrees = θ × (180 / π)`

### 7.1.3 Numerical Stability Considerations

**Problem 1: Division by zero when |BA| or |BC| = 0**

This occurs when two landmarks overlap (e.g., elbow at same position as shoulder). Caused by very low confidence landmarks being placed at default positions.

```python
def safe_angle(A, B, C):
    BA = (A[0] - B[0], A[1] - B[1])
    BC = (C[0] - B[0], C[1] - B[1])
    
    mag_BA = math.sqrt(BA[0]**2 + BA[1]**2)
    mag_BC = math.sqrt(BC[0]**2 + BC[1]**2)
    
    # Guard: if either segment is too short, angle is undefined
    if mag_BA < 1e-6 or mag_BC < 1e-6:
        return None  # Signal invalid angle
    
    dot = BA[0] * BC[0] + BA[1] * BC[1]
    cos_theta = dot / (mag_BA * mag_BC)
    
    # Guard: clamp to [-1, 1] to handle floating point errors
    cos_theta = max(-1.0, min(1.0, cos_theta))
    
    angle_rad = math.acos(cos_theta)
    return math.degrees(angle_rad)
```

**Problem 2: Floating-point precision near 0° and 180°**

`arccos` has poor numerical precision near the boundaries (cos → ±1). For angles very close to 0° or 180°, small errors in the dot product cause large angle jumps.

**Mitigation:** Use `atan2` formulation for better precision:

```python
def stable_angle_atan2(A, B, C):
    BA = (A[0] - B[0], A[1] - B[1])
    BC = (C[0] - B[0], C[1] - B[1])
    
    # Cross product magnitude (sin component)
    cross = BA[0] * BC[1] - BA[1] * BC[0]
    
    # Dot product (cos component)
    dot = BA[0] * BC[0] + BA[1] * BC[1]
    
    # atan2 gives full quadrant resolution and better precision
    angle_rad = math.atan2(abs(cross), dot)
    return math.degrees(angle_rad)
```

**Problem 3: 3D angle computation (using z-coordinate)**

When z-depth is available (MediaPipe provides relative z), extend to 3D:

```python
def angle_3d(A, B, C):
    BA = (A.x - B.x, A.y - B.y, A.z - B.z)
    BC = (C.x - B.x, C.y - B.y, C.z - B.z)
    
    dot = sum(a * b for a, b in zip(BA, BC))
    mag_BA = math.sqrt(sum(a**2 for a in BA))
    mag_BC = math.sqrt(sum(b**2 for b in BC))
    
    if mag_BA < 1e-6 or mag_BC < 1e-6:
        return None
    
    cos_theta = max(-1.0, min(1.0, dot / (mag_BA * mag_BC)))
    return math.degrees(math.acos(cos_theta))
```

> [!NOTE]
> Use 3D angles for exercises where depth matters (e.g., squat knee tracking in frontal view — z separates left/right knee). Use 2D angles for sagittal-plane exercises (e.g., bicep curl viewed from the side).

### 7.1.4 Complete Joint Angle Engine

```python
class JointAngleEngine:
    def __init__(self, use_3d: bool = True):
        self.use_3d = use_3d
        self.angle_fn = angle_3d if use_3d else safe_angle
    
    def compute_all(self, landmarks: List[Landmark]) -> Dict[str, Optional[float]]:
        results = {}
        for joint_name, (a_idx, b_idx, c_idx) in JOINT_DEFINITIONS.items():
            a, b, c = landmarks[a_idx], landmarks[b_idx], landmarks[c_idx]
            
            # Confidence check: all three must be visible
            min_vis = min(a.visibility, b.visibility, c.visibility)
            if min_vis < 0.3:
                results[joint_name] = None  # Unreliable
                continue
            
            if self.use_3d:
                angle = self.angle_fn(a, b, c)
            else:
                angle = self.angle_fn(
                    (a.x, a.y), (b.x, b.y), (c.x, c.y)
                )
            
            results[joint_name] = angle
        
        return results
```

## 7.2 Temporal Smoothing

### 7.2.1 Simple Moving Average (SMA)

```
θ_smoothed[t] = (1/N) × Σ(i=0 to N-1) θ[t-i]
```

```python
class MovingAverageFilter:
    def __init__(self, window_size: int = 5):
        self.window = window_size
        self.buffers = {}  # joint_name → deque
    
    def smooth(self, joint_name: str, raw_value: float) -> float:
        if joint_name not in self.buffers:
            self.buffers[joint_name] = deque(maxlen=self.window)
        
        self.buffers[joint_name].append(raw_value)
        return sum(self.buffers[joint_name]) / len(self.buffers[joint_name])
```

**Pros:** Simple, effective for slow movements.
**Cons:** Introduces latency = (N-1)/2 frames. At N=5, 30FPS → ~67ms lag. Blurs peak angles (reduces measured ROM).

### 7.2.2 Exponential Moving Average (EMA)

```
θ_smoothed[t] = α × θ_raw[t] + (1 - α) × θ_smoothed[t-1]
```

Where α ∈ (0, 1) is the smoothing factor. Higher α = more responsive, less smooth.

```python
class ExponentialFilter:
    def __init__(self, alpha: float = 0.4):
        self.alpha = alpha
        self.state = {}  # joint_name → last smoothed value
    
    def smooth(self, joint_name: str, raw_value: float) -> float:
        if joint_name not in self.state:
            self.state[joint_name] = raw_value
            return raw_value
        
        smoothed = self.alpha * raw_value + (1 - self.alpha) * self.state[joint_name]
        self.state[joint_name] = smoothed
        return smoothed
```

**Recommended α values:**
- α = 0.3: Heavy smoothing (slow exercises like deadlift)
- α = 0.5: Moderate smoothing (squats, curls)
- α = 0.7: Light smoothing (fast exercises like push-ups)

**Pros:** Zero latency at steady state. Computationally trivial. Tunable.
**Cons:** Still blurs peaks slightly. Single parameter controls both noise rejection and responsiveness.

### 7.2.3 One-Euro Filter (Recommended)

The One-Euro Filter adapts smoothing based on signal speed — more smoothing when still, less when moving:

```python
class OneEuroFilter:
    def __init__(self, min_cutoff=1.0, beta=0.007, d_cutoff=1.0):
        self.min_cutoff = min_cutoff  # Minimum cutoff frequency (smoothing when still)
        self.beta = beta              # Speed coefficient (responsiveness to fast changes)
        self.d_cutoff = d_cutoff      # Cutoff frequency for derivative
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None
    
    def __call__(self, x: float, t: float) -> float:
        if self.t_prev is None:
            self.x_prev = x
            self.t_prev = t
            return x
        
        dt = t - self.t_prev
        if dt <= 0:
            return self.x_prev
        
        # Estimate derivative
        dx = (x - self.x_prev) / dt
        
        # Smooth derivative
        alpha_d = self._alpha(dt, self.d_cutoff)
        dx_hat = alpha_d * dx + (1 - alpha_d) * self.dx_prev
        
        # Adaptive cutoff based on speed
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        
        # Smooth signal
        alpha = self._alpha(dt, cutoff)
        x_hat = alpha * x + (1 - alpha) * self.x_prev
        
        self.x_prev = x_hat
        self.dx_prev = dx_hat
        self.t_prev = t
        return x_hat
    
    def _alpha(self, dt, cutoff):
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)
```

**Selected as primary smoothing strategy.** Parameters tuned per joint:

| Joint Group | min_cutoff | beta | Rationale |
|---|---|---|---|
| Shoulders | 1.0 | 0.005 | Slow, stable joints |
| Elbows | 1.5 | 0.007 | Moderate speed (curls) |
| Wrists | 2.0 | 0.01 | Fast, noisy |
| Hips | 0.8 | 0.004 | Very stable |
| Knees | 1.2 | 0.006 | Moderate speed (squats) |
| Ankles | 1.5 | 0.008 | Can be noisy |

### 7.2.4 Velocity Computation

Angular velocity is needed for state machine transitions and tempo analysis:

```python
def compute_velocity(angle_current, angle_prev, dt_seconds):
    if dt_seconds <= 0:
        return 0.0
    velocity = (angle_current - angle_prev) / dt_seconds  # degrees/second
    return velocity

# Smooth velocity with its own EMA to avoid noise amplification
velocity_filter = ExponentialFilter(alpha=0.3)
```

---

# 8. Exercise Recognition Engine

## 8.1 Rule-Based System

### 8.1.1 Feature-Based Classification

Each exercise has a distinct motion signature defined by which joints move, in which plane, and with what periodicity.

```python
EXERCISE_SIGNATURES = {
    "bicep_curl": {
        "moving_joints": ["left_elbow", "right_elbow"],
        "stable_joints": ["left_hip", "right_hip", "left_knee", "right_knee"],
        "body_orientation": "upright",       # torso_lean < 20°
        "movement_plane": "sagittal",
        "primary_angle_range": (30, 170),    # Elbow ROM
        "periodicity": True,
    },
    "squat": {
        "moving_joints": ["left_hip", "right_hip", "left_knee", "right_knee"],
        "stable_joints": ["left_elbow", "right_elbow"],
        "body_orientation": "upright_to_leaning",  # torso_lean < 45°
        "movement_plane": "sagittal",
        "primary_angle_range": (60, 170),    # Knee ROM
        "periodicity": True,
    },
    "push_up": {
        "moving_joints": ["left_elbow", "right_elbow"],
        "stable_joints": ["left_knee", "right_knee"],
        "body_orientation": "horizontal",     # torso near parallel to floor
        "movement_plane": "sagittal",
        "primary_angle_range": (60, 170),    # Elbow ROM
        "periodicity": True,
    },
    "lateral_raise": {
        "moving_joints": ["left_shoulder", "right_shoulder"],
        "stable_joints": ["left_elbow", "right_elbow", "left_hip", "right_hip"],
        "body_orientation": "upright",
        "movement_plane": "frontal",
        "primary_angle_range": (10, 100),    # Shoulder abduction
        "periodicity": True,
    },
    "shoulder_press": {
        "moving_joints": ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow"],
        "stable_joints": ["left_hip", "right_hip"],
        "body_orientation": "upright",
        "movement_plane": "sagittal_and_frontal",
        "primary_angle_range": (60, 175),    # Elbow ROM + shoulder elevation
        "periodicity": True,
    },
    "deadlift": {
        "moving_joints": ["left_hip", "right_hip"],
        "stable_joints": ["left_knee", "right_knee"],  # Slight bend only
        "body_orientation": "upright_to_bent",  # Large torso lean
        "movement_plane": "sagittal",
        "primary_angle_range": (70, 170),    # Hip angle
        "periodicity": True,
    },
}
```

### 8.1.2 Classification Algorithm

```python
class RuleBasedClassifier:
    STABILITY_THRESHOLD = 15      # degrees — joint is "stable" if ROM < this
    MOVEMENT_THRESHOLD = 40       # degrees — joint is "moving" if ROM > this
    CLASSIFICATION_WINDOW = 2.0   # seconds of data needed
    
    def classify(self, angle_history: Dict[str, List[float]], 
                 body_orientation: str) -> Tuple[str, float]:
        """
        angle_history: {joint_name: [angles over last 2 seconds]}
        Returns: (exercise_id, confidence)
        """
        # Compute ROM per joint over the window
        joint_roms = {}
        for joint, angles in angle_history.items():
            if len(angles) > 5:
                joint_roms[joint] = max(angles) - min(angles)
            else:
                joint_roms[joint] = 0
        
        best_match = None
        best_score = 0
        
        for ex_id, sig in EXERCISE_SIGNATURES.items():
            score = 0
            max_score = 0
            
            # Check moving joints (should have high ROM)
            for joint in sig["moving_joints"]:
                max_score += 1
                if joint in joint_roms and joint_roms[joint] > self.MOVEMENT_THRESHOLD:
                    score += 1
            
            # Check stable joints (should have low ROM)
            for joint in sig["stable_joints"]:
                max_score += 1
                if joint in joint_roms and joint_roms[joint] < self.STABILITY_THRESHOLD:
                    score += 1
            
            # Check body orientation
            max_score += 1
            if self._check_orientation(body_orientation, sig["body_orientation"]):
                score += 1
            
            confidence = score / max_score if max_score > 0 else 0
            if confidence > best_score:
                best_score = confidence
                best_match = ex_id
        
        # Require minimum confidence
        if best_score < 0.6:
            return "unknown", best_score
        
        return best_match, best_score
```

**Pros:** Interpretable, no training data needed, easy to add new exercises, fast.
**Cons:** Brittle with hard thresholds, doesn't handle transitions well, no learning from user data.

## 8.2 ML-Based System (Phase 2+)

### 8.2.1 Approach: Temporal Sequence Classification

Model the problem as time-series classification: given a sequence of feature vectors over a window, predict the exercise class.

**Architecture: 1D-CNN + LSTM hybrid**

```
Input: [T × F] — T timesteps, F features per frame
  ↓
1D-Conv (kernel=3, filters=64) + ReLU + BatchNorm
  ↓
1D-Conv (kernel=3, filters=128) + ReLU + BatchNorm
  ↓
LSTM (hidden=128, bidirectional=False)  ← Causal for real-time
  ↓
Dense(64) + ReLU + Dropout(0.3)
  ↓
Dense(num_exercises) + Softmax
  ↓
Output: [num_exercises] probability distribution
```

**Input feature vector per frame (F = 22):**

```python
FEATURES_PER_FRAME = [
    # 10 joint angles
    "left_elbow", "right_elbow",
    "left_shoulder", "right_shoulder",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
    # 10 angular velocities (derivatives of above)
    "left_elbow_vel", "right_elbow_vel", ...
    # 2 body metrics
    "torso_lean_angle",
    "shoulder_hip_alignment",
]
```

**Window: T = 60 frames (2 seconds at 30 FPS)**

### 8.2.2 Dataset Requirements

| Metric | Target |
|---|---|
| Total samples | ≥ 10,000 exercise clips (2s each) |
| Per-exercise minimum | ≥ 1,500 clips |
| Subjects | ≥ 50 unique individuals |
| Diversity | Mix of body types, camera angles, lighting |
| Negative class | ≥ 2,000 "idle" / "transition" / "unknown" clips |
| Annotation | Per-clip exercise label + per-frame phase label (optional) |

### 8.2.3 Model Size & Inference

| Metric | Target |
|---|---|
| Model parameters | < 500K |
| Model size (INT8 quantized) | < 2MB |
| Inference time | < 5ms on mobile GPU |
| Format | TFLite (Android), Core ML (iOS) |

### 8.2.4 Hybrid Strategy (Recommended)

```
Phase 1 (MVP): Rule-based classifier only
  → Fast to implement, zero training data needed
  → Sufficient for 6-exercise library

Phase 2 (Post-launch): ML classifier with rule-based fallback
  → Train on collected user data (with consent)
  → ML handles edge cases and new exercises
  → Rule-based provides interpretable backup

Decision logic:
  if ML_confidence > 0.85:
      use ML prediction
  elif rule_confidence > 0.7:
      use rule prediction
  else:
      prompt user to manually select exercise
```

# GYMONIC — Sections 4–5: System Architecture & Technology Stack

---

# 4. End-to-End System Architecture

## 4.1 Pipeline Overview

```
┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Camera   │──▶│ Frame    │──▶│ Pose     │──▶│ Landmark │──▶│ Feature  │
│ Capture  │   │ Preproc  │   │ Estimat. │   │ Normaliz.│   │ Extract  │
└─────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                                  │
┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────▼────┐
│ Data     │◀──│ Render   │◀──│ Feedback │◀──│ Form     │◀──│ Joint    │
│ Logging  │   │ Layer    │   │ System   │   │ Valid.   │   │ Angle    │
└─────────┘   └──────────┘   └──────────┘   └──────────┘   │ Engine   │
                                                  ▲         └─────┬────┘
                                                  │               │
                                            ┌─────┴────┐   ┌─────▼────┐
                                            │ State    │◀──│ Temporal  │
                                            │ Machine  │   │ Modeling  │
                                            └─────┬────┘   └─────┬────┘
                                                  ▲               │
                                            ┌─────┴────┐         │
                                            │ Exercise │◀────────┘
                                            │ Classif. │
                                            └──────────┘
```

## 4.2 Module Specifications

---

### Module 1: Camera Capture

**Purpose:** Acquire raw RGB frames from device camera at target resolution and frame rate.

| Property | Value |
|---|---|
| **Input** | Hardware camera sensor data |
| **Output** | `RawFrame { pixels: UInt8[H×W×3], timestamp_ms: Float64, orientation: Int }` |
| **Target Resolution** | 1280×720 (720p) — balances quality vs. processing cost |
| **Target FPS** | 30 FPS capture; processing may consume every 2nd frame |
| **Dependencies** | OS camera API (AVCaptureSession on iOS, CameraX on Android) |

**Internal Logic:**
```python
class CameraCapture:
    def configure(self):
        self.session.set_resolution(1280, 720)
        self.session.set_frame_rate(30)
        self.session.set_pixel_format(BGRA)  # Native format; converted later
        self.session.set_camera(FRONT)         # Default; user can switch
        self.session.set_autofocus(CONTINUOUS)
        self.session.set_auto_exposure(CONTINUOUS)
        self.session.set_orientation_lock(LANDSCAPE_OR_PORTRAIT)
    
    def on_frame(self, frame: CMSampleBuffer):
        raw = RawFrame(
            pixels=frame.image_buffer,
            timestamp_ms=frame.presentation_timestamp * 1000,
            orientation=device.orientation
        )
        self.pipeline.submit(raw)
```

**Failure Points:**
- Camera permission denied → Show permission request UI with explanation
- Camera occupied by another app → Display error, retry on app foreground
- Thermal throttling reduces camera FPS → Detect via frame timestamp gaps > 50ms, adapt pipeline

---

### Module 2: Frame Preprocessing

**Purpose:** Transform raw camera frame into model-ready input tensor.

| Property | Value |
|---|---|
| **Input** | `RawFrame` |
| **Output** | `PreprocessedFrame { tensor: Float32[1×256×256×3], scale_factors: (sx, sy), padding: (px, py) }` |
| **Latency Budget** | ≤ 3ms |

**Internal Logic:**
```python
def preprocess(raw: RawFrame) -> PreprocessedFrame:
    # 1. Color space conversion (BGRA → RGB)
    rgb = cvt_color(raw.pixels, BGRA2RGB)
    
    # 2. Orientation correction
    rgb = apply_rotation(rgb, raw.orientation)
    
    # 3. Letterbox resize to model input (preserve aspect ratio)
    h, w = rgb.shape[:2]
    model_size = 256  # MoveNet/MediaPipe input size
    scale = min(model_size / h, model_size / w)
    new_h, new_w = int(h * scale), int(w * scale)
    resized = resize(rgb, (new_w, new_h), interpolation=BILINEAR)
    
    # 4. Pad to square
    pad_h = (model_size - new_h) // 2
    pad_w = (model_size - new_w) // 2
    padded = pad(resized, top=pad_h, bottom=model_size-new_h-pad_h,
                 left=pad_w, right=model_size-new_w-pad_w, value=128)
    
    # 5. Normalize to [0, 1] or [-1, 1] based on model requirement
    tensor = padded.astype(float32) / 255.0  # [0, 1] for MediaPipe
    
    # 6. Add batch dimension
    tensor = expand_dims(tensor, axis=0)
    
    return PreprocessedFrame(
        tensor=tensor,
        scale_factors=(1.0 / scale, 1.0 / scale),
        padding=(pad_w, pad_h),
        original_size=(w, h)
    )
```

**Failure Points:**
- Corrupt frame data → Skip frame, reuse last valid frame
- Orientation change mid-session → Debounce orientation for 500ms before applying

---

### Module 3: Pose Estimation

**Purpose:** Run neural network inference to produce body landmark predictions.

| Property | Value |
|---|---|
| **Input** | `PreprocessedFrame` |
| **Output** | `RawPose { landmarks: List[RawLandmark], model_confidence: float }` |
| **Model** | MediaPipe Pose (BlazePose GHUM 33-point) |
| **Inference Runtime** | TFLite (Android), Core ML (iOS), ONNX Runtime (Web) |
| **Latency Budget** | ≤ 30ms |

```python
@dataclass
class RawLandmark:
    x: float      # Normalized [0, 1] in model input space
    y: float      # Normalized [0, 1] in model input space
    z: float      # Relative depth (normalized, not metric)
    visibility: float  # [0, 1] confidence of visibility
    index: int    # Landmark index (0–32)
```

**Internal Logic:**
```python
class PoseEstimator:
    def __init__(self):
        self.interpreter = load_tflite_model("blazepose_heavy.tflite")
        # OR
        self.interpreter = load_coreml_model("BlazePose.mlmodel")
    
    def infer(self, frame: PreprocessedFrame) -> RawPose:
        # Run inference
        output = self.interpreter.invoke(frame.tensor)
        
        # Parse output tensor: shape [1, 33, 5] → (x, y, z, visibility, presence)
        landmarks = []
        for i in range(33):
            landmarks.append(RawLandmark(
                x=output[0, i, 0],
                y=output[0, i, 1],
                z=output[0, i, 2],
                visibility=sigmoid(output[0, i, 3]),
                index=i
            ))
        
        # Overall confidence: mean visibility of core landmarks (shoulders, hips)
        core_indices = [11, 12, 23, 24]
        model_confidence = mean([landmarks[i].visibility for i in core_indices])
        
        return RawPose(landmarks=landmarks, model_confidence=model_confidence)
```

**Failure Points:**
- Model inference timeout (>60ms) → Return last valid pose with degraded confidence flag
- Model returns NaN values → Discard frame, use temporal interpolation from last 2 valid frames
- All landmark visibilities < 0.3 → Trigger "person not detected" state

---

### Module 4: Landmark Normalization

**Purpose:** Transform raw model-space landmarks to consistent coordinate systems for downstream use.

| Property | Value |
|---|---|
| **Input** | `RawPose`, `PreprocessedFrame.scale_factors`, `PreprocessedFrame.padding` |
| **Output** | `NormalizedPose { landmarks: List[NormalizedLandmark] }` |
| **Latency Budget** | ≤ 1ms |

```python
@dataclass
class NormalizedLandmark:
    pixel_x: float    # Pixel coordinates in original frame
    pixel_y: float
    norm_x: float     # Body-relative normalized [0, 1]
    norm_y: float
    depth_z: float    # Normalized relative depth
    visibility: float
    index: int

def normalize_landmarks(raw_pose, scale_factors, padding, original_size):
    sx, sy = scale_factors
    px, py = padding
    w, h = original_size
    
    normalized = []
    for lm in raw_pose.landmarks:
        # Remove padding and scale back to original pixel space
        pixel_x = (lm.x * 256 - px) * sx
        pixel_y = (lm.y * 256 - py) * sy
        
        # Body-relative normalization (using hip-center as origin, shoulder-hip distance as scale)
        # Computed after all landmarks are in pixel space
        norm_x = pixel_x / w  # Temporary; body-relative computed below
        norm_y = pixel_y / h
        
        normalized.append(NormalizedLandmark(
            pixel_x=pixel_x, pixel_y=pixel_y,
            norm_x=norm_x, norm_y=norm_y,
            depth_z=lm.z, visibility=lm.visibility,
            index=lm.index
        ))
    
    # Body-relative normalization
    hip_center_x = (normalized[23].pixel_x + normalized[24].pixel_x) / 2
    hip_center_y = (normalized[23].pixel_y + normalized[24].pixel_y) / 2
    shoulder_center_y = (normalized[11].pixel_y + normalized[12].pixel_y) / 2
    torso_length = abs(shoulder_center_y - hip_center_y)
    
    if torso_length > 10:  # Minimum threshold to avoid division instability
        for lm in normalized:
            lm.norm_x = (lm.pixel_x - hip_center_x) / torso_length
            lm.norm_y = (lm.pixel_y - hip_center_y) / torso_length
    
    return NormalizedPose(landmarks=normalized)
```

---

### Module 5: Feature Extraction

**Purpose:** Compute biomechanically meaningful features from normalized landmarks.

| Property | Value |
|---|---|
| **Input** | `NormalizedPose` |
| **Output** | `FeatureSet { joint_angles, body_metrics, limb_vectors }` |
| **Latency Budget** | ≤ 3ms |

```python
@dataclass
class FeatureSet:
    joint_angles: Dict[str, float]           # e.g., {"left_elbow": 142.3, ...}
    body_metrics: Dict[str, float]           # e.g., {"torso_lean": 12.5, "hip_symmetry": 0.95}
    limb_vectors: Dict[str, Tuple[float, float]]  # Unit vectors for each limb segment
    limb_ratios: Dict[str, float]            # Proportional ratios for anthropometric adaptation
```

---

### Module 6: Joint Angle Engine

**Purpose:** Compute angles at each anatomical joint using vector math.

| Property | Value |
|---|---|
| **Input** | `NormalizedPose.landmarks` |
| **Output** | `Dict[str, float]` — joint name → angle in degrees |
| **Latency Budget** | ≤ 2ms |

*(Full mathematical derivation in Section 7)*

**Joint definitions (triplets: proximal–joint–distal):**

```python
JOINT_DEFINITIONS = {
    "left_elbow":    (11, 13, 15),  # shoulder–elbow–wrist
    "right_elbow":   (12, 14, 16),
    "left_shoulder":  (13, 11, 23),  # elbow–shoulder–hip
    "right_shoulder": (14, 12, 24),
    "left_hip":      (11, 23, 25),  # shoulder–hip–knee
    "right_hip":     (12, 24, 26),
    "left_knee":     (23, 25, 27),  # hip–knee–ankle
    "right_knee":    (24, 26, 28),
    "left_ankle":    (25, 27, 29),  # knee–ankle–heel
    "right_ankle":   (26, 28, 30),
}
```

---

### Module 7: Temporal Modeling

*(Detailed in Section 7.2)*

| Property | Value |
|---|---|
| **Input** | Current `FeatureSet` + history buffer (last N frames) |
| **Output** | `SmoothedFeatureSet` with denoised angles and velocities |
| **Buffer Size** | 5–10 frames (configurable) |

---

### Module 8: Exercise Classification

*(Detailed in Section 8)*

| Property | Value |
|---|---|
| **Input** | `SmoothedFeatureSet` + temporal window (last 2s of features) |
| **Output** | `ExerciseID` + confidence score |

---

### Module 9: State Machine

*(Detailed in Section 9)*

| Property | Value |
|---|---|
| **Input** | `ExerciseID`, `SmoothedFeatureSet`, current state |
| **Output** | `ExerciseState { phase, rep_count, phase_progress }` |

---

### Module 10: Form Validation Engine

*(Detailed in Section 10)*

| Property | Value |
|---|---|
| **Input** | `SmoothedFeatureSet`, `ExerciseState`, `ExerciseID` |
| **Output** | `FormScore` |

---

### Module 11: Feedback System

*(Detailed in Section 11)*

| Property | Value |
|---|---|
| **Input** | `FormScore`, `ExerciseState` |
| **Output** | `FeedbackPacket { skeleton_colors, message, audio_cue }` |

---

### Module 12: Rendering Layer

| Property | Value |
|---|---|
| **Input** | `FeedbackPacket`, `NormalizedPose` (pixel coordinates), camera preview frame |
| **Output** | Composited frame with skeleton overlay, feedback text, and UI elements |
| **Latency Budget** | ≤ 8ms |

**Rendering Pipeline:**
```
Camera Preview (background layer, 30 FPS)
    ↓
Skeleton Overlay (mid layer, synced to pose output)
    ↓
Feedback Text + Score HUD (top layer, updated per pose frame)
    ↓
Composited Output → Display
```

---

### Module 13: Data Logging

| Property | Value |
|---|---|
| **Input** | `FormScore`, `ExerciseState`, `SmoothedFeatureSet` per frame |
| **Output** | Persisted session log (SQLite) |
| **Mode** | Async write — never blocks pipeline |

```python
# Session log schema
CREATE TABLE session_frames (
    frame_id INTEGER PRIMARY KEY,
    session_id TEXT,
    timestamp_ms REAL,
    exercise_id TEXT,
    phase TEXT,
    rep_number INTEGER,
    overall_score REAL,
    color TEXT,
    joint_angles_json TEXT,    -- Serialized Dict
    errors_json TEXT,          -- Serialized List[FormError]
    landmark_positions_json TEXT  -- Optional, for replay
);

CREATE TABLE session_summary (
    session_id TEXT PRIMARY KEY,
    start_time TEXT,
    end_time TEXT,
    exercises_json TEXT,       -- List of {exercise_id, total_reps, avg_score}
    total_reps INTEGER,
    avg_form_score REAL,
    duration_seconds REAL
);
```

---

# 5. Technology Stack Decisions

## 5.1 Pose Estimation Model: Critical Evaluation

### Comparison Matrix

| Criteria | MediaPipe Pose | OpenPose | MoveNet Thunder | MoveNet Lightning |
|---|---|---|---|---|
| **Landmarks** | 33 (full body + hands/feet) | 18 (body only) | 17 (body only) | 17 (body only) |
| **Accuracy (mAP)** | 68.3 (COCO) | 65.2 (COCO) | 72.0 (COCO) | 67.5 (COCO) |
| **Mobile Inference** | 15–25ms (GPU delegate) | Not feasible (>500ms) | 20–35ms (GPU delegate) | 8–15ms (GPU delegate) |
| **Model Size** | 3.4MB (lite) / 6.1MB (full) | 200MB+ | 7.8MB | 3.0MB |
| **3D Landmarks** | Yes (relative depth z) | No | No | No |
| **Hand/Foot Detail** | Yes (finger tips, heels) | No | No | No |
| **Temporal Consistency** | Good (built-in tracking) | Poor (per-frame) | Moderate | Moderate |
| **Platform Support** | iOS, Android, Web, Python | Python, C++ | TFLite, TF.js | TFLite, TF.js |
| **Occlusion Handling** | Moderate (visibility scores) | Poor | Moderate | Poor |
| **Multi-person** | No (single person) | Yes | Yes (with crop) | Yes (with crop) |

### Analysis

**OpenPose: ELIMINATED**
- Model size (200MB+) is prohibitive for mobile deployment
- No mobile-optimized inference path
- 18 landmarks insufficient (no heel, foot, or hand detail needed for deadlift/squat foot tracking)
- No active mobile maintenance

**MoveNet Lightning: ELIMINATED for primary; viable as fallback**
- Only 17 landmarks — missing heel, foot index, and hand detail critical for squat depth and push-up wrist alignment
- Lower accuracy (67.5 mAP) increases form validation noise
- No depth (z) information
- Viable as a performance fallback on low-end devices

**MoveNet Thunder: STRONG CANDIDATE**
- Highest raw accuracy (72.0 mAP)
- 17 landmarks is limiting but adequate for core exercises
- No z-depth limits push-up and squat analysis to 2D
- Larger model size (7.8MB) acceptable

**MediaPipe Pose: SELECTED**
- 33 landmarks provide critical detail: heel position for squat depth, foot angle for stance width, wrist detail for grip analysis
- Relative depth (z) enables basic 3D analysis (e.g., knee tracking in frontal plane during squats)
- Built-in temporal tracking reduces jitter without external smoothing
- 3.4MB lite model fits within size budget
- Native SDKs for iOS, Android, and Web (via MediaPipe Tasks)
- Visibility scores per landmark enable confidence-aware form validation
- Active Google maintenance and optimization

### Final Selection

> **Primary Model:** MediaPipe Pose (BlazePose Heavy/Full)  
> **Fallback Model:** MoveNet Lightning (for devices failing performance threshold)  
> **Rationale:** 33 landmarks + z-depth + built-in tracking + cross-platform SDK + active maintenance

## 5.2 On-Device vs. Cloud Inference

| Criteria | On-Device | Cloud |
|---|---|---|
| **Latency** | 15–30ms | 100–500ms (network RTT) |
| **Privacy** | Full — no video leaves device | Video uploaded to server |
| **Offline Support** | Full | None |
| **Cost** | Zero marginal cost | $0.01–$0.05 per session (GPU compute) |
| **Accuracy** | Limited by device GPU | Can use larger, more accurate models |
| **Battery** | Higher drain (local compute) | Lower drain (network only) |
| **Consistency** | Varies by device | Consistent |

**Decision: ON-DEVICE**

Rationale:
1. Sub-100ms latency is non-negotiable for real-time feedback; cloud adds 100–300ms
2. Privacy is a major user concern (camera feed of body)
3. Offline gym use case (many gyms have poor connectivity)
4. Zero marginal cost enables freemium model
5. MediaPipe Pose achieves sufficient accuracy on-device

## 5.3 Application Framework

| Criteria | React Native | Flutter | Native (Swift + Kotlin) |
|---|---|---|---|
| **Camera Access** | Via libraries (limited control) | Via plugins (moderate control) | Full native API access |
| **ML Integration** | TFLite via bridge (latency overhead) | TFLite via platform channels | Direct TFLite/CoreML integration |
| **Rendering Performance** | JS bridge overhead for overlay | Skia engine (good) | Metal/Vulkan (best) |
| **Development Speed** | Fast (single codebase) | Fast (single codebase) | Slow (two codebases) |
| **Real-time Performance** | Poor (JS thread contention) | Good (compiled AOT) | Best (zero overhead) |

**Decision: FLUTTER (Primary) with Platform Channels for ML**

Rationale:
1. Single codebase for iOS + Android reduces development cost by ~40%
2. Skia/Impeller rendering engine handles 2D skeleton overlay at 60 FPS
3. Platform channels allow native TFLite (Android) and Core ML (iOS) inference with zero JS bridge overhead
4. Camera access via `camera` package with raw frame callbacks
5. Dart's ahead-of-time compilation provides near-native performance for business logic
6. Large ecosystem and community for rapid development

**Architecture:**
```
┌─────────────────────────────────────┐
│           Flutter (Dart)             │
│  UI Rendering, State Management,    │
│  Business Logic, Analytics          │
├──────────┬──────────────────────────┤
│ Platform │  Native Code             │
│ Channel  │  ┌─────────┬──────────┐ │
│          │  │ Android  │   iOS    │ │
│          │  │ TFLite   │ Core ML  │ │
│          │  │ CameraX  │ AVFound. │ │
│          │  └─────────┴──────────┘ │
└──────────┴──────────────────────────┘
```

## 5.4 Rendering Strategy

| Strategy | Pros | Cons | Verdict |
|---|---|---|---|
| **Flutter Canvas (CustomPainter)** | Native Flutter, easy to implement, hardware accelerated via Skia | Limited to 2D, no shader effects | ✅ **Selected** |
| **OpenGL ES / Metal** | Maximum performance, custom shaders | Complex, platform-specific, overkill for 2D overlay | ❌ Over-engineered |
| **HTML Canvas (Web)** | Cross-platform web | Not applicable to mobile | ❌ Web-only |
| **Flutter Flame** | Game engine features | Too heavy for simple overlay | ❌ Overhead |

**Decision: Flutter CustomPainter**

The skeleton overlay is a 2D rendering task (lines + circles + text). Flutter's `CustomPainter` with Skia backend renders this at 60 FPS with negligible overhead. No need for OpenGL/Metal complexity.

```dart
class SkeletonPainter extends CustomPainter {
  final NormalizedPose pose;
  final FeedbackPacket feedback;
  
  @override
  void paint(Canvas canvas, Size size) {
    // Draw skeleton connections
    for (final connection in SKELETON_CONNECTIONS) {
      final start = pose.landmarks[connection.startIdx];
      final end = pose.landmarks[connection.endIdx];
      
      if (start.visibility < 0.5 || end.visibility < 0.5) continue;
      
      final color = feedback.getConnectionColor(connection);
      final paint = Paint()
        ..color = color
        ..strokeWidth = 4.0
        ..strokeCap = StrokeCap.round;
      
      canvas.drawLine(
        Offset(start.pixelX * size.width, start.pixelY * size.height),
        Offset(end.pixelX * size.width, end.pixelY * size.height),
        paint,
      );
    }
    
    // Draw landmark points
    for (final lm in pose.landmarks) {
      if (lm.visibility < 0.5) continue;
      final color = feedback.getLandmarkColor(lm.index);
      canvas.drawCircle(
        Offset(lm.pixelX * size.width, lm.pixelY * size.height),
        6.0,
        Paint()..color = color,
      );
    }
  }
}
```

## 5.5 Data Storage

| Component | Technology | Rationale |
|---|---|---|
| Session data | SQLite (via `sqflite`) | Structured relational data, mature, zero-config |
| User preferences | SharedPreferences | Key-value pairs, trivial data |
| Model files | Asset bundle + on-demand download | Models ship with app; updates fetched OTA |
| Analytics export | JSON/CSV export | User-facing data portability |

## 5.6 Final Technology Stack Summary

```
┌─────────────────────────────────────────────────┐
│                GYMONIC TECH STACK                 │
├─────────────────┬───────────────────────────────┤
│ Pose Model      │ MediaPipe Pose (BlazePose)     │
│ Fallback Model  │ MoveNet Lightning              │
│ Inference       │ On-device (TFLite / Core ML)   │
│ App Framework   │ Flutter (Dart)                 │
│ ML Bridge       │ Platform Channels (native)     │
│ Rendering       │ Flutter CustomPainter (Skia)   │
│ Camera          │ CameraX (Android) / AV (iOS)   │
│ Storage         │ SQLite + SharedPreferences     │
│ State Mgmt      │ Riverpod / Bloc               │
│ Audio           │ just_audio + flutter_tts       │
│ Charts          │ fl_chart                       │
│ Web Prototype   │ MediaPipe Tasks JS + Canvas    │
└─────────────────┴───────────────────────────────┘
```

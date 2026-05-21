# GYMONIC — Sections 14–15: Performance Engineering & Edge Case Handling

---

# 14. Performance Engineering

## 14.1 Latency Optimization Strategies

### 14.1.1 Pipeline Parallelism

Decouple camera preview rendering from pose processing:

```
Thread 1 (UI): Camera Preview → Render Overlay (30 FPS constant)
Thread 2 (ML): Frame → Preprocess → Pose Inference → Angle Computation → Form Validation
Thread 3 (IO): Data Logging (async writes)

Communication: Thread 2 posts results to Thread 1 via message queue.
Thread 1 always renders the latest available result (may lag 1–2 frames).
```

```python
class PipelineOrchestrator:
    def __init__(self):
        self.latest_result = AtomicReference(None)  # Lock-free
        self.ml_thread = MLProcessingThread(self.latest_result)
        self.io_thread = IOThread()
    
    def on_camera_frame(self, frame: RawFrame):
        # Submit to ML thread (non-blocking; drops frame if ML is busy)
        if self.ml_thread.is_available():
            self.ml_thread.submit(frame)
        # else: frame dropped — camera preview still renders
    
    def get_latest_feedback(self) -> Optional[FeedbackPacket]:
        return self.latest_result.get()
```

### 14.1.2 Model Optimization

| Technique | Latency Reduction | Accuracy Impact | Applied? |
|---|---|---|---|
| INT8 Quantization | 30–50% faster | -0.5% mAP | ✅ Yes (primary) |
| FP16 (Half precision) | 15–25% faster | -0.1% mAP | ✅ Yes (GPU delegate) |
| Model pruning (50%) | 20–35% faster | -1.5% mAP | ❌ Not worth accuracy loss |
| Knowledge distillation | Custom | Varies | 🔲 Phase 2 (custom model) |
| NNAPI / Core ML delegate | 20–40% faster | None | ✅ Yes |

```python
# TFLite optimization configuration
def create_optimized_interpreter():
    options = tflite.InterpreterOptions()
    
    # GPU delegate (preferred)
    gpu_delegate = tflite.GpuDelegate(options={
        'allow_precision_loss': True,  # Enable FP16
        'wait_type': 'passive',        # Lower latency
    })
    options.add_delegate(gpu_delegate)
    
    # Fallback: NNAPI (Android) or Core ML (iOS)
    if platform.is_android:
        nnapi = tflite.NnApiDelegate()
        options.add_delegate(nnapi)
    
    # Thread configuration
    options.num_threads = 2  # Balance between speed and CPU contention
    
    interpreter = tflite.Interpreter(
        model_path='blazepose_int8.tflite',
        options=options
    )
    interpreter.allocate_tensors()
    return interpreter
```

### 14.1.3 Frame Rate Stabilization

```python
class FPSStabilizer:
    """Dynamically adjust processing load to maintain target FPS."""
    
    def __init__(self, target_fps=15):
        self.target_fps = target_fps
        self.target_interval = 1000.0 / target_fps
        self.recent_inference_times = deque(maxlen=30)
        self.current_mode = ProcessingMode.FULL
    
    def record_inference(self, inference_ms: float):
        self.recent_inference_times.append(inference_ms)
        avg = sum(self.recent_inference_times) / len(self.recent_inference_times)
        
        if avg > self.target_interval * 1.2:
            self._downgrade()
        elif avg < self.target_interval * 0.6 and self.current_mode != ProcessingMode.FULL:
            self._upgrade()
    
    def _downgrade(self):
        transitions = {
            ProcessingMode.FULL: ProcessingMode.SKIP_FRAMES,       # Process every 2nd
            ProcessingMode.SKIP_FRAMES: ProcessingMode.LITE_MODEL, # Switch to lighter model
            ProcessingMode.LITE_MODEL: ProcessingMode.MINIMAL,     # Reduce landmarks checked
        }
        self.current_mode = transitions.get(self.current_mode, ProcessingMode.MINIMAL)
    
    def _upgrade(self):
        transitions = {
            ProcessingMode.MINIMAL: ProcessingMode.LITE_MODEL,
            ProcessingMode.LITE_MODEL: ProcessingMode.SKIP_FRAMES,
            ProcessingMode.SKIP_FRAMES: ProcessingMode.FULL,
        }
        self.current_mode = transitions.get(self.current_mode, ProcessingMode.FULL)
```

## 14.2 Memory Optimization

| Component | Unoptimized | Optimized | Strategy |
|---|---|---|---|
| Camera frame buffer | 1280×720×4 × 5 = 18.4MB | 1280×720×4 × 2 = 7.4MB | Double-buffer instead of 5-deep |
| Pose model | 6.1MB (FP32) | 3.4MB (INT8) | Quantization |
| Landmark history | Unbounded | 10 frames × 33 × 5 floats = 6.6KB | Fixed-size ring buffer |
| Session log buffer | Unbounded in RAM | Flush to SQLite every 10 reps | Periodic persist |
| **Total peak** | **~80MB** | **~25MB** | |

## 14.3 Battery Optimization

```python
class BatteryManager:
    def __init__(self):
        self.session_start_battery = get_battery_level()
        self.drain_rate_per_min = 0
    
    def update(self, elapsed_minutes: float):
        current = get_battery_level()
        self.drain_rate_per_min = (self.session_start_battery - current) / max(1, elapsed_minutes)
        
        # Warn if drain rate exceeds 0.5%/min (15% per 30-min session threshold)
        if self.drain_rate_per_min > 0.5:
            self._enable_power_saving()
    
    def _enable_power_saving(self):
        # Reduce camera resolution to 640×480
        # Reduce processing FPS to 10
        # Dim overlay (reduce rendering complexity)
        # Disable audio feedback (speaker uses significant power)
        pass
```

## 14.4 Thermal Management

```python
class ThermalMonitor:
    THERMAL_WARNING_TEMP = 38.0   # °C — start reducing load
    THERMAL_CRITICAL_TEMP = 42.0  # °C — aggressive reduction
    
    def check(self) -> ThermalAction:
        temp = get_cpu_temperature()  # Platform-specific API
        
        if temp is None:
            # Fallback: detect thermal throttling via FPS drop
            return self._detect_throttling_by_fps()
        
        if temp >= self.THERMAL_CRITICAL_TEMP:
            return ThermalAction.AGGRESSIVE_REDUCE  # 10 FPS, lite model
        elif temp >= self.THERMAL_WARNING_TEMP:
            return ThermalAction.MODERATE_REDUCE     # 15 FPS, skip frames
        else:
            return ThermalAction.NORMAL
```

---

# 15. Edge Case Handling

## 15.1 Occlusion (Equipment Blocking Joints)

| Occlusion Scenario | Affected Landmarks | Detection | Mitigation |
|---|---|---|---|
| Dumbbell blocks wrist | 15, 16 (wrists) | visibility < 0.5 | Use elbow position + forearm vector to infer wrist |
| Barbell blocks torso | 11, 12 (shoulders) | visibility drops during deadlift | Use hip + neck position to estimate shoulder line |
| Body self-occlusion (arm behind torso) | Varies | One-side visibility drop | Mirror from visible side (bilateral symmetry assumption) |
| Bench blocks lower body | 23–28 (hips, knees, ankles) | Multiple lower landmarks invisible | Switch to upper-body-only mode |
| Mirror reflection creates ghost | False person detection | Two similar skeletons detected | Use person-locking (§F in Assumptions doc) |

```python
class OcclusionCompensator:
    def compensate(self, landmarks: List[Landmark], exercise_id: str) -> List[Landmark]:
        compensated = list(landmarks)  # Copy
        
        # Strategy 1: Bilateral mirror
        # If left wrist is occluded but right is visible (or vice versa)
        mirror_pairs = [(15, 16), (13, 14), (11, 12), (25, 26), (27, 28), (23, 24)]
        for left_idx, right_idx in mirror_pairs:
            if (compensated[left_idx].visibility < 0.3 and 
                compensated[right_idx].visibility > 0.6):
                # Mirror right to left (flip x around body center)
                center_x = (compensated[23].x + compensated[24].x) / 2
                compensated[left_idx] = compensated[right_idx].copy()
                compensated[left_idx].x = 2 * center_x - compensated[right_idx].x
                compensated[left_idx].visibility = compensated[right_idx].visibility * 0.5
            elif (compensated[right_idx].visibility < 0.3 and 
                  compensated[left_idx].visibility > 0.6):
                center_x = (compensated[23].x + compensated[24].x) / 2
                compensated[right_idx] = compensated[left_idx].copy()
                compensated[right_idx].x = 2 * center_x - compensated[left_idx].x
                compensated[right_idx].visibility = compensated[left_idx].visibility * 0.5
        
        # Strategy 2: Temporal hold (use last known position)
        # Handled by OcclusionHandler in §6.4.3
        
        return compensated
```

## 15.2 Camera Angle Variability

| Angle | Challenge | Handling |
|---|---|---|
| Frontal (0°) | Cannot measure sagittal angles (e.g., squat depth) | Detect via shoulder ratio; warn user to rotate |
| Sagittal (90°) | Cannot measure frontal angles (e.g., knee valgus) | Use only sagittal-plane rules |
| Oblique (30–60°) | All angles distorted by perspective | Apply perspective correction factor |
| From below | Foreshortening of legs | Warn user; adjust thresholds |
| From above | Foreshortening of torso | Warn user; adjust thresholds |

```python
class PerspectiveCorrector:
    def estimate_view_angle(self, landmarks) -> ViewAngle:
        """Determine camera viewing angle from landmark geometry."""
        l_shoulder = landmarks[11]
        r_shoulder = landmarks[12]
        
        dx = abs(l_shoulder.x - r_shoulder.x)
        dz = abs(l_shoulder.z - r_shoulder.z)
        
        # Ratio of apparent width to depth indicates viewing angle
        if dx > 0.15:
            return ViewAngle.FRONTAL
        elif dx < 0.05:
            return ViewAngle.SAGITTAL
        else:
            return ViewAngle.OBLIQUE
    
    def get_applicable_rules(self, view: ViewAngle, exercise_id: str) -> List[str]:
        """Only validate rules that are measurable from current view."""
        VIEW_RULE_MAP = {
            ("squat", ViewAngle.SAGITTAL): ["squat_depth", "squat_torso_lean", "squat_heel_rise"],
            ("squat", ViewAngle.FRONTAL): ["squat_knee_valgus", "squat_symmetry"],
            ("squat", ViewAngle.OBLIQUE): ["squat_depth", "squat_knee_valgus"],  # Partial
            ("bicep_curl", ViewAngle.SAGITTAL): ["curl_elbow_rom", "curl_shoulder_swing", "curl_torso_lean"],
            ("bicep_curl", ViewAngle.FRONTAL): ["curl_elbow_drift", "curl_wrist_neutral"],
        }
        return VIEW_RULE_MAP.get((exercise_id, view), [])
```

## 15.3 Partial Body Visibility

```python
class VisibilityModeSelector:
    def select_mode(self, landmarks) -> AnalysisMode:
        upper_visible = all(landmarks[i].visibility > 0.4 for i in [11, 12, 13, 14, 15, 16])
        lower_visible = all(landmarks[i].visibility > 0.4 for i in [23, 24, 25, 26, 27, 28])
        
        if upper_visible and lower_visible:
            return AnalysisMode.FULL_BODY
        elif upper_visible and not lower_visible:
            return AnalysisMode.UPPER_BODY_ONLY
            # Can still analyze: bicep curl, lateral raise, shoulder press
        elif lower_visible and not upper_visible:
            return AnalysisMode.LOWER_BODY_ONLY
            # Can still analyze: squat (partially), lunges
        else:
            return AnalysisMode.INSUFFICIENT
            # Show "Step back to show full body" warning
```

## 15.4 Lighting Inconsistencies

```python
class LightingAdapter:
    def assess_lighting(self, frame: RawFrame) -> LightingQuality:
        gray = to_grayscale(frame.pixels)
        mean_brightness = gray.mean()
        std_brightness = gray.std()
        
        if mean_brightness < 40:
            return LightingQuality.TOO_DARK
        elif mean_brightness > 240:
            return LightingQuality.TOO_BRIGHT
        elif std_brightness < 15:
            return LightingQuality.LOW_CONTRAST
        else:
            return LightingQuality.ADEQUATE
    
    def get_user_guidance(self, quality: LightingQuality) -> Optional[str]:
        guidance = {
            LightingQuality.TOO_DARK: "💡 It's too dark. Turn on more lights for better tracking.",
            LightingQuality.TOO_BRIGHT: "☀️ Too much glare. Move away from direct light.",
            LightingQuality.LOW_CONTRAST: "🔲 Low contrast — wear clothing that contrasts with background.",
        }
        return guidance.get(quality)
```

## 15.5 Background Noise (Other People, Mirrors)

| Issue | Detection | Mitigation |
|---|---|---|
| Other people in frame | Multiple person detections | Person-locking system (§F in Assumptions) |
| Mirror reflection | Symmetric duplicate detection | Compare detection positions; filter duplicates where Δx > 0.5 × frame_width |
| Moving background objects | False landmark detections on non-human objects | Confidence threshold + temporal consistency check |
| TV/screen showing exercise video | Second person detection from screen | Screen reflections have lower z-depth variation; filter by depth consistency |

## 15.6 Edge Case Decision Matrix

```python
class EdgeCaseHandler:
    """Central handler that coordinates all edge case responses."""
    
    def evaluate(self, frame_context: FrameContext) -> List[EdgeCaseAction]:
        actions = []
        
        # Priority-ordered checks
        if frame_context.pose_confidence < 0.3:
            actions.append(EdgeCaseAction.PAUSE_ANALYSIS)
            actions.append(EdgeCaseAction.SHOW_WARNING("Step into the frame"))
            return actions  # Don't check further
        
        if frame_context.lighting != LightingQuality.ADEQUATE:
            actions.append(EdgeCaseAction.SHOW_WARNING(
                self.lighting_adapter.get_user_guidance(frame_context.lighting)))
        
        if frame_context.visibility_mode == AnalysisMode.INSUFFICIENT:
            actions.append(EdgeCaseAction.SHOW_WARNING("Step back to show full body"))
            actions.append(EdgeCaseAction.PAUSE_ANALYSIS)
        elif frame_context.visibility_mode != AnalysisMode.FULL_BODY:
            actions.append(EdgeCaseAction.REDUCE_RULES(frame_context.visibility_mode))
        
        if frame_context.camera_moving:
            actions.append(EdgeCaseAction.SHOW_WARNING("Place phone on stable surface"))
            actions.append(EdgeCaseAction.PAUSE_ANALYSIS)
        
        if frame_context.thermal_action != ThermalAction.NORMAL:
            actions.append(EdgeCaseAction.REDUCE_PROCESSING(frame_context.thermal_action))
        
        return actions
```

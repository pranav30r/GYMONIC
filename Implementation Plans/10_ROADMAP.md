# GYMONIC — Sections 16–17: Development Roadmap & Testing Strategy

---

# 16. Development Roadmap

## 16.1 Phase Overview

```
Phase 0: PROTOTYPE (Weeks 1–4)     → Prove it works
Phase 1: MVP (Weeks 5–12)          → Ship to first users
Phase 2: PRODUCTION (Weeks 13–24)  → Scale and polish
Phase 3: GROWTH (Weeks 25+)        → Expand and monetize
```

---

## 16.2 Phase 0: Prototype (Weeks 1–4)

**Goal:** Validate core technical feasibility — can we detect pose, compute angles, and provide real-time feedback at acceptable latency on a smartphone?

### Milestones & Deliverables

| Week | Milestone | Deliverable | Dependencies |
|---|---|---|---|
| 1 | Pose estimation running on device | Flutter app showing camera + MediaPipe skeleton overlay | Flutter SDK, MediaPipe Tasks SDK |
| 2 | Joint angle engine working | Display live joint angles on screen (elbow, knee, hip) | §7 math engine |
| 2 | Temporal smoothing integrated | Smooth angle display without jitter | One-Euro Filter impl |
| 3 | Bicep curl state machine | Rep counting for bicep curls with color feedback | §9 FSM for bicep curl |
| 3 | Basic form validation | Green/red elbow color based on 2 rules | §10 curl rules (elbow_drift, ROM) |
| 4 | End-to-end prototype demo | Full loop: camera → pose → angles → FSM → form score → colored skeleton | All above |

### Success Criteria (Phase 0 Gate)
- [ ] Pose estimation runs at ≥ 15 FPS on target device (e.g., Pixel 7)
- [ ] Elbow angle accuracy ≤ 8° vs manual measurement
- [ ] Rep counting ≥ 90% accurate across 10 sets of curls
- [ ] End-to-end latency < 120ms (relaxed for prototype)
- [ ] Form feedback color is subjectively correct (demo to 5 people)

---

## 16.3 Phase 1: MVP (Weeks 5–12)

**Goal:** Ship a usable app with 3 exercises, form validation, session analytics, and polished UI.

### Milestones & Deliverables

| Week | Milestone | Deliverable |
|---|---|---|
| 5 | Squat + Push-up FSMs | State machines for all 3 MVP exercises |
| 6 | Full form validation rules | All rules from §10 for curl, squat, push-up |
| 6 | User calibration flow | T-pose calibration screen with limb ratio extraction |
| 7 | Feedback system complete | Color skeleton + text messages + audio cues |
| 7 | Input validation | Camera checks, lighting warnings, person detection |
| 8 | Session analytics | Rep scores, session summary screen, basic charts |
| 9 | UI polish | Home screen, exercise selection, settings, onboarding |
| 10 | Edge case handling | Occlusion compensation, partial visibility modes |
| 10 | Failsafe & fallback | Performance tier system, model fallback |
| 11 | Local data persistence | SQLite schema, session history, progress charts |
| 12 | Internal testing & bug fixes | Test across 5+ devices, fix critical bugs |

### Success Criteria (Phase 1 Gate — MVP Launch)
- [ ] 3 exercises fully functional (curl, squat, push-up)
- [ ] Rep counting ≥ 95% accuracy
- [ ] Form error detection precision ≥ 80%
- [ ] End-to-end latency < 100ms on mid-range devices
- [ ] Session data persists and displays correctly
- [ ] App runs crash-free for 30-min sessions
- [ ] Tested on ≥ 10 real users with subjective satisfaction ≥ 7/10

---

## 16.4 Phase 2: Production (Weeks 13–24)

**Goal:** Add remaining exercises, polish UX, prepare for public launch.

| Week | Milestone | Deliverable |
|---|---|---|
| 13–14 | Exercise expansion | Lateral raise, shoulder press, deadlift FSMs + rules |
| 15 | ML exercise classifier | Trained model for auto-detection (hybrid with rules) |
| 16 | Advanced analytics | Long-term trends, personal records, form heatmaps |
| 17 | Adaptive feedback | Error frequency tracking, escalated messages |
| 18 | Performance optimization | INT8 quantization, thermal management, battery optimization |
| 19 | Multi-device testing | Test on 20+ devices (iOS + Android), fix platform issues |
| 20 | Onboarding & tutorials | In-app exercise tutorials, demo mode |
| 21 | App Store preparation | Screenshots, descriptions, privacy policy, store assets |
| 22 | Beta launch | TestFlight / Google Play Beta to 100 users |
| 23–24 | Beta feedback & fixes | Address top issues from beta users |

---

## 16.5 Phase 3: Growth (Weeks 25+)

| Quarter | Focus | Key Features |
|---|---|---|
| Q1 | Public launch | App Store + Play Store release, marketing |
| Q1 | Subscription system | Free tier (2 exercises) + Premium (all exercises + analytics) |
| Q2 | Exercise library expansion | 15+ exercises, user-requested additions |
| Q2 | Social features | Share workouts, leaderboards, challenges |
| Q3 | Personalized coaching | AI-generated workout plans based on form history |
| Q3 | Wearable integration | Apple Watch heart rate, rep counting cross-validation |
| Q4 | AR features | ARKit/ARCore-based visual cues in 3D space |

---

## 16.6 Team Requirements

| Role | Phase 0–1 (MVP) | Phase 2+ (Production) |
|---|---|---|
| Flutter Developer | 1 (full-stack) | 2 (1 iOS specialist, 1 Android) |
| ML Engineer | 1 (pose pipeline) | 1 (model training, optimization) |
| UI/UX Designer | 0.5 (part-time) | 1 |
| Backend (if cloud sync) | 0 | 0.5 |
| QA / Testing | 0 (developer self-test) | 1 |
| Product Manager | Founder | 1 |

**MVP can be built by 1–2 engineers in 12 weeks.**

---

# 17. Testing & Validation Strategy

## 17.1 Testing Pyramid

```
                    ┌──────────┐
                    │  E2E     │  Manual + automated device tests
                    │  Tests   │  (10% of effort)
                   ┌┴──────────┴┐
                   │ Integration │  Pipeline tests (pose → angle → FSM → score)
                   │   Tests     │  (30% of effort)
                  ┌┴─────────────┴┐
                  │   Unit Tests   │  Math engine, FSM logic, scoring functions
                  │                │  (60% of effort)
                  └────────────────┘
```

## 17.2 Unit Tests

### 17.2.1 Joint Angle Computation

```python
class TestJointAngle:
    def test_straight_arm(self):
        # Three collinear points → 180°
        A, B, C = (0, 0), (1, 0), (2, 0)
        assert abs(safe_angle(A, B, C) - 180.0) < 0.01
    
    def test_right_angle(self):
        A, B, C = (0, 1), (0, 0), (1, 0)
        assert abs(safe_angle(A, B, C) - 90.0) < 0.01
    
    def test_acute_angle(self):
        A, B, C = (0, 1), (0, 0), (1, 1)
        assert abs(safe_angle(A, B, C) - 45.0) < 0.1
    
    def test_zero_length_segment(self):
        # Overlapping points → None
        A, B, C = (0, 0), (0, 0), (1, 0)
        assert safe_angle(A, B, C) is None
    
    def test_numerical_stability_near_180(self):
        A, B, C = (0, 0.0001), (1, 0), (2, -0.0001)
        angle = safe_angle(A, B, C)
        assert angle is not None and 179 < angle <= 180
```

### 17.2.2 State Machine Tests

```python
class TestBicepCurlFSM:
    def test_full_rep_cycle(self):
        fsm = create_bicep_curl_fsm()
        # Simulate: START → CONCENTRIC → PEAK → ECCENTRIC → START
        fsm.update({"left_elbow": 165}, t=0)     # START
        assert fsm.current_state == "START"
        
        fsm.update({"left_elbow": 130}, t=100)    # CONCENTRIC
        assert fsm.current_state == "CONCENTRIC"
        
        fsm.update({"left_elbow": 45}, t=500)     # PEAK
        assert fsm.current_state == "PEAK"
        
        fsm.update({"left_elbow": 100}, t=800)    # ECCENTRIC
        assert fsm.current_state == "ECCENTRIC"
        
        fsm.update({"left_elbow": 160}, t=1200)   # START (rep complete)
        assert fsm.current_state == "START"
        assert fsm.rep_count == 1
    
    def test_invalid_transition_rejected(self):
        fsm = create_bicep_curl_fsm()
        fsm.update({"left_elbow": 165}, t=0)       # START
        fsm.update({"left_elbow": 40}, t=100)       # Cannot jump to PEAK
        assert fsm.current_state == "START"          # Should remain
    
    def test_noisy_signal_no_false_reps(self):
        fsm = create_bicep_curl_fsm()
        fsm.update({"left_elbow": 165}, t=0)
        # Simulate jitter around threshold
        for i in range(20):
            angle = 148 + random.uniform(-5, 5)  # Jittering near 150° boundary
            fsm.update({"left_elbow": angle}, t=i * 33)
        assert fsm.rep_count == 0  # No false reps from jitter
```

### 17.2.3 Form Validation Tests

```python
class TestFormScoring:
    def test_perfect_form_scores_100(self):
        score = score_metric(value=40, expected_min=30, expected_max=55, tolerance=10)
        assert score == 100.0
    
    def test_slightly_off_scores_partial(self):
        score = score_metric(value=60, expected_min=30, expected_max=55, tolerance=10)
        assert 40 < score < 100  # 5° outside range with 10° tolerance
    
    def test_far_off_scores_zero(self):
        score = score_metric(value=90, expected_min=30, expected_max=55, tolerance=10)
        assert score == 0.0
```

## 17.3 Integration Tests

```python
class TestPipelineIntegration:
    def test_pose_to_form_score_pipeline(self):
        """Feed a known pose through the full pipeline and verify output."""
        # Create synthetic perfect bicep curl pose (arm at 40°)
        landmarks = create_synthetic_pose(left_elbow_angle=40)
        
        # Run pipeline
        angles = angle_engine.compute_all(landmarks)
        features = feature_extractor.extract(landmarks, angles)
        state = fsm.update(angles, timestamp=0)
        score = validator.validate("bicep_curl", angles, features, state, None)
        
        assert score.overall_score >= 80
        assert score.color == FormColor.GREEN
    
    def test_bad_form_generates_error(self):
        landmarks = create_synthetic_pose(left_elbow_angle=40, elbow_drift=0.3)
        angles = angle_engine.compute_all(landmarks)
        features = feature_extractor.extract(landmarks, angles)
        state = fsm.update(angles, timestamp=0)
        score = validator.validate("bicep_curl", angles, features, state, None)
        
        assert score.color in (FormColor.YELLOW, FormColor.RED)
        assert any(e.error_type == "ALIGNMENT" for e in score.errors)
```

## 17.4 Real-World Testing Scenarios

| Scenario | Setup | What to Validate |
|---|---|---|
| Ideal conditions | Well-lit room, tripod, form tester | Baseline accuracy numbers |
| Dim gym | Commercial gym floor, typical lighting | Pose detection reliability |
| Home gym | Living room, mixed lighting | Background noise handling |
| Outdoor | Park, bright sunlight | Overexposure handling |
| Multiple people | Gym with other members visible | Person-locking accuracy |
| Fast reps | High-speed curls (< 1s/rep) | FSM tracking at speed |
| Heavy weights | Large dumbbells occluding wrists | Occlusion compensation |
| Different body types | Test with 10+ subjects varying height/weight | Calibration and threshold adaptation |
| Different clothing | Loose hoodie, tank top, all-black outfit | Pose detection under clothing variation |
| Different phones | Budget to flagship, iOS + Android | Performance tier adaptation |

## 17.5 Dataset Creation & Labeling

### 17.5.1 Data Collection Protocol

```
For each exercise:
  1. Record 50 subjects performing 10 reps each
  2. Record at 3 camera angles (frontal, sagittal, 45°)
  3. Record with intentional form errors (5 reps correct, 5 reps incorrect per error type)
  4. Record at 2 lighting conditions (bright, dim)
  
  Total per exercise: 50 × 10 × 3 × 2 = 3,000 clips
  Total for 6 exercises: 18,000 clips
```

### 17.5.2 Labeling Schema

```json
{
  "clip_id": "squat_001_frontal_bright",
  "exercise": "squat",
  "subject_id": "s001",
  "camera_angle": "frontal",
  "lighting": "bright",
  "reps": [
    {
      "rep_number": 1,
      "start_frame": 30,
      "end_frame": 90,
      "form_grade": "A",
      "errors": [],
      "depth": "parallel"
    },
    {
      "rep_number": 2,
      "start_frame": 91,
      "end_frame": 155,
      "form_grade": "C",
      "errors": ["knee_valgus", "heel_rise"],
      "depth": "half"
    }
  ]
}
```

## 17.6 Continuous Improvement Loop

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ User Sessions │────▶│ Anonymized   │────▶│ Analysis     │
│ (in-app)     │     │ Telemetry    │     │ Dashboard    │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌──────────────┐              │
                     │ Threshold    │◀─────────────┘
                     │ Tuning       │
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐     ┌──────────────┐
                     │ Config       │────▶│ OTA Config   │
                     │ Update       │     │ Push         │
                     └──────────────┘     └──────────────┘

Metrics tracked:
- False positive rate per rule (users report "incorrect feedback")
- Rep count discrepancy (user manually corrects count)
- Exercise classification confusion matrix
- Session completion rate (do users finish or abandon?)
- Form score distribution (if everyone scores 50, thresholds are too strict)
```

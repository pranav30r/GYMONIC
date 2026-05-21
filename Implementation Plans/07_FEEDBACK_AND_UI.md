# GYMONIC — Sections 11–12: Feedback System & UI/UX Engineering

---

# 11. Real-Time Feedback System

## 11.1 Color Classification Logic

### 11.1.1 Per-Joint Coloring

Each skeleton joint and connection is independently colored based on the relevant form rule:

```python
COLOR_MAP = {
    FormColor.GREEN:  Color(0x4CAF50),   # Correct — #4CAF50
    FormColor.YELLOW: Color(0xFFC107),   # Partial — #FFC107
    FormColor.RED:    Color(0xF44336),   # Incorrect — #F44336
    FormColor.GRAY:   Color(0x9E9E9E),   # Inactive/low confidence — #9E9E9E
}

class FeedbackColorizer:
    def get_joint_color(self, joint_index: int, form_score: FormScore, 
                        exercise_config: ExerciseConfig) -> Color:
        # Find which rule governs this joint
        governing_rules = [r for r in exercise_config.form_rules 
                          if joint_index in r.affected_landmarks]
        
        if not governing_rules:
            return COLOR_MAP[FormColor.GRAY]  # Joint not relevant to current exercise
        
        # Use worst rule score for this joint
        worst_score = min(form_score.joint_scores.get(r.rule_id, 100) 
                         for r in governing_rules)
        
        if worst_score >= 80:
            return COLOR_MAP[FormColor.GREEN]
        elif worst_score >= 50:
            return COLOR_MAP[FormColor.YELLOW]
        else:
            return COLOR_MAP[FormColor.RED]
    
    def get_connection_color(self, start_idx: int, end_idx: int, 
                             form_score: FormScore, config: ExerciseConfig) -> Color:
        # Connection color = worst of its two endpoint colors
        c1 = self.get_joint_color(start_idx, form_score, config)
        c2 = self.get_joint_color(end_idx, form_score, config)
        return c1 if self._severity(c1) > self._severity(c2) else c2
```

### 11.1.2 Skeleton Connection Definitions

```python
SKELETON_CONNECTIONS = [
    # Torso
    (11, 12),  # Left shoulder – Right shoulder
    (11, 23),  # Left shoulder – Left hip
    (12, 24),  # Right shoulder – Right hip
    (23, 24),  # Left hip – Right hip
    # Left arm
    (11, 13),  # Left shoulder – Left elbow
    (13, 15),  # Left elbow – Left wrist
    # Right arm
    (12, 14),  # Right shoulder – Right elbow
    (14, 16),  # Right elbow – Right wrist
    # Left leg
    (23, 25),  # Left hip – Left knee
    (25, 27),  # Left knee – Left ankle
    # Right leg
    (24, 26),  # Right hip – Right knee
    (26, 28),  # Right knee – Right ankle
]
```

## 11.2 Multi-Error Prioritization

When multiple errors occur simultaneously, display only the most important one:

```python
class ErrorPrioritizer:
    # Priority order (highest first)
    PRIORITY = {
        "COMPENSATION": 1,    # Most dangerous — risk of injury
        "ALIGNMENT":    2,    # Structural risk
        "ANGLE":        3,    # Performance issue
        "ROM":          4,    # Effectiveness issue
        "ASYMMETRY":    5,    # Minor issue
        "TEMPO":        6,    # Least critical
    }
    
    COOLDOWN_MS = 3000  # Don't repeat same message within 3 seconds
    
    def __init__(self):
        self.last_message = None
        self.last_message_time = 0
    
    def select_feedback(self, errors: List[FormError], 
                        timestamp_ms: float) -> Optional[FormError]:
        if not errors:
            return None
        
        # Sort by priority then severity
        sorted_errors = sorted(errors, key=lambda e: (
            self.PRIORITY.get(e.error_type, 99),
            -e.severity  # Higher severity first within same type
        ))
        
        top_error = sorted_errors[0]
        
        # Cooldown check: don't spam the same message
        if (top_error.corrective_message == self.last_message and
            timestamp_ms - self.last_message_time < self.COOLDOWN_MS):
            # Try next error
            for error in sorted_errors[1:]:
                if (error.corrective_message != self.last_message or
                    timestamp_ms - self.last_message_time >= self.COOLDOWN_MS):
                    self.last_message = error.corrective_message
                    self.last_message_time = timestamp_ms
                    return error
            return None  # All errors on cooldown
        
        self.last_message = top_error.corrective_message
        self.last_message_time = timestamp_ms
        return top_error
```

## 11.3 Positive Reinforcement

```python
class PositiveFeedback:
    SUSTAINED_GOOD_MS = 5000  # 5 seconds of good form
    COOLDOWN_MS = 15000       # Don't repeat positive feedback too often
    
    def __init__(self):
        self.good_form_start = None
        self.last_positive_time = 0
    
    def check(self, form_score: FormScore, timestamp_ms: float) -> Optional[str]:
        if form_score.overall_score >= 90:
            if self.good_form_start is None:
                self.good_form_start = timestamp_ms
            elif (timestamp_ms - self.good_form_start >= self.SUSTAINED_GOOD_MS and
                  timestamp_ms - self.last_positive_time >= self.COOLDOWN_MS):
                self.good_form_start = timestamp_ms  # Reset
                self.last_positive_time = timestamp_ms
                return random.choice([
                    "Great form! Keep it up! 💪",
                    "Perfect technique!",
                    "Excellent control!",
                    "Nailing it! 🎯"
                ])
        else:
            self.good_form_start = None
        return None
```

## 11.4 Audio Feedback System

```python
class AudioFeedbackManager:
    def __init__(self):
        self.tts_engine = FlutterTTS()
        self.sound_player = AudioPlayer()
        self.audio_enabled = True
        self.last_audio_time = 0
        self.AUDIO_COOLDOWN_MS = 4000  # Min gap between voice prompts
    
    async def play_rep_complete(self):
        """Short chime on rep completion."""
        await self.sound_player.play("assets/sounds/rep_complete.wav")
    
    async def play_correction(self, message: str, timestamp_ms: float):
        """Speak corrective instruction for RED-level errors only."""
        if not self.audio_enabled:
            return
        if timestamp_ms - self.last_audio_time < self.AUDIO_COOLDOWN_MS:
            return
        
        self.last_audio_time = timestamp_ms
        await self.tts_engine.speak(message, rate=1.2)  # Slightly fast for urgency
    
    async def play_positive(self, message: str):
        await self.tts_engine.speak(message, rate=1.0)
    
    async def play_set_complete(self, rep_count: int, avg_score: float):
        msg = f"Set complete! {rep_count} reps. Average form score: {int(avg_score)} percent."
        await self.tts_engine.speak(msg)
```

## 11.5 Adaptive Feedback Loop (User Learning)

```python
class AdaptiveFeedback:
    """Track recurring errors and escalate feedback intensity."""
    
    def __init__(self):
        self.error_history = Counter()  # error_type → count in session
        self.ESCALATION_THRESHOLD = 3  # Same error 3+ times → escalate
    
    def record_error(self, error: FormError):
        self.error_history[error.corrective_message] += 1
    
    def get_escalated_message(self, error: FormError) -> str:
        count = self.error_history[error.corrective_message]
        
        if count < self.ESCALATION_THRESHOLD:
            return error.corrective_message  # Standard message
        elif count < self.ESCALATION_THRESHOLD * 2:
            return f"⚠️ Recurring issue: {error.corrective_message}"
        else:
            return f"🔴 Critical: {error.corrective_message} — consider reducing weight"
    
    def get_session_insights(self) -> List[str]:
        """Post-session: summarize recurring issues."""
        insights = []
        for msg, count in self.error_history.most_common(3):
            insights.append(f"'{msg}' occurred {count} times this session")
        return insights
```

## 11.6 Complete Feedback Packet Assembly

```python
class FeedbackAssembler:
    def __init__(self):
        self.colorizer = FeedbackColorizer()
        self.prioritizer = ErrorPrioritizer()
        self.positive = PositiveFeedback()
        self.audio = AudioFeedbackManager()
        self.adaptive = AdaptiveFeedback()
    
    def assemble(self, form_score: FormScore, pose: NormalizedPose,
                 state: ExerciseState, config: ExerciseConfig) -> FeedbackPacket:
        
        # 1. Joint colors
        joint_colors = {}
        for i in range(33):
            joint_colors[i] = self.colorizer.get_joint_color(i, form_score, config)
        
        # 2. Select primary error message
        error = self.prioritizer.select_feedback(form_score.errors, form_score.timestamp)
        message = None
        if error:
            self.adaptive.record_error(error)
            message = self.adaptive.get_escalated_message(error)
        
        # 3. Check for positive feedback
        positive_msg = self.positive.check(form_score, form_score.timestamp)
        if positive_msg and not message:
            message = positive_msg
        
        # 4. Audio triggers
        audio_cue = None
        if error and form_score.color == FormColor.RED:
            audio_cue = AudioCue(type="correction", message=message)
        
        return FeedbackPacket(
            joint_colors=joint_colors,
            message=message,
            message_color=form_score.color,
            overall_score=form_score.overall_score,
            rep_count=state.rep_count,
            audio_cue=audio_cue,
            phase=state.phase,
            phase_progress=state.phase_progress
        )
```

---

# 12. UI/UX Engineering Specification

## 12.1 Screen Architecture

```
┌─────────────────────────────────────────────────────┐
│  APP SCREENS                                        │
├─────────────────────────────────────────────────────┤
│  1. Home / Dashboard                                │
│  2. Exercise Selection                              │
│  3. Calibration (first-time)                        │
│  4. Pre-Session Setup (camera positioning guide)    │
│  5. Live Session (CORE SCREEN)                      │
│  6. Set Summary (between sets)                      │
│  7. Session Summary (post-workout)                  │
│  8. History / Progress                              │
│  9. Settings                                        │
└─────────────────────────────────────────────────────┘
```

## 12.2 Live Session Screen Layout

```
┌──────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────┐ │
│ │          CAMERA FEED (full screen)       │ │
│ │                                          │ │
│ │    ┌─ Skeleton overlay ──────────────┐   │ │
│ │    │        ○ (head)                 │   │ │
│ │    │       /│\                       │   │ │
│ │    │      / │ \  ← colored lines     │   │ │
│ │    │     ○  │  ○ (shoulders)         │   │ │
│ │    │     │  │  │                     │   │ │
│ │    │     ○  │  ○ (elbows)            │   │ │
│ │    │     │  │  │                     │   │ │
│ │    │     ○  │  ○ (wrists)            │   │ │
│ │    │        │                        │   │ │
│ │    │       / \                       │   │ │
│ │    │      /   \                      │   │ │
│ │    │     ○     ○ (knees)             │   │ │
│ │    │     │     │                     │   │ │
│ │    │     ○     ○ (ankles)            │   │ │
│ │    └─────────────────────────────────┘   │ │
│ │                                          │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────┐                        ┌──────────┐ │
│ │ REPS │                        │  SCORE   │ │
│ │  12  │                        │  87/100  │ │
│ │      │                        │  ████░░  │ │
│ └──────┘                        └──────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │  💬 "Keep your elbows pinned to sides"   │ │
│ └──────────────────────────────────────────┘ │
│         [⏸ Pause]    [⏹ End Set]            │
└──────────────────────────────────────────────┘
```

## 12.3 Skeleton Overlay Rendering

```dart
class SkeletonOverlayPainter extends CustomPainter {
  final NormalizedPose pose;
  final FeedbackPacket feedback;
  final Size frameSize;
  
  @override
  void paint(Canvas canvas, Size size) {
    final scaleX = size.width / frameSize.width;
    final scaleY = size.height / frameSize.height;
    
    // Draw connections (lines between joints)
    for (final conn in SKELETON_CONNECTIONS) {
      final start = pose.landmarks[conn.$1];
      final end = pose.landmarks[conn.$2];
      
      if (start.visibility < 0.5 || end.visibility < 0.5) continue;
      
      final color = feedback.getConnectionColor(conn.$1, conn.$2);
      final paint = Paint()
        ..color = color
        ..strokeWidth = 4.0 * (size.width / 400) // Scale with screen
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke;
      
      // Glow effect for RED connections
      if (color == COLOR_MAP[FormColor.RED]) {
        final glowPaint = Paint()
          ..color = color.withOpacity(0.3)
          ..strokeWidth = 12.0
          ..strokeCap = StrokeCap.round
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, 6);
        canvas.drawLine(
          Offset(start.pixelX * scaleX, start.pixelY * scaleY),
          Offset(end.pixelX * scaleX, end.pixelY * scaleY),
          glowPaint,
        );
      }
      
      canvas.drawLine(
        Offset(start.pixelX * scaleX, start.pixelY * scaleY),
        Offset(end.pixelX * scaleX, end.pixelY * scaleY),
        paint,
      );
    }
    
    // Draw joint points
    for (int i = 0; i < pose.landmarks.length; i++) {
      final lm = pose.landmarks[i];
      if (lm.visibility < 0.5) continue;
      
      final color = feedback.jointColors[i] ?? COLOR_MAP[FormColor.GRAY];
      final radius = 6.0 * (size.width / 400);
      
      // Outer ring
      canvas.drawCircle(
        Offset(lm.pixelX * scaleX, lm.pixelY * scaleY),
        radius,
        Paint()..color = color..style = PaintingStyle.fill,
      );
      // Inner dot (white)
      canvas.drawCircle(
        Offset(lm.pixelX * scaleX, lm.pixelY * scaleY),
        radius * 0.4,
        Paint()..color = Colors.white..style = PaintingStyle.fill,
      );
    }
    
    // Draw angle arc for primary joint (optional visual)
    _drawAngleArc(canvas, size, scaleX, scaleY);
  }
}
```

## 12.4 Feedback Message Display

```dart
class FeedbackBanner extends StatelessWidget {
  final String? message;
  final FormColor color;
  
  @override
  Widget build(BuildContext context) {
    if (message == null) return SizedBox.shrink();
    
    final bgColor = color == FormColor.RED
        ? Colors.red.withOpacity(0.85)
        : color == FormColor.YELLOW
            ? Colors.amber.withOpacity(0.85)
            : Colors.green.withOpacity(0.85);
    
    return AnimatedContainer(
      duration: Duration(milliseconds: 300),
      padding: EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [BoxShadow(color: bgColor.withOpacity(0.4), blurRadius: 12)],
      ),
      child: Text(
        message!,
        style: TextStyle(
          color: Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.w600,
          fontFamily: 'Inter',
        ),
        textAlign: TextAlign.center,
      ),
    );
  }
}
```

## 12.5 User Flow

```
App Launch
    │
    ▼
┌─ Home Dashboard ─┐
│  Recent sessions  │
│  Quick start      │──▶ Exercise Selection
│  Progress charts  │         │
└───────────────────┘         ▼
                      ┌─ Select Exercise ──┐
                      │  Grid of exercises │
                      │  OR "Auto Detect"  │
                      └────────┬───────────┘
                               │
                    ┌──── First time? ────┐
                    │ YES                 │ NO
                    ▼                     ▼
              Calibration ──────▶ Camera Setup Guide
              (T-pose, 5s)        ("Position phone here")
                                        │
                                        ▼
                                  Live Session
                                  │  Rep counting
                                  │  Form feedback
                                  │  Color skeleton
                                  │
                                  ├── [Pause] → Resume / End
                                  │
                                  └── [End Set] → Set Summary
                                                      │
                                        ┌─ Continue? ─┤
                                        │ YES         │ NO
                                        ▼             ▼
                                  Live Session    Session Summary
                                  (next set)      │  Total stats
                                                  │  Per-rep chart
                                                  │  Key insights
                                                  │  Share option
                                                  └──▶ Home
```

## 12.6 Design System Tokens

```dart
class GYMONICTheme {
  // Colors
  static const primary = Color(0xFF6C63FF);      // Purple accent
  static const background = Color(0xFF0D0D1A);   // Deep dark
  static const surface = Color(0xFF1A1A2E);       // Card backgrounds
  static const textPrimary = Color(0xFFFFFFFF);
  static const textSecondary = Color(0xFFB0B0C0);
  
  // Form colors
  static const formGreen = Color(0xFF4CAF50);
  static const formYellow = Color(0xFFFFC107);
  static const formRed = Color(0xFFF44336);
  
  // Typography
  static const fontFamily = 'Inter';
  static const headingLarge = TextStyle(fontSize: 28, fontWeight: FontWeight.w700);
  static const headingMedium = TextStyle(fontSize: 20, fontWeight: FontWeight.w600);
  static const bodyLarge = TextStyle(fontSize: 16, fontWeight: FontWeight.w400);
  static const bodySmall = TextStyle(fontSize: 14, fontWeight: FontWeight.w400);
  static const repCounter = TextStyle(fontSize: 48, fontWeight: FontWeight.w800);
  
  // Spacing
  static const paddingSm = 8.0;
  static const paddingMd = 16.0;
  static const paddingLg = 24.0;
  static const borderRadius = 12.0;
}
```

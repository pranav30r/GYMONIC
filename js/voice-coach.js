/**
 * GYMONIC — Voice Coach (Text-to-Speech)
 * Uses Web Speech API to speak real-time form corrections + motivation.
 */

// Motivational lines for struggling users
const MOTIVATION_LINES = [
  "Come on, you got this!",
  "Push through! One more!",
  "Don't give up now! Keep going!",
  "You're stronger than you think!",
  "Let's go! Show me what you've got!",
  "Almost there, keep pushing!",
  "Pain is temporary, gains are forever!",
  "Come on bro, you can do it!",
  "Stay focused! You've got this!",
  "Every rep counts! Keep going!",
];

const PRAISE_LINES = [
  "Perfect form! Beast mode!",
  "That's it! Beautiful!",
  "Nailed it! Keep that up!",
  "Excellent! You're crushing it!",
  "Clean rep! Looking strong!",
];

export class VoiceCoach {
  constructor() {
    this.synth = window.speechSynthesis;
    this.enabled = true;
    this.lastSpokenMessage = null;
    this.lastSpokenTime = 0;
    this.cooldownMs = 4000;
    this.repCooldownMs = 1500;
    this.motivationCooldownMs = 8000;
    this.lastMotivationTime = 0;
    this.consecutiveBadReps = 0;
    this.voice = null;
    this.volume = 0.9;
    this.rate = 1.0;  // Bug fix #6: 1.1 caused clipping on Windows TTS engines
    this.pitch = 1.0;

    this._loadVoice();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this._loadVoice();
    }
  }

  _loadVoice() {
    const voices = this.synth.getVoices();
    this.voice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
      || voices.find(v => v.lang.startsWith('en') && !v.localService)
      || voices.find(v => v.lang.startsWith('en'))
      || voices[0] || null;
  }

  speakCorrection(message) {
    if (!this.enabled || !message) return;
    const now = performance.now();
    if (message === this.lastSpokenMessage && now - this.lastSpokenTime < this.cooldownMs) return;
    if (this.synth.speaking) return;

    this._speak(message);
    this.lastSpokenMessage = message;
    this.lastSpokenTime = now;
  }

  /**
   * Announce rep completion with motivation for struggling users.
   */
  speakRep(repNumber, score) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastSpokenTime < this.repCooldownMs) return;

    let msg;
    if (score >= 90) {
      this.consecutiveBadReps = 0;
      const praise = PRAISE_LINES[Math.floor(Math.random() * PRAISE_LINES.length)];
      msg = `Rep ${repNumber}. ${praise}`;
    } else if (score >= 70) {
      this.consecutiveBadReps = 0;
      msg = `Rep ${repNumber}. Good job!`;
    } else if (score >= 50) {
      this.consecutiveBadReps++;
      msg = `Rep ${repNumber}. Watch your form.`;
    } else {
      this.consecutiveBadReps++;
      msg = `Rep ${repNumber}. Fix your form.`;
    }

    this._speak(msg);
    this.lastSpokenTime = now;

    // If 2+ bad reps in a row, motivate!
    if (this.consecutiveBadReps >= 2 && now - this.lastMotivationTime > this.motivationCooldownMs) {
      const motivation = MOTIVATION_LINES[Math.floor(Math.random() * MOTIVATION_LINES.length)];
      setTimeout(() => {
        if (this.enabled) this._speak(motivation);
      }, 1500);
      this.lastMotivationTime = now;
      this.consecutiveBadReps = 0;
    }
  }

  /**
   * Speak motivational line on demand.
   */
  speakMotivation() {
    if (!this.enabled) return;
    const line = MOTIVATION_LINES[Math.floor(Math.random() * MOTIVATION_LINES.length)];
    this.synth.cancel();
    this._speak(line);
  }

  speakAnnouncement(text) {
    if (!this.enabled) return;
    this.synth.cancel();
    this._speak(text);
  }

  speakLevelUp(level) {
    if (!this.enabled) return;
    this.synth.cancel();
    this._speak(`Level up! You are now level ${level.level}, ${level.title}! Keep grinding!`);
  }

  speakAchievement(name) {
    if (!this.enabled) return;
    setTimeout(() => {
      if (this.enabled) this._speak(`Achievement unlocked! ${name}!`);
    }, 2000);
  }

  _speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.volume;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    if (this.voice) utterance.voice = this.voice;
    this.synth.speak(utterance);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.synth.cancel();
    return this.enabled;
  }

  setEnabled(val) {
    this.enabled = val;
    if (!val) this.synth.cancel();
  }

  stop() { this.synth.cancel(); }

  resetRepTracking() {
    this.consecutiveBadReps = 0;
  }
}

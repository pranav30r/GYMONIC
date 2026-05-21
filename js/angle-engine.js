/**
 * GYMONIC — Joint Angle Computation Engine
 * Implements §7 from the blueprint: vector math, angle calculation, stability guards.
 */

// Joint definitions: [proximal, joint, distal] landmark indices
export const JOINT_DEFINITIONS = {
  left_elbow:     [11, 13, 15],
  right_elbow:    [12, 14, 16],
  left_shoulder:  [13, 11, 23],
  right_shoulder: [14, 12, 24],
  left_hip:       [11, 23, 25],
  right_hip:      [12, 24, 26],
  left_knee:      [23, 25, 27],
  right_knee:     [24, 26, 28],
  left_ankle:     [25, 27, 29],
  right_ankle:    [26, 28, 30],
};

// Skeleton connections for rendering
export const SKELETON_CONNECTIONS = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
];

/**
 * Compute angle at joint B formed by segments BA and BC.
 * Uses atan2 for numerical stability near 0° and 180°.
 * @param {Object} A - {x, y} proximal landmark
 * @param {Object} B - {x, y} joint landmark
 * @param {Object} C - {x, y} distal landmark
 * @returns {number|null} Angle in degrees [0, 180], or null if degenerate
 */
export function computeAngle(A, B, C) {
  const BAx = A.x - B.x;
  const BAy = A.y - B.y;
  const BCx = C.x - B.x;
  const BCy = C.y - B.y;

  const magBA = Math.sqrt(BAx * BAx + BAy * BAy);
  const magBC = Math.sqrt(BCx * BCx + BCy * BCy);

  // Guard: degenerate segments
  if (magBA < 1e-6 || magBC < 1e-6) return null;

  // Cross product (sin component) and dot product (cos component)
  const cross = Math.abs(BAx * BCy - BAy * BCx);
  const dot = BAx * BCx + BAy * BCy;

  const angleRad = Math.atan2(cross, dot);
  return angleRad * (180 / Math.PI);
}

/**
 * Compute all joint angles from landmarks.
 * @param {Array} landmarks - MediaPipe 33-point landmarks [{x, y, z, visibility}, ...]
 * @param {number} minVisibility - Minimum visibility threshold (default 0.5)
 * @returns {Object} {joint_name: angle_degrees|null}
 */
export function computeAllAngles(landmarks, minVisibility = 0.5) {
  const angles = {};

  for (const [jointName, [aIdx, bIdx, cIdx]] of Object.entries(JOINT_DEFINITIONS)) {
    const a = landmarks[aIdx];
    const b = landmarks[bIdx];
    const c = landmarks[cIdx];

    // Confidence check
    const minVis = Math.min(a.visibility, b.visibility, c.visibility);
    if (minVis < minVisibility) {
      angles[jointName] = null;
      continue;
    }

    angles[jointName] = computeAngle(a, b, c);
  }

  return angles;
}

/**
 * Compute torso lean angle from vertical.
 * @param {Array} landmarks 
 * @returns {number|null} Degrees from vertical (0 = perfectly upright)
 */
export function computeTorsoLean(landmarks) {
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];

  if (Math.min(lShoulder.visibility, rShoulder.visibility, lHip.visibility, rHip.visibility) < 0.5) {
    return null;
  }

  const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const hipMidX = (lHip.x + rHip.x) / 2;
  const hipMidY = (lHip.y + rHip.y) / 2;

  // Angle from vertical (vertical = straight up in image = negative y direction)
  const dx = shoulderMidX - hipMidX;
  const dy = shoulderMidY - hipMidY; // In image coords, y increases downward

  // Vertical reference vector: (0, -1) pointing up
  // Torso vector: (dx, dy) from hip to shoulder
  const torsoAngle = Math.abs(Math.atan2(dx, -dy)) * (180 / Math.PI);
  return torsoAngle;
}

/**
 * Compute elbow-to-hip horizontal distance (body-relative units).
 * Used for detecting elbow drift in curls.
 * @param {Array} landmarks
 * @param {'left'|'right'} side
 * @returns {number|null}
 */
export function computeElbowDrift(landmarks, side = 'left') {
  const elbowIdx = side === 'left' ? 13 : 14;
  const hipIdx = side === 'left' ? 23 : 24;
  const shoulderIdx = side === 'left' ? 11 : 12;

  const elbow = landmarks[elbowIdx];
  const hip = landmarks[hipIdx];
  const shoulder = landmarks[shoulderIdx];

  if (Math.min(elbow.visibility, hip.visibility, shoulder.visibility) < 0.5) {
    return null;
  }

  // Normalize by torso length for body-relative measurement
  const torsoLength = Math.sqrt(
    Math.pow(shoulder.x - hip.x, 2) + Math.pow(shoulder.y - hip.y, 2)
  );

  if (torsoLength < 0.01) return null;

  const elbowHipDist = Math.abs(elbow.x - hip.x);
  return elbowHipDist / torsoLength;
}

/**
 * Detect if body is horizontal (push-up position).
 * @param {Array} landmarks
 * @returns {boolean}
 */
export function isBodyHorizontal(landmarks) {
  const shoulderY = (landmarks[11].y + landmarks[12].y) / 2;
  const hipY = (landmarks[23].y + landmarks[24].y) / 2;
  const shoulderX = (landmarks[11].x + landmarks[12].x) / 2;
  const hipX = (landmarks[23].x + landmarks[24].x) / 2;

  const torsoAngleFromHorizontal = Math.abs(
    Math.atan2(Math.abs(shoulderY - hipY), Math.abs(shoulderX - hipX))
  ) * (180 / Math.PI);

  // Bug fix #4: raised from 35° to 45° — less strict, catches slightly off-angle cameras
  return torsoAngleFromHorizontal < 45;
}

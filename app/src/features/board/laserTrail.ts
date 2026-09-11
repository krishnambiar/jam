export const LASER_TRAIL_LIFETIME_MS = 3000;
export const LASER_TRAIL_FADE_MS = 900;

export function laserTrailOpacity(createdAt: number, now: number) {
  const age = Math.max(0, now - createdAt);
  const fadeStart = LASER_TRAIL_LIFETIME_MS - LASER_TRAIL_FADE_MS;
  if (age >= LASER_TRAIL_LIFETIME_MS) return 0;
  if (age <= fadeStart) return 1;
  return (LASER_TRAIL_LIFETIME_MS - age) / LASER_TRAIL_FADE_MS;
}

/** Motion settings shared by the camera and the explode animation. */
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** The user asked the system for less motion: camera moves and explode jump straight to their end. */
export function reducedMotion(): boolean {
  return query?.matches ?? false;
}

/**
 * One step of a critically damped spring (exact solution, stable at any frame time): starts and
 * stops smoothly and keeps its velocity when the target changes mid-flight. Returns [value, velocity].
 */
export function springStep(value: number, velocity: number, target: number, omega: number, dt: number): [number, number] {
  const x = value - target;
  const c = (velocity + omega * x) * dt;
  const e = Math.exp(-omega * dt);
  return [target + (x + c) * e, (velocity - omega * c) * e];
}

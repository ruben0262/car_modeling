/**
 * Coordinate frames.
 *
 * Vehicle data is authored in the ISO 8855 vehicle frame, in millimetres:
 *   +X forward, +Y left, +Z up, origin on the ground plane under the centre
 *   of the front axle. This matches how workshop data and tape-measure
 *   checks are expressed, so a mechanic can verify a position directly.
 *
 * glTF and three.js use metres with +Y up. The mapping is a cyclic axis
 * permutation, so handedness is preserved and no geometry is mirrored:
 *   three = (iso.y, iso.z, iso.x) / 1000
 *
 * Every conversion in the code base goes through this module.
 */
export type Vec3 = [number, number, number];

export const MM_TO_M = 0.001;

export function isoPointToThree([x, y, z]: Readonly<Vec3>): Vec3 {
  return [y * MM_TO_M, z * MM_TO_M, x * MM_TO_M];
}

export function isoDirToThree([x, y, z]: Readonly<Vec3>): Vec3 {
  return [y, z, x];
}

export function threePointToIso([x, y, z]: Readonly<Vec3>): Vec3 {
  return [z / MM_TO_M, x / MM_TO_M, y / MM_TO_M];
}

/**
 * Column-major 4x4 (three.js / glTF element order) of the similarity C that
 * maps ISO-mm coordinates to three-metre coordinates. A local transform L
 * authored in ISO space becomes C·L·C⁻¹ in three space; geometry becomes C·v.
 */
export function isoToThreeMatrixElements(): number[] {
  const s = MM_TO_M;
  // rows: three.x = s*iso.y, three.y = s*iso.z, three.z = s*iso.x
  return [
    0, 0, s, 0, // column 0 (iso x)
    s, 0, 0, 0, // column 1 (iso y)
    0, s, 0, 0, // column 2 (iso z)
    0, 0, 0, 1,
  ];
}

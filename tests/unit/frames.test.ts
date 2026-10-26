import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isoDirToThree, isoPointToThree, isoToThreeMatrixElements, threePointToIso } from '../../src/shared/frames';

describe('ISO 8855 ↔ three.js frames', () => {
  it('maps forward/left/up to +Z/+X/+Y and millimetres to metres', () => {
    expect(isoPointToThree([1000, 0, 0])).toEqual([0, 0, 1]); // forward
    expect(isoPointToThree([0, 1000, 0])).toEqual([1, 0, 0]); // left
    expect(isoPointToThree([0, 0, 1000])).toEqual([0, 1, 0]); // up
  });

  it('round-trips points', () => {
    const p: [number, number, number] = [-2660, 812, 368.65];
    const back = threePointToIso(isoPointToThree(p));
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 9));
  });

  it('matrix form agrees with the point mapping and preserves handedness', () => {
    const C = new THREE.Matrix4().fromArray(isoToThreeMatrixElements());
    const v = new THREE.Vector3(123, -456, 789).applyMatrix4(C);
    const expected = isoPointToThree([123, -456, 789]);
    expect(v.x).toBeCloseTo(expected[0], 9);
    expect(v.y).toBeCloseTo(expected[1], 9);
    expect(v.z).toBeCloseTo(expected[2], 9);
    expect(C.determinant()).toBeGreaterThan(0); // rotation, not a reflection
    expect(isoDirToThree([0, 0, 1])).toEqual([0, 1, 0]);
  });
});

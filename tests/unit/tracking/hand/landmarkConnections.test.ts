import { describe, expect, it } from 'vitest';
import { HAND_CONNECTIONS } from '../../../../src/tracking/hand/landmarkConnections';

describe('hand skeleton landmark connections', () => {
  it('preserves Member 1’s 21-landmark hand skeleton ordering and wrist bridge', () => {
    // The original Member 1 list has the 20 finger edges plus [0, 17].
    expect(HAND_CONNECTIONS).toHaveLength(21);
    expect(HAND_CONNECTIONS).toContainEqual([0, 1]);
    expect(HAND_CONNECTIONS).toContainEqual([7, 8]);
    expect(HAND_CONNECTIONS).toContainEqual([19, 20]);
    expect(HAND_CONNECTIONS).toContainEqual([0, 17]);
    for (const [start, end] of HAND_CONNECTIONS) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(20);
    }
  });
});

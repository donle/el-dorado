import { describe, it, expect } from 'vitest';
import { pickHandMover } from '../src/movement.js';

// 真实卡定义参考：explorer=machete/power1, scout=machete/power2, pioneer=machete/power5,
// sailor=paddle/power1, jack=joker/power1(三符号), adventurer=joker/power2(三符号).
describe('pickHandMover', () => {
  it('returns null when no candidate matches the symbol', () => {
    const r = pickHandMover('paddle', 1, [{ id: 'a', defId: 'explorer' }]); // explorer=machete
    expect(r).toBeNull();
  });

  it('returns null when no candidate has enough power', () => {
    const r = pickHandMover('machete', 3, [{ id: 'a', defId: 'scout' }]); // power 2 < 3
    expect(r).toBeNull();
  });

  it('prefers the smallest sufficient power (least overflow)', () => {
    const r = pickHandMover('machete', 2, [
      { id: 'big', defId: 'pioneer' }, // power 5
      { id: 'fit', defId: 'scout' }, // power 2
    ]);
    expect(r).toEqual({ cardId: 'fit', symbol: 'machete' });
  });

  it('prefers single-symbol cards over jokers even if overflow is larger', () => {
    // scout: machete only, power 2 (overflow 1). jack: joker(3 symbols), power 1 (overflow 0).
    // Single-symbol wins despite jack having smaller overflow.
    const r = pickHandMover('machete', 1, [
      { id: 'joker', defId: 'jack' },
      { id: 'single', defId: 'scout' },
    ]);
    expect(r).toEqual({ cardId: 'single', symbol: 'machete' });
  });

  it('falls back to a joker when no single-symbol card fits', () => {
    const r = pickHandMover('paddle', 1, [{ id: 'j', defId: 'jack' }]); // joker covers paddle
    expect(r).toEqual({ cardId: 'j', symbol: 'paddle' });
  });

  it('wildcard req (null) accepts any non-empty mover, smallest power first', () => {
    const r = pickHandMover(null, 1, [
      { id: 'big', defId: 'pioneer' }, // machete power 5
      { id: 'small', defId: 'sailor' }, // paddle power 1
    ]);
    expect(r).toEqual({ cardId: 'small', symbol: 'paddle' });
  });

  it('ignores non-mover cards (action cards have no movable symbols)', () => {
    const r = pickHandMover(null, 1, [{ id: 'c', defId: 'cartographer' }]); // action, power 0, no symbols
    expect(r).toBeNull();
  });
});

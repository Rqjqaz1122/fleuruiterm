import { describe, expect, it } from 'vitest';

import { resolvePaneDropPosition } from './tabDrag';

describe('terminal tab drop position', () => {
  const rectangle = {
    left: 100,
    top: 100,
    width: 400,
    height: 300,
  };

  it('selects the nearest horizontal edge', () => {
    expect(resolvePaneDropPosition(rectangle, 110, 250)).toBe('left');
    expect(resolvePaneDropPosition(rectangle, 490, 250)).toBe('right');
  });

  it('selects the nearest vertical edge', () => {
    expect(resolvePaneDropPosition(rectangle, 300, 110)).toBe('top');
    expect(resolvePaneDropPosition(rectangle, 300, 390)).toBe('bottom');
  });
});

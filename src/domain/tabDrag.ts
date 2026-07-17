import type { PaneDropPosition } from '@/domain/workspace';

export interface DropRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function resolvePaneDropPosition(
  rectangle: DropRectangle,
  clientX: number,
  clientY: number,
): PaneDropPosition {
  const relativeX = clientX - rectangle.left;
  const relativeY = clientY - rectangle.top;
  const distances: Array<{ position: PaneDropPosition; distance: number }> = [
    { position: 'left', distance: relativeX },
    { position: 'right', distance: rectangle.width - relativeX },
    { position: 'top', distance: relativeY },
    { position: 'bottom', distance: rectangle.height - relativeY },
  ];
  distances.sort((first, second) => first.distance - second.distance);
  return distances[0]?.position ?? 'right';
}

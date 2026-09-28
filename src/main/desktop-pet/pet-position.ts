export interface PetDisplay {
  id: number;
  workArea: { x: number; y: number; width: number; height: number };
}

export interface PetPosition {
  displayId: number;
  x: number;
  y: number;
}

export function clampToDisplay(
  position: { x: number; y: number },
  size: number,
  display: PetDisplay,
): { x: number; y: number } {
  const { x, y, width, height } = display.workArea;
  return {
    x: Math.max(x, Math.min(position.x, x + width - size)),
    y: Math.max(y, Math.min(position.y, y + height - size)),
  };
}

export function restorePosition(
  saved: PetPosition | undefined,
  size: number,
  displays: PetDisplay[],
): { x: number; y: number } {
  const display =
    displays.find((item) => item.id === saved?.displayId) ?? displays[0];
  if (!display) return { x: 0, y: 0 };
  if (saved && display.id === saved.displayId) {
    return clampToDisplay(saved, size, display);
  }
  const { x, y, width, height } = display.workArea;
  return clampToDisplay(
    { x: x + width - size - 16, y: y + height - size - 16 },
    size,
    display,
  );
}

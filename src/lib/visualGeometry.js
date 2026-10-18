function barcodeBoundsFromPoints(points, width, height) {
  if (!points || points.length < 2) return null;
  const xs = points.map((point) => point.getX());
  const ys = points.map((point) => point.getY());
  const rawLeft = Math.min(...xs);
  const rawTop = Math.min(...ys);
  const rawRight = Math.max(...xs);
  const rawBottom = Math.max(...ys);
  const padX = Math.max(12, (rawRight - rawLeft) * 0.25);
  const padY = Math.max(12, (rawBottom - rawTop) * 0.25, (rawRight - rawLeft) * 0.25);
  const x = Math.max(0, Math.floor(rawLeft - padX));
  const y = Math.max(0, Math.floor(rawTop - padY));
  const right = Math.min(width, Math.ceil(rawRight + padX));
  const bottom = Math.min(height, Math.ceil(rawBottom + padY));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

module.exports = { barcodeBoundsFromPoints };
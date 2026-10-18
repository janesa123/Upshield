function getOtsuThreshold(histogram, total) {
  let totalWeighted = 0;
  for (let value = 0; value < histogram.length; value += 1) totalWeighted += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundWeighted = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundWeighted += value * histogram[value];
    const meanBackground = backgroundWeighted / backgroundWeight;
    const meanForeground = (totalWeighted - backgroundWeighted) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function findQrLikeRegion(pixels, width, height, originX = 0, originY = 0, scale = 1) {
  if (pixels.length !== width * height * 4 || Math.min(width, height) < 48) return null;
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    gray[index] = value;
    histogram[value] += 1;
  }
  const threshold = getOtsuThreshold(histogram, gray.length);
  const maxSize = Math.min(width, height, Math.round(Math.min(width, height) * 0.9));
  const minSize = Math.min(maxSize, Math.max(48, Math.round(Math.min(width, height) * 0.12)));
  const sizes = [];
  for (let size = minSize; size <= maxSize; size += Math.max(8, Math.round(minSize * 0.18))) sizes.push(size);
  if (!sizes.includes(maxSize)) sizes.push(maxSize);

  let best = null;
  for (const size of sizes) {
    const step = Math.max(4, Math.round(size / 10));
    for (let y = 0; y + size <= height; y += step) {
      for (let x = 0; x + size <= width; x += step) {
        let horizontalChanges = 0;
        let verticalChanges = 0;
        let darkPixels = 0;
        let samples = 0;
        for (let row = 1; row < size; row += 2) {
          const rowOffset = (y + row) * width + x;
          for (let column = 1; column < size; column += 2) {
            const index = rowOffset + column;
            const isDark = gray[index] <= threshold;
            if (isDark) darkPixels += 1;
            samples += 1;
            if (isDark !== (gray[index - 1] <= threshold)) horizontalChanges += 1;
            if (isDark !== (gray[index - width] <= threshold)) verticalChanges += 1;
          }
        }
            const darkRatio = darkPixels / samples;
        if (darkRatio < 0.28 || darkRatio > 0.72) continue;
        const balance = Math.min(darkRatio, 1 - darkRatio) * 2;
        const edgeDensity = Math.min(horizontalChanges, verticalChanges) / samples;
        const score = edgeDensity * balance * (0.7 + 0.3 * size / maxSize);
        if (score > (best?.score ?? 0)) best = { x, y, size, score };
      }
    }
  }

  if (!best || best.score < 0.2) return null;
  const regionSize = Math.min(Math.min(width, height), Math.ceil(best.size * 1.6));
  const pad = Math.max(3, Math.round(regionSize * 0.04));
  const centerX = best.x + best.size / 2;
  const centerY = best.y + best.size / 2;
  const left = centerX - regionSize / 2 - pad;
  const top = centerY - regionSize / 2 - pad;
  const rightEdge = centerX + regionSize / 2 + pad;
  const bottomEdge = centerY + regionSize / 2 + pad;
  const x = Math.max(0, Math.floor(left / scale + originX));
  const y = Math.max(0, Math.floor(top / scale + originY));
  const right = Math.min(originX + width / scale, Math.ceil(rightEdge / scale + originX));
  const bottom = Math.min(originY + height / scale, Math.ceil(bottomEdge / scale + originY));
  return {
    type: "QR code",
    matchedText: "QR-like code region detected",
    confidence: Math.min(90, Math.round(best.score * 300)),
    boundingBox: { x, y, width: right - x, height: bottom - y },
    recommendedAction: "redact",
    riskLevel: "high",
    validation: "visual-pattern-fallback"
  };
}

function findQrLikeRegionFromImage(pixels, width, height) {
  const wholeImage = findQrLikeRegion(pixels, width, height);
  if (wholeImage) return wholeImage;

  const fraction = 0.42;
  const cropWidth = Math.ceil(width * fraction);
  const cropHeight = Math.ceil(height * fraction);
  if (cropWidth < 48 || cropHeight < 48) return null;
  const xPositions = [...new Set([0, Math.floor((width - cropWidth) * 0.29), Math.floor((width - cropWidth) * 0.58), width - cropWidth])];
  const yPositions = [...new Set([0, Math.floor((height - cropHeight) * 0.29), Math.floor((height - cropHeight) * 0.58), height - cropHeight])];
  let best = null;
  for (const y of yPositions) {
    for (const x of xPositions) {
      const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4);
      for (let row = 0; row < cropHeight; row += 1) {
        const sourceStart = ((y + row) * width + x) * 4;
        cropped.set(pixels.subarray(sourceStart, sourceStart + cropWidth * 4), row * cropWidth * 4);
      }
      const candidate = findQrLikeRegion(cropped, cropWidth, cropHeight, x, y);
      if (candidate && (!best || candidate.confidence > best.confidence)) best = candidate;
    }
  }
  return best;
}

module.exports = { findQrLikeRegion, findQrLikeRegionFromImage };

const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  InvertedLuminanceSource,
  MultiFormatReader,
  RGBLuminanceSource
} = require("@zxing/library");
const { barcodeBoundsFromPoints } = require("./visualGeometry");

const hints = new Map([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417,
    BarcodeFormat.AZTEC, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E, BarcodeFormat.CODABAR, BarcodeFormat.ITF
  ]]
]);

function luminanceAt(pixels, index, rgbaPixels) {
  if (rgbaPixels) {
    const offset = index * 4;
    return Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
  }
  const pixel = pixels[index];
  return Math.round(((pixel >> 16 & 0xff) * 0.299) + ((pixel >> 8 & 0xff) * 0.587) + ((pixel & 0xff) * 0.114));
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let value = 0; value < histogram.length; value += 1) sum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maxVariance = -1;
  let threshold = 128;
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function makeThresholdPixels(pixels, width, height, threshold, rgbaPixels) {
  const output = new Int32Array(width * height);
  for (let index = 0; index < output.length; index += 1) {
    const value = luminanceAt(pixels, index, rgbaPixels) < threshold ? 0 : 0xffffff;
    output[index] = value;
  }
  return output;
}

function decodeBarcodePixels(pixels, width, height, originX = 0, originY = 0, scale = 1) {
  const rgbaPixels = pixels.length === width * height * 4;
  let rgbPixels = pixels;
  let threshold = null;
  if (rgbaPixels) {
    rgbPixels = new Int32Array(width * height);
    const histogram = new Uint32Array(256);
    for (let index = 0; index < rgbPixels.length; index += 1) {
      const offset = index * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
      histogram[luminance] += 1;
      rgbPixels[index] = (red << 16) | (green << 8) | blue;
    }
    threshold = otsuThreshold(histogram, rgbPixels.length);
  }
  const reader = new MultiFormatReader();
  const inputs = [{ pixels: rgbPixels, binarizers: [HybridBinarizer, GlobalHistogramBinarizer] }];
  if (rgbaPixels && threshold !== null) {
    inputs.push({ pixels: makeThresholdPixels(pixels, width, height, threshold, true), binarizers: [HybridBinarizer] });
    inputs.push({ pixels: makeThresholdPixels(pixels, width, height, 128, true), binarizers: [HybridBinarizer] });
  }
  for (const input of inputs) {
    const luminance = new RGBLuminanceSource(input.pixels, width, height);
    for (const Binarizer of input.binarizers) {
      for (const source of [luminance, new InvertedLuminanceSource(luminance)]) {
        try {
          const bitmap = new BinaryBitmap(new Binarizer(source));
          const result = reader.decode(bitmap, hints);
          const points = result.getResultPoints().map((point) => ({
            getX: () => originX + point.getX() / scale,
            getY: () => originY + point.getY() / scale
          }));
          const boundingBox = barcodeBoundsFromPoints(points, originX + width / scale, originY + height / scale);
          if (!boundingBox) continue;
          const barcodeFormat = result.getBarcodeFormat();
          const format = barcodeFormat === BarcodeFormat.QR_CODE ? "QR_CODE" : "BARCODE";
          return {
            type: format === "QR_CODE" ? "QR code" : "Barcode",
            matchedText: `${format} detected`,
            confidence: 90,
            boundingBox,
            recommendedAction: "redact",
            riskLevel: "high"
          };
        } catch {
          reader.reset();
        }
      }
    }
  }
  reader.reset();
  return null;
}

module.exports = { decodeBarcodePixels };
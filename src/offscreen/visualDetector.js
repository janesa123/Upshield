const { FaceDetector, FilesetResolver } = require("@mediapipe/tasks-vision");
const { decodeBarcodePixels } = require("../lib/barcodeDecoder");
const { createFaceDetectors } = require("../lib/faceModels");
const { findQrLikeRegionFromImage } = require("../lib/qrRegionDetector");
const { isPaymentCardText } = require("../lib/sensitiveImageContext");

let faceDetectorsPromise;

async function getFaceDetectors() {
  if (!faceDetectorsPromise) {
    const wasmPath = chrome.runtime.getURL("vendor/mediapipe/wasm");
    faceDetectorsPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(wasmPath, false);
      for (const assetUrl of [fileset.wasmLoaderPath, fileset.wasmBinaryPath]) {
        const response = await fetch(assetUrl);
        if (!response.ok) throw new Error(`Could not fetch local vision runtime asset (${response.status}): ${assetUrl}`);
      }
      return createFaceDetectors(
        async (modelPath, minScore) => {
          const assetUrl = chrome.runtime.getURL(modelPath);
          const response = await fetch(assetUrl);
          if (!response.ok) throw new Error(`Could not fetch local face model (${response.status}): ${assetUrl}`);
          const modelBuffer = new Uint8Array(await response.arrayBuffer());
          if (!modelBuffer.length) throw new Error(`Local face model is empty: ${assetUrl}`);
          const detector = await FaceDetector.createFromModelBuffer(fileset, modelBuffer);
          await detector.setOptions({ minDetectionConfidence: minScore });
          return detector;
        },
        (modelPath) => modelPath
      );
    })()
      .catch((error) => {
        faceDetectorsPromise = null;
        throw error;
      });
  }
  return faceDetectorsPromise;
}

async function detectCodes(image, width, height) {
  const detections = [];
  if (typeof BarcodeDetector !== "undefined") {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const formats = supported.filter((format) => [
        "qr_code", "data_matrix", "pdf417", "aztec", "code_128", "code_39",
        "ean_13", "ean_8", "upc_a", "upc_e", "codabar", "itf"
      ].includes(format));
      if (formats.length) {
        const detector = new BarcodeDetector({ formats });
        const codes = await detector.detect(image);
        if (codes.length) {
          detections.push(...codes.map((code) => {
            const x = Math.max(0, Math.floor(code.boundingBox.x));
            const y = Math.max(0, Math.floor(code.boundingBox.y));
            const right = Math.min(width, Math.ceil(code.boundingBox.right));
            const bottom = Math.min(height, Math.ceil(code.boundingBox.bottom));
            return {
              type: code.format === "qr_code" ? "QR code" : "Barcode",
              matchedText: `${code.format} detected`,
              confidence: 100,
              boundingBox: {
                x,
                y,
                width: Math.max(1, right - x),
                height: Math.max(1, bottom - y)
              },
              recommendedAction: "redact",
              riskLevel: "high"
            };
          }));
        }
      }
    } catch {
      // Fall back to ZXing when the native decoder is unavailable or rejects the image.
    }
  }

  const regions = [{ x: 0, y: 0, width, height }];
  const cropWidth = Math.ceil(width * 0.58);
  const cropHeight = Math.ceil(height * 0.58);
  for (const y of [0, Math.floor((height - cropHeight) / 2), height - cropHeight]) {
    for (const x of [0, Math.floor((width - cropWidth) / 2), width - cropWidth]) {
      if (x || y) regions.push({ x, y, width: cropWidth, height: cropHeight });
    }
  }
  const qrWidth = Math.ceil(width * 0.42);
  const qrHeight = Math.ceil(height * 0.42);
  for (const y of [0, Math.floor((height - qrHeight) * 0.29), Math.floor((height - qrHeight) * 0.58), height - qrHeight]) {
    for (const x of [0, Math.floor((width - qrWidth) * 0.29), Math.floor((width - qrWidth) * 0.58), width - qrWidth]) {
      const region = { x, y, width: qrWidth, height: qrHeight };
      if (!regions.some((existing) => existing.x === x && existing.y === y && existing.width === qrWidth && existing.height === qrHeight)) regions.push(region);
    }
  }

  for (const region of regions) {
    for (const scale of [1, 2, 3]) {
      const scaledWidth = Math.round(region.width * scale);
      const scaledHeight = Math.round(region.height * scale);
      if (Math.max(scaledWidth, scaledHeight) > 4096) continue;
      const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Could not create a canvas for barcode scanning.");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, scaledWidth, scaledHeight);
      const pixels = context.getImageData(0, 0, scaledWidth, scaledHeight);
      const detection = decodeBarcodePixels(pixels.data, scaledWidth, scaledHeight, region.x, region.y, scale);
      if (!detection) continue;
      if (detections.some((existing) => existing.type === detection.type && intersectionRatio(existing.boundingBox, detection.boundingBox) > 0.45)) continue;
      detections.push(detection);
    }
  }
  if (!detections.some((detection) => detection.type === "QR code")) {
    const scale = Math.min(1, 600 / Math.max(width, height));
    const scanWidth = Math.max(1, Math.round(width * scale));
    const scanHeight = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(scanWidth, scanHeight);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not create a canvas for QR region detection.");
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, scanWidth, scanHeight);
    const candidate = findQrLikeRegionFromImage(context.getImageData(0, 0, scanWidth, scanHeight).data, scanWidth, scanHeight);
    if (candidate) {
      candidate.boundingBox = {
        x: Math.floor(candidate.boundingBox.x / scale),
        y: Math.floor(candidate.boundingBox.y / scale),
        width: Math.ceil(candidate.boundingBox.width / scale),
        height: Math.ceil(candidate.boundingBox.height / scale)
      };
    }
    if (candidate && !detections.some((existing) => intersectionRatio(existing.boundingBox, candidate.boundingBox) > 0.45)) {
      detections.push(candidate);
    }
  }
  return detections;
}

function intersectionRatio(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea ? intersection / smallerArea : 0;
}

async function detectFaces(detectors, image, documentLike) {
  const width = image.width;
  const height = image.height;
  const regions = [{ x: 0, y: 0, width, height }];
  const fractions = documentLike ? [0.62, 0.42] : [0.62];
  for (const fraction of fractions) {
    const cropWidth = Math.ceil(width * fraction);
    const cropHeight = Math.ceil(height * fraction);
    const xPositions = [...new Set([0, Math.floor((width - cropWidth) / 2), width - cropWidth])];
    const yPositions = [...new Set([0, Math.floor((height - cropHeight) / 2), height - cropHeight])];
    for (const y of yPositions) {
      for (const x of xPositions) {
        if (x || y) regions.push({ x, y, width: Math.min(cropWidth, width - x), height: Math.min(cropHeight, height - y) });
      }
    }
  }

  const faces = [];
  for (const region of regions) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a canvas for face scanning.");
    context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, width, height);
    for (const { detector, minScore } of detectors) {
      const result = detector.detect(canvas);
      for (const detection of result.detections) {
      const box = detection.boundingBox;
      if (!box) continue;
      const score = detection.categories[0]?.score || 0;
      if (score < minScore) continue;
      const scaleX = region.width / width;
      const scaleY = region.height / height;
      const raw = {
        x: region.x + box.originX * scaleX,
        y: region.y + box.originY * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY
      };
      const candidate = {
        x: Math.max(0, Math.floor(raw.x - Math.max(4, raw.width * 0.1))),
        y: Math.max(0, Math.floor(raw.y - Math.max(4, raw.height * 0.1))),
        width: 0,
        height: 0
      };
      const right = Math.min(width, Math.ceil(raw.x + raw.width * 1.1));
      const bottom = Math.min(height, Math.ceil(raw.y + raw.height * 1.1));
      candidate.width = right - candidate.x;
      candidate.height = bottom - candidate.y;
      const duplicate = faces.findIndex((face) => intersectionRatio(face.boundingBox, candidate) > 0.35);
      const face = {
        type: "Face",
        matchedText: "Face detected",
        confidence: Math.round(score * 100),
        boundingBox: candidate,
        recommendedAction: "redact",
        riskLevel: "high"
      };
      if (duplicate < 0) faces.push(face);
      else if (face.confidence > faces[duplicate].confidence) faces[duplicate] = face;
      }
    }
  }
  return faces;
}

async function detectVisualPii(file, ocrText = "") {
  const image = await createImageBitmap(file);
  try {
    const paymentCard = isPaymentCardText(ocrText);
    const [faceDetectors, codeDetections] = await Promise.all([
      paymentCard ? Promise.resolve([]) : getFaceDetectors(),
      detectCodes(image, image.width, image.height)
    ]);
    const documentLike = /\b(?:aadhaar|uidai|passport|pan card|driving licence|driver'?s licence|permanent account number)\b/i.test(ocrText);
    const faces = paymentCard ? [] : await detectFaces(faceDetectors, image, documentLike);
    return [...faces, ...codeDetections];
  } finally {
    image.close();
  }
}

module.exports = { detectVisualPii };
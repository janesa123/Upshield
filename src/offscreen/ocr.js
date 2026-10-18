const { createWorker } = require("tesseract.js");
const { flattenOcrWords } = require("../../scanner");
const { detectIndianPii } = require("../lib/indianPiiDetector");
const { readMetadata } = require("../lib/metadata");
const { dataUrlToBytes } = require("../lib/imageDataUrl");
const { detectVisualPii } = require("./visualDetector");
const { scaleOcrWordBoxes } = require("../lib/ocrGeometry");

let worker;
let workerInitPromise;

async function getWorker() {
  if (worker) return worker;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = createWorker("eng+tam", 1, {
    workerPath: chrome.runtime.getURL("vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/core/"),
    langPath: chrome.runtime.getURL("vendor/lang/"),
    workerBlobURL: false,
    gzip: true
  }).then(async (createdWorker) => {
    worker = createdWorker;
    return worker;
  }).catch((error) => {
    workerInitPromise = null;
    throw error;
  });

  return workerInitPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "UPSHIELD_OCR_PROCESS") return;

  let stage = "decode image message";
  (async () => {
    const { bytes, mimeType } = dataUrlToBytes(message.imageDataUrl);
    const file = new File([bytes], message.fileName || "upload.png", {
      type: mimeType || message.mimeType || "image/png"
    });
    stage = "decode image for OCR";
    const sourceBitmap = await createImageBitmap(file);
    const scale = Math.min(4, 1800 / Math.max(sourceBitmap.width, sourceBitmap.height));
    let ocrFile = file;
    let scaleX = 1;
    let scaleY = 1;
    if (scale > 1.05) {
      const width = Math.round(sourceBitmap.width * scale);
      const height = Math.round(sourceBitmap.height * scale);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not prepare the image for OCR.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(sourceBitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      ocrFile = new File([blob], "upshield-ocr.png", { type: "image/png" });
      scaleX = width / sourceBitmap.width;
      scaleY = height / sourceBitmap.height;
    }
    sourceBitmap.close();
    stage = "initialize local English/Tamil OCR";
    let ocrWorker;
    try {
      ocrWorker = await getWorker();
    } catch (error) {
      throw new Error(`Tesseract worker/model initialization failed: ${error.message || error}`);
    }
    let data;
    try {
      stage = "recognize image text";
      ({ data } = await ocrWorker.recognize(ocrFile, {}, { text: true, blocks: true }));
    } catch (error) {
      throw new Error(`Tesseract could not read the image: ${error.message || error}`);
    }
    const words = scaleOcrWordBoxes(flattenOcrWords(data.blocks || []), scaleX, scaleY);
    if (data.text?.trim() && words.length === 0) {
      throw new Error("OCR read text but produced no word boxes; upload remains blocked.");
    }
    stage = "detect face and QR/barcode regions";
    let visualDetections;
    try {
      visualDetections = await detectVisualPii(file, data.text || "");
    } catch (error) {
      throw new Error(`Local face/QR scan failed: ${error.message || error}`);
    }
    stage = "inspect image metadata";
    const metadata = await readMetadata(file);
    sendResponse({
      ok: true,
      result: {
        text: data.text || "",
        words,
        detections: [...detectIndianPii(words, data.text || ""), ...visualDetections],
        metadata
      }
    });
  })().catch((error) => {
    sendResponse({ ok: false, error: `${stage}: ${error.message || String(error)}` });
  });

  return true;
});
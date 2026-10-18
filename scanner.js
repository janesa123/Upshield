
const { arrayBufferToDataUrl } = require("./src/lib/imageDataUrl");

function flattenOcrWords(blocks = []) {
  return blocks.flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => (
    (paragraph.lines || []).flatMap((line) => (line.words || []).map((word, index) => ({
      ...word,
      lineBreakBefore: index === 0
    })))
  )));
}

async function scanImage(file, onProgress = () => {}) {
  onProgress({ status: "Sending image to local OCR", progress: 0 });
  const response = await chrome.runtime.sendMessage({
    type: "UPSHIELD_OCR_SCAN",
    imageDataUrl: arrayBufferToDataUrl(await file.arrayBuffer(), file.type || "image/png"),
    fileName: file.name || "upload.png",
    mimeType: file.type || "image/png"
  });
  if (!response?.ok) {
    throw new Error(response?.error || "The local OCR service did not respond.");
  }
  onProgress({ status: "Local OCR complete", progress: 1 });
  return response.result;
}

module.exports = { flattenOcrWords, scanImage };

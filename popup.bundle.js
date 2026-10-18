(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/lib/imageDataUrl.js
  var require_imageDataUrl = __commonJS({
    "src/lib/imageDataUrl.js"(exports, module) {
      function arrayBufferToDataUrl(buffer, mimeType = "application/octet-stream") {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 32768;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return `data:${mimeType};base64,${btoa(binary)}`;
      }
      function dataUrlToBytes(dataUrl) {
        const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl || "");
        if (!match) throw new Error("Image data was not a valid base64 data URL.");
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return { mimeType: match[1], bytes };
      }
      module.exports = { arrayBufferToDataUrl, dataUrlToBytes };
    }
  });

  // scanner.js
  var require_scanner = __commonJS({
    "scanner.js"(exports, module) {
      var { arrayBufferToDataUrl } = require_imageDataUrl();
      function flattenOcrWords(blocks = []) {
        return blocks.flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => (paragraph.lines || []).flatMap((line) => (line.words || []).map((word, index) => ({
          ...word,
          lineBreakBefore: index === 0
        })))));
      }
      async function scanImage(file, onProgress = () => {
      }) {
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
    }
  });

  // src/lib/redactor.js
  var require_redactor = __commonJS({
    "src/lib/redactor.js"(exports, module) {
      function getRedactionBounds(detection, imageWidth, imageHeight) {
        const { boundingBox, type = "detection" } = detection;
        if (!boundingBox) throw new Error(`Cannot redact ${type}: no bounding box was provided.`);
        const values = [boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height];
        if (!values.every(Number.isFinite) || boundingBox.width <= 0 || boundingBox.height <= 0) {
          throw new Error(`Cannot redact ${type}: the bounding box is invalid.`);
        }
        const isCode = /^(?:QR code|Barcode)$/i.test(type);
        const paddingX = isCode ? Math.max(4, Math.ceil(boundingBox.width * 0.08)) : Math.max(4, Math.ceil(boundingBox.width * 0.08));
        const paddingY = isCode ? Math.max(4, Math.ceil(boundingBox.height * 0.08)) : Math.max(4, Math.ceil(boundingBox.height * 0.18));
        const x = Math.max(0, Math.floor(boundingBox.x - paddingX));
        const y = Math.max(0, Math.floor(boundingBox.y - paddingY));
        const right = Math.min(imageWidth, Math.ceil(boundingBox.x + boundingBox.width + paddingX));
        const bottom = Math.min(imageHeight, Math.ceil(boundingBox.y + boundingBox.height + paddingY));
        if (right <= x || bottom <= y) {
          throw new Error(`Cannot redact ${type}: the bounding box is outside the image.`);
        }
        return { x, y, width: right - x, height: bottom - y };
      }
      async function redactImage(file, detections) {
        const image = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          image.close();
          throw new Error("Canvas is unavailable.");
        }
        context.drawImage(image, 0, 0);
        image.close();
        context.fillStyle = "#000000";
        detections.forEach((detection) => {
          const bounds = getRedactionBounds(detection, canvas.width, canvas.height);
          context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        });
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image export failed.")), "image/png");
        });
        return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.upshield.png`, { type: "image/png", lastModified: Date.now() });
      }
      module.exports = { getRedactionBounds, redactImage };
    }
  });

  // src/lib/scanErrorMessage.js
  var require_scanErrorMessage = __commonJS({
    "src/lib/scanErrorMessage.js"(exports, module) {
      function scanErrorMessage(error) {
        const message = String(error?.message || error || "Unknown scanner error");
        if (/extension context invalidated|context invalidated/i.test(message)) {
          return "Chrome unloaded this extension. Refresh this ChatGPT tab, then select the image again. Upload remains blocked.";
        }
        if (/could not fetch local (?:face model|vision runtime asset)/i.test(message)) {
          return `${message} Reload UPShield from chrome://extensions and refresh this tab. Upload remains blocked.`;
        }
        return `${message.slice(0, 180)}. Upload remains blocked; cancel and try again.`;
      }
      module.exports = { scanErrorMessage };
    }
  });

  // popup.js
  var require_popup = __commonJS({
    "popup.js"() {
      var { scanImage } = require_scanner();
      var { redactImage } = require_redactor();
      var { scanErrorMessage } = require_scanErrorMessage();
      document.addEventListener("DOMContentLoaded", () => {
        const imageInput = document.getElementById("imageInput");
        const preview = document.getElementById("preview");
        const status = document.getElementById("status");
        const findings = document.getElementById("findings");
        const metadata = document.getElementById("metadata");
        const scanButton = document.getElementById("scanButton");
        const redactButton = document.getElementById("redactButton");
        const cancelButton = document.getElementById("cancelButton");
        let selectedImage = null;
        let scanResult = null;
        let sanitizedImage = null;
        let previewUrl = null;
        const showPreview = (file) => {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = URL.createObjectURL(file);
          preview.src = previewUrl;
          preview.hidden = false;
        };
        const reset = () => {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = null;
          selectedImage = null;
          scanResult = null;
          sanitizedImage = null;
          imageInput.value = "";
          preview.hidden = true;
          preview.removeAttribute("src");
          findings.replaceChildren();
          metadata.textContent = "";
          status.textContent = "Select an image to scan on this device.";
          scanButton.disabled = true;
          redactButton.disabled = true;
          redactButton.textContent = "Redact & preview";
          cancelButton.disabled = true;
        };
        imageInput.addEventListener("change", () => {
          selectedImage = imageInput.files[0] || null;
          scanResult = null;
          sanitizedImage = null;
          findings.replaceChildren();
          redactButton.disabled = true;
          redactButton.textContent = "Redact & preview";
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = null;
          preview.hidden = true;
          preview.removeAttribute("src");
          if (!selectedImage) return;
          if (!["image/png", "image/jpeg"].includes(selectedImage.type)) {
            status.textContent = "Only PNG and JPG images are supported.";
            scanButton.disabled = true;
            cancelButton.disabled = false;
            return;
          }
          showPreview(selectedImage);
          status.textContent = `Ready to scan: ${selectedImage.name}`;
          scanButton.disabled = false;
          cancelButton.disabled = false;
        });
        scanButton.addEventListener("click", async () => {
          if (!selectedImage) return;
          scanButton.disabled = true;
          status.textContent = "Starting local OCR...";
          try {
            scanResult = await scanImage(selectedImage, ({ status: message, progress }) => {
              status.textContent = `${message} (${Math.round(progress * 100)}%)`;
            });
            findings.replaceChildren();
            if (!scanResult.detections.length) {
              const item = document.createElement("li");
              item.textContent = "No supported patterns detected. This is not proof the image is safe; review it manually.";
              findings.append(item);
            }
            scanResult.detections.forEach((detection) => {
              const item = document.createElement("li");
              const label = document.createElement("strong");
              label.textContent = detection.type;
              const value = document.createElement("span");
              value.textContent = detection.matchedText;
              const confidence = document.createElement("small");
              confidence.textContent = `${detection.confidence}% confidence${detection.validation === "unverified-format" ? " \xB7 unverified format" : ""}`;
              item.append(label, value, confidence);
              findings.append(item);
            });
            const flags = [];
            if (scanResult.metadata.exifFound) flags.push("EXIF found");
            if (scanResult.metadata.gpsFound) flags.push("GPS found");
            if (scanResult.metadata.deviceModelFound) flags.push("device model found");
            if (scanResult.metadata.timestampFound) flags.push("timestamp found");
            metadata.textContent = `${flags.join(" \xB7 ") || "No EXIF found"}; metadata removed on export.`;
            status.textContent = `Scan complete \xB7 ${scanResult.detections.length} finding${scanResult.detections.length === 1 ? "" : "s"}`;
            redactButton.disabled = false;
          } catch (error) {
            status.textContent = `Local scan failed: ${scanErrorMessage(error)}`;
          } finally {
            scanButton.disabled = false;
          }
        });
        redactButton.addEventListener("click", async () => {
          if (!selectedImage || !scanResult) return;
          redactButton.disabled = true;
          try {
            if (!sanitizedImage) {
              status.textContent = "Creating sanitized preview...";
              sanitizedImage = await redactImage(selectedImage, scanResult.detections);
              showPreview(sanitizedImage);
              redactButton.textContent = "Download sanitized PNG";
              status.textContent = scanResult.detections.length ? "Sanitized preview shown. Inspect it before downloading." : "No patterns were detected, so no black boxes were applied. Review manually before downloading.";
              redactButton.disabled = false;
              return;
            }
            const url = previewUrl;
            const link = document.createElement("a");
            link.href = url;
            link.download = sanitizedImage.name;
            link.click();
            status.textContent = "Sanitized image downloaded.";
          } catch (error) {
            status.textContent = `Could not create the sanitized image: ${error?.message || String(error)}. No download was created.`;
            redactButton.disabled = false;
          }
        });
        cancelButton.addEventListener("click", reset);
      });
    }
  });
  require_popup();
})();

const { scanImage } = require("./scanner");
const { redactImage } = require("./src/lib/redactor");
const { scanErrorMessage } = require("./src/lib/scanErrorMessage");

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
        confidence.textContent = `${detection.confidence}% confidence${detection.validation === "unverified-format" ? " · unverified format" : ""}`;
        item.append(label, value, confidence);
        findings.append(item);
      });
      const flags = [];
      if (scanResult.metadata.exifFound) flags.push("EXIF found");
      if (scanResult.metadata.gpsFound) flags.push("GPS found");
      if (scanResult.metadata.deviceModelFound) flags.push("device model found");
      if (scanResult.metadata.timestampFound) flags.push("timestamp found");
      metadata.textContent = `${flags.join(" · ") || "No EXIF found"}; metadata removed on export.`;
      status.textContent = `Scan complete · ${scanResult.detections.length} finding${scanResult.detections.length === 1 ? "" : "s"}`;
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
        status.textContent = scanResult.detections.length
          ? "Sanitized preview shown. Inspect it before downloading."
          : "No patterns were detected, so no black boxes were applied. Review manually before downloading.";
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
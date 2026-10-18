function getRedactionBounds(detection, imageWidth, imageHeight) {
  const { boundingBox, type = "detection" } = detection;
  if (!boundingBox) throw new Error(`Cannot redact ${type}: no bounding box was provided.`);
  const values = [boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height];
  if (!values.every(Number.isFinite) || boundingBox.width <= 0 || boundingBox.height <= 0) {
    throw new Error(`Cannot redact ${type}: the bounding box is invalid.`);
  }

  const isCode = /^(?:QR code|Barcode)$/i.test(type);
  const paddingX = isCode
    ? Math.max(4, Math.ceil(boundingBox.width * 0.08))
    : Math.max(4, Math.ceil(boundingBox.width * 0.08));
  const paddingY = isCode
    ? Math.max(4, Math.ceil(boundingBox.height * 0.08))
    : Math.max(4, Math.ceil(boundingBox.height * 0.18));
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
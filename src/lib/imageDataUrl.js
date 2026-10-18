function arrayBufferToDataUrl(buffer, mimeType = "application/octet-stream") {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
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
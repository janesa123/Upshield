chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#12617a" });
  chrome.action.setBadgeText({ text: "ON" });
});

let creatingOffscreenDocument;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });
  if (contexts.length) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run bundled local OCR in the extension origin, isolated from provider page CSP."
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "UPSHIELD_OCR_SCAN") return;

  (async () => {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      type: "UPSHIELD_OCR_PROCESS",
      imageDataUrl: message.imageDataUrl,
      fileName: message.fileName,
      mimeType: message.mimeType
    });
    sendResponse(response || { ok: false, error: "The offscreen OCR page returned no response." });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});
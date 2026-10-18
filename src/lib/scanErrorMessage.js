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
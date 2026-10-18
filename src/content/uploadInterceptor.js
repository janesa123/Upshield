const { scanImage } = require("../../scanner");
const { redactImage } = require("../lib/redactor");
const { scanErrorMessage } = require("../lib/scanErrorMessage");

const replayedFiles = new WeakSet();
const replayedPasteEvents = new WeakSet();
let activeReview = false;

function isImage(file) {
  return file && (file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name));
}

function isSupported(file) {
  return ["image/png", "image/jpeg"].includes(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

function createReview(file, onApprove, onCancel) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}*{box-sizing:border-box}section{position:fixed;inset:0;background:#101820b8;display:grid;place-items:center;padding:18px;font:14px/1.45 system-ui,sans-serif;color:#17212b}
      article{width:min(760px,100%);max-height:min(90vh,820px);overflow:auto;background:#f6f8fa;border:1px solid #c5d0d7;border-radius:8px;box-shadow:0 20px 70px #0007}
      header{padding:18px 22px;background:#123d50;color:#fff}h2{margin:0;font-size:19px}header p{margin:4px 0 0;color:#d6e6ec}
      .body{display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1.1fr);gap:20px;padding:20px}canvas{display:block;width:100%;max-height:370px;object-fit:contain;background:#dce5e9;border-radius:4px}ul{padding:0;margin:0;list-style:none}li{padding:9px 0;border-bottom:1px solid #d8e0e4}label{display:flex;align-items:flex-start;gap:8px}small{display:block;color:#52636e}.notice{margin:14px 0 0;color:#126044;font-weight:600}.error{color:#a12622}
      footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:14px 20px;border-top:1px solid #d8e0e4}button{border:1px solid #aab9c2;border-radius:4px;padding:9px 13px;background:#fff;color:#17212b;font:600 13px system-ui;cursor:pointer}button.primary{background:#12617a;border-color:#12617a;color:white}button.danger{color:#a12622}button:disabled{opacity:.55;cursor:wait}
      @media(max-width:560px){.body{grid-template-columns:1fr}canvas{max-height:240px}footer button{flex:1}}
    </style>
    <section role="dialog" aria-modal="true" aria-labelledby="review-title"><article>
      <header><h2 id="review-title">UPShield upload review</h2><p>Image processing stays on this device.</p></header>
      <div class="body"><div><canvas aria-label="Image preview with detected sensitive areas highlighted"></canvas><p class="notice">Metadata will be removed when the image is re-encoded.</p></div>
        <div><p class="status" aria-live="polite">Scanning locally with English/Tamil OCR...</p><ul></ul></div></div>
      <footer><button class="danger cancel">Cancel Upload</button><button class="selected" disabled>Redact Selected</button><button class="primary all" disabled>Redact All</button><button class="primary confirm" hidden>Upload Sanitized Image</button></footer>
    </article></section>`;
  const preview = shadow.querySelector("canvas");
  document.documentElement.append(host);

  const done = () => {
    host.remove();
    activeReview = false;
  };
  shadow.querySelector(".cancel").addEventListener("click", () => {
    done();
    onCancel();
  });

  let detections = [];
  let sanitizedFile = null;
  const setBusy = (busy) => shadow.querySelectorAll("button:not(.cancel)").forEach((button) => { button.disabled = busy; });
  const approve = async (selected) => {
    setBusy(true);
    shadow.querySelector(".status").textContent = "Creating a sanitized image...";
    try {
      sanitizedFile = await redactImage(file, selected);
      const image = await createImageBitmap(sanitizedFile);
      preview.width = image.width;
      preview.height = image.height;
      preview.getContext("2d").drawImage(image, 0, 0);
      image.close();
      shadow.querySelector(".selected").hidden = true;
      shadow.querySelector(".all").hidden = true;
      shadow.querySelector(".confirm").hidden = false;
      shadow.querySelector(".confirm").disabled = false;
      shadow.querySelector(".notice").textContent = "Redacted PNG preview. Source metadata was removed.";
      shadow.querySelector(".status").textContent = "Inspect the sanitized preview, then confirm to pass it to the AI site.";
    } catch {
      setBusy(false);
      shadow.querySelector(".status").textContent = "Image processing failed. Cancel this upload and try another image.";
      shadow.querySelector(".status").classList.add("error");
    }
  };
  shadow.querySelector(".confirm").addEventListener("click", () => {
    if (!sanitizedFile) return;
    done();
    onApprove(sanitizedFile);
  });
  shadow.querySelector(".all").addEventListener("click", () => approve(detections));
  shadow.querySelector(".selected").addEventListener("click", () => {
    const selected = [...shadow.querySelectorAll("input[type=checkbox]:checked")].map((input) => Number(input.dataset.index));
    approve(detections.filter((_, index) => selected.includes(index)));
  });

  if (!isSupported(file)) {
    shadow.querySelector(".status").textContent = "Only PNG and JPG are supported. This upload is blocked.";
    shadow.querySelector(".status").classList.add("error");
    return;
  }

  scanImage(file, ({ status, progress }) => {
    shadow.querySelector(".status").textContent = `${status} (${Math.round(progress * 100)}%)`;
  }).then(({ detections: results, metadata }) => {
    detections = results;
    createImageBitmap(file).then((image) => {
      preview.width = image.width;
      preview.height = image.height;
      const context = preview.getContext("2d");
      context.drawImage(image, 0, 0);
      context.strokeStyle = "#d95d16";
      context.fillStyle = "#e89a321f";
      context.lineWidth = Math.max(3, Math.round(image.width / 280));
      detections.forEach(({ boundingBox }) => {
        if (!boundingBox) return;
        context.fillRect(boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height);
        context.strokeRect(boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height);
      });
      image.close();
    });
    const list = shadow.querySelector("ul");
    if (!detections.length) {
      list.innerHTML = "<li>No supported sensitive patterns were found.</li>";
      shadow.querySelector(".selected").textContent = "Continue Without Redaction";
      shadow.querySelector(".all").textContent = "Continue Without Redaction";
    } else {
      detections.forEach((item, index) => {
        const row = document.createElement("li");
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.dataset.index = String(index);
        checkbox.addEventListener("change", () => {
          shadow.querySelector(".selected").disabled = !shadow.querySelector("input[type=checkbox]:checked");
        });
        const text = document.createElement("span");
        text.textContent = `${item.type}: ${item.matchedText}`;
        const detail = document.createElement("small");
        detail.textContent = `${item.confidence}% OCR confidence · ${item.riskLevel} risk${item.validation === "unverified-format" ? " · unverified format" : ""}`;
        text.append(detail);
        label.append(checkbox, text);
        row.append(label);
        list.append(row);
      });
    }
    shadow.querySelector(".selected").disabled = false;
    shadow.querySelector(".all").disabled = false;
    const metadataParts = [];
    if (metadata.exifFound) metadataParts.push("EXIF found");
    if (metadata.gpsFound) metadataParts.push("GPS found");
    if (metadata.deviceModelFound) metadataParts.push("device model found");
    if (metadata.timestampFound) metadataParts.push("timestamp found");
    shadow.querySelector(".notice").textContent = `${metadataParts.join(" · ") || "No EXIF found"}. Metadata removed on export.`;
    shadow.querySelector(".status").textContent = detections.length
      ? `${detections.length} finding${detections.length === 1 ? "" : "s"} · review before upload`
      : "No matches found. Automated scanning cannot prove the image is safe; review it manually before continuing.";
  }).catch((error) => {
    shadow.querySelector(".status").textContent = `Local scan failed: ${scanErrorMessage(error)}`;
    shadow.querySelector(".status").classList.add("error");
  });
}

function interceptFile(file, onApprove, onCancel) {
  if (!file || activeReview) return;
  activeReview = true;
  createReview(file, onApprove, onCancel);
}

document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
  const files = [...(input.files || [])];
  const image = files.find(isImage);
  if (!image) return;
  if (replayedFiles.has(image)) {
    replayedFiles.delete(image);
    return;
  }
  event.stopImmediatePropagation();
  event.preventDefault();
  input.value = "";
  interceptFile(image, (sanitized) => {
    const transfer = new DataTransfer();
    transfer.items.add(sanitized);
    replayedFiles.add(sanitized);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, () => { input.value = ""; });
}, true);

document.addEventListener("drop", (event) => {
  const file = [...(event.dataTransfer?.files || [])].find(isImage);
  if (!file || replayedFiles.has(file)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  interceptFile(file, (sanitized) => {
    const transfer = new DataTransfer();
    transfer.items.add(sanitized);
    replayedFiles.add(sanitized);
    event.target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, () => {});
}, true);

document.addEventListener("paste", (event) => {
  if (replayedPasteEvents.has(event)) return;
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const file = [...clipboard.files].find(isImage) || [...clipboard.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .find(isImage);
  if (!file) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  interceptFile(file, (sanitized) => {
    const transfer = new DataTransfer();
    for (const type of clipboard.types) {
      if (type === "Files") continue;
      const value = clipboard.getData(type);
      if (value) transfer.setData(type, value);
    }
    transfer.items.add(sanitized);
    const replay = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    });
    replayedPasteEvents.add(replay);
    event.target.dispatchEvent(replay);
  }, () => {});
}, true);
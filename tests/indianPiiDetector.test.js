const test = require("node:test");
const assert = require("node:assert/strict");
const { detectIndianPii, isLuhnValid, isVerhoeffValid } = require("../src/lib/indianPiiDetector");
const { flattenOcrWords } = require("../scanner");
const { arrayBufferToDataUrl, dataUrlToBytes } = require("../src/lib/imageDataUrl");
const { barcodeBoundsFromPoints } = require("../src/lib/visualGeometry");
const { BarcodeFormat, QRCodeWriter } = require("@zxing/library");
const { decodeBarcodePixels } = require("../src/lib/barcodeDecoder");
const { findQrLikeRegion, findQrLikeRegionFromImage } = require("../src/lib/qrRegionDetector");
const { scaleOcrWordBoxes } = require("../src/lib/ocrGeometry");
const { createFaceDetectors } = require("../src/lib/faceModels");
const { scanErrorMessage } = require("../src/lib/scanErrorMessage");
const { isPaymentCardText } = require("../src/lib/sensitiveImageContext");

function word(text, x, y, confidence = 92) {
  return { text, confidence, bbox: { x0: x, y0: y, x1: x + text.length * 9, y1: y + 14 } };
}

test("validates Verhoeff and Luhn checksums", () => {
  assert.equal(isVerhoeffValid("2363"), true);
  assert.equal(isVerhoeffValid("123456789012"), false);
  assert.equal(isLuhnValid("4111 1111 1111 1111"), true);
  assert.equal(isLuhnValid("4111 1111 1111 1112"), false);
});

test("detects PAN and OTP only with nearby context and maps their boxes", () => {
  const words = [word("PAN:", 0, 0), word("ABCDE1234F", 45, 0), word("OTP", 0, 22), word("4321", 30, 22)];
  const detections = detectIndianPii(words);
  assert.deepEqual(detections.map(({ type }) => type), ["PAN", "OTP"]);
  assert.deepEqual(detections[0].boundingBox, { x: 45, y: 0, width: 90, height: 14 });
  assert.equal(detections[1].matchedText, "4321");
});

test("does not classify an unlabelled PAN-like token as PAN", () => {
  const detections = detectIndianPii([word("ABCDE1234F", 10, 10)]);
  assert.equal(detections.some(({ type }) => type === "PAN"), false);
});

test("detects checksum-valid Aadhaar, mobile, UPI, and card values", () => {
  const values = ["223456789018", "9876543210", "person@okaxis", "4111111111111111"];
  const words = values.map((value, index) => word(value, index * 170, 10));
  const detections = detectIndianPii(words);
  assert.deepEqual(detections.map(({ type }) => type).sort(), ["Aadhaar", "Card number", "Indian mobile number", "UPI ID"]);
});

test("rejects Aadhaar candidates with an invalid checksum or leading digit", () => {
  const detections = detectIndianPii([word("123456789010", 0, 0), word("223456789019", 150, 0)]);
  assert.equal(detections.filter(({ type }) => type === "Aadhaar").length, 2);
  assert.ok(detections.every(({ validation }) => validation === "unverified-format"));
});

test("flattens Tesseract block output and detects screenshot-style phone and PAN", () => {
  const blocks = [{ paragraphs: [{ lines: [{ words: [
    word("Phone:", 0, 10), word("9876543210", 60, 10),
    word("PAN:", 0, 32), word("ABCDE1234F", 42, 32)
  ] }] }] }];
  const words = flattenOcrWords(blocks);
  const detections = detectIndianPii(words);
  assert.deepEqual(detections.map(({ type }) => type).sort(), ["Indian mobile number", "PAN"]);
  assert.deepEqual(detections.map(({ matchedText }) => matchedText).sort(), ["9876543210", "ABCDE1234F"]);
});

test("preserves PNG bytes and MIME type through extension message serialization", () => {
  const source = Uint8Array.from([137, 80, 78, 71, 0, 255, 12, 34]);
  const dataUrl = arrayBufferToDataUrl(source.buffer, "image/png");
  const decoded = dataUrlToBytes(dataUrl);
  assert.equal(decoded.mimeType, "image/png");
  assert.deepEqual([...decoded.bytes], [...source]);
});

test("detects passport, driving licence, email, phone, address, contacts, and bank details", () => {
  const sourceLines = [
    "Passport: X7M2K91Q",
    "Driving licence: MH14 2011 0067482",
    "Email: riya@example.com",
    "Phone: +1 415 555 0199",
    "Home address:",
    "12 Main Street Chennai 600001",
    "Emergency contact: Riya 9876543210",
    "Personal contact list:",
    "Maya +91 9876543210",
    "Arun maya@example.in",
    "Account number: 123456789012",
    "UTR: 12345678901234567890"
  ];
  const words = sourceLines.flatMap((line, row) => line.split(/\s+/).map((text, index) => ({
    ...word(text, index * 90, row * 22),
    lineBreakBefore: index === 0
  })));
  const detections = detectIndianPii(words);
  const types = new Set(detections.map(({ type }) => type));
  for (const type of ["Passport number", "Driving licence number", "Email address", "Phone number", "Home address", "Personal contact details", "Bank account number", "Bank transaction details"]) {
    assert.ok(types.has(type), `Expected ${type}`);
  }
  const address = detections.find(({ type }) => type === "Home address");
  assert.ok(address.matchedText.includes("12 Main Street Chennai 600001"));
  const contacts = detections.find(({ type, matchedText }) => type === "Personal contact details" && matchedText.includes("Personal contact list"));
  assert.ok(contacts.matchedText.includes("Maya +91 9876543210"));
  assert.ok(contacts.matchedText.includes("Arun maya@example.in"));
});

test("creates a padded in-image box for QR/barcode result points", () => {
  const points = [
    { getX: () => 10, getY: () => 20 },
    { getX: () => 50, getY: () => 20 },
    { getX: () => 10, getY: () => 60 }
  ];
  const bounds = barcodeBoundsFromPoints(points, 100, 100);
  assert.ok(bounds.x <= 10 && bounds.y <= 20);
  assert.ok(bounds.x + bounds.width >= 50 && bounds.y + bounds.height >= 60);
  assert.equal(barcodeBoundsFromPoints(points, 40, 50).x + barcodeBoundsFromPoints(points, 40, 50).width, 40);
});

test("redacts identity numbers and DOB without selecting every identity-document line", () => {
  const words = [
    { ...word("AADHAAR", 10, 10), lineBreakBefore: true },
    { ...word("Name:", 10, 32), lineBreakBefore: true },
    { ...word("TEST", 65, 32), lineBreakBefore: false },
    { ...word("DOB:", 10, 54), lineBreakBefore: true },
    { ...word("04/08/2006", 55, 54), lineBreakBefore: false },
    { ...word("8713", 10, 76), lineBreakBefore: true },
    { ...word("2631", 55, 76), lineBreakBefore: false },
    { ...word("8559", 100, 76), lineBreakBefore: false },
    { ...word("Government", 10, 98), lineBreakBefore: true }
  ];
  const detections = detectIndianPii(words);
  assert.equal(detections.some(({ type }) => type === "Identity document text"), false);
  assert.ok(detections.some(({ type, matchedText }) => type === "Date of birth" && matchedText === "04/08/2006"));
  assert.ok(detections.some(({ type, matchedText }) => type === "Aadhaar" && matchedText === "8713 2631 8559"));
  assert.ok(detections.every(({ boundingBox }) => boundingBox.width < 200 && boundingBox.height < 30));
  assert.equal(detections.some(({ matchedText }) => matchedText.includes("Government")), false);
});

test("detects a street address without an explicit address label", () => {
  const value = "12 Main Street, Chennai 600001";
  const detections = detectIndianPii([word(value, 10, 10)]);
  assert.ok(detections.some(({ type, matchedText }) => type === "Home address" && matchedText.includes(value)));
});

test("detects OCR-split emails and extracts only GPS coordinates from the watermark", () => {
  const lines = [
    ["Email:", "student", "@gmail.com"],
    ["GPS", "Map", "Camera"],
    ["—", "PX", "|", "Lat", "13.026248°", "Long", "80.014114°", "-"],
    ["Mevalurkuppam,", "Tamil", "Nadu,", "India"]
  ];
  const words = lines.flatMap((line, row) => line.map((text, index) => ({
    ...word(text, index * 110, row * 22),
    lineBreakBefore: index === 0
  })));
  const detections = detectIndianPii(words);
  assert.ok(detections.some(({ type, matchedText }) => type === "Email address" && matchedText.includes("@gmail.com")));
  const coordinates = detections.find(({ type }) => type === "GPS coordinates");
  assert.ok(coordinates);
  assert.equal(coordinates.matchedText, "Lat 13.026248° Long 80.014114°");
  assert.ok(coordinates.boundingBox.x > 0);
  assert.ok(!detections.some(({ type }) => type === "GPS location overlay"));
});

test("does not flag a printed date/time as an Aadhaar candidate", () => {
  const words = [word("Aadhaar:", 0, 0), word("24-04-2025", 70, 0), word("03-08", 170, 0)];
  const detections = detectIndianPii(words);
  assert.equal(detections.some(({ type }) => type === "Aadhaar"), false);
});

test("redacts email lines when OCR splits or omits the at-sign", () => {
  const lines = [
    ["Email:", "dnrajalashmi83", "@", "gmail", ".", "com"],
    ["Email:", "studentname"],
    ["Email", "studentname", "gmail.com"],
    ["riya", "patel", "yahoo.com"]
  ];
  const words = lines.flatMap((line, row) => line.map((text, index) => ({
    ...word(text, index * 100, row * 24),
    lineBreakBefore: index === 0
  })));
  const findings = detectIndianPii(words).filter(({ type }) => type === "Email address");
  assert.equal(findings.length, 4);
  assert.ok(findings.some(({ matchedText }) => matchedText.includes("dnrajalashmi83")));
  assert.ok(findings.some(({ validation }) => ["email-line-fallback", "mail-domain-fallback"].includes(validation)));
  assert.ok(findings.some(({ validation }) => validation === "mail-domain-fallback"));
  assert.equal(detectIndianPii([word("person@okaxis", 0, 0)]).some(({ type }) => type === "Email address"), false);
});

test("finds an email value in the same visual row as a separated Email label", () => {
  const words = [
    { ...word("Email", 20, 100), lineBreakBefore: true },
    { ...word("dnrajalashmi83@gmail.com", 250, 100), lineBreakBefore: true }
  ];
  const finding = detectIndianPii(words).find(({ type }) => type === "Email address");
  assert.ok(finding);
  assert.ok(finding.boundingBox.x >= 250);
  assert.ok(finding.matchedText.includes("gmail.com"));
});

test("recognizes a Gmail address when OCR drops the dot and misreads one letter", () => {
  const text = "dnrajlashmig3@gmalcom";
  const finding = detectIndianPii([word(text, 20, 20)]).find(({ type }) => type === "Email address");
  assert.ok(finding);
  assert.equal(finding.matchedText, text);
  assert.notEqual(finding.type, "UPI ID");
});

test("detects Tamil Nadu driving licence number without needing its heading", () => {
  const words = [
    { ...word("TN21", 40, 30), lineBreakBefore: true },
    { ...word("20250001887", 95, 30), lineBreakBefore: false }
  ];
  const finding = detectIndianPii(words).find(({ type }) => type === "Driving licence number");
  assert.ok(finding);
  assert.equal(finding.matchedText, "TN21 20250001887");
});

test("decodes a generated QR image and returns a redaction box", () => {
  const matrix = new QRCodeWriter().encode("https://example.test/private", BarcodeFormat.QR_CODE, 180, 180, new Map());
  const pixels = new Uint8ClampedArray(matrix.getWidth() * matrix.getHeight() * 4);
  for (let y = 0; y < matrix.getHeight(); y += 1) {
    for (let x = 0; x < matrix.getWidth(); x += 1) {
      const offset = (y * matrix.getWidth() + x) * 4;
      const shade = matrix.get(x, y) ? 0 : 255;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = 255;
    }
  }
  const result = decodeBarcodePixels(pixels, matrix.getWidth(), matrix.getHeight());
  assert.equal(result.type, "QR code");
  assert.ok(result.boundingBox.width > 100 && result.boundingBox.height > 100);
});

test("decodes a dense low-contrast QR image", () => {
  const matrix = new QRCodeWriter().encode(`https://example.test/${"private-data-".repeat(22)}`, BarcodeFormat.QR_CODE, 320, 320, new Map());
  const pixels = new Uint8ClampedArray(matrix.getWidth() * matrix.getHeight() * 4);
  for (let y = 0; y < matrix.getHeight(); y += 1) {
    for (let x = 0; x < matrix.getWidth(); x += 1) {
      const offset = (y * matrix.getWidth() + x) * 4;
      const shade = matrix.get(x, y) ? 30 : 220;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = 255;
    }
  }
  const result = decodeBarcodePixels(pixels, matrix.getWidth(), matrix.getHeight());
  assert.equal(result.type, "QR code");
  assert.ok(result.boundingBox.width > 250 && result.boundingBox.height > 250);
});

test("locates a dense QR-like region when its contents cannot be decoded", () => {
  const size = 140;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= 20 && x < 120 && y >= 20 && y < 120;
      const shade = inside ? ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 30 : 205) : 245;
      const offset = (y * size + x) * 4;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = 255;
    }
  }
  const result = findQrLikeRegion(pixels, size, size);
  assert.equal(result.type, "QR code");
  assert.ok(result.boundingBox.x <= 20 && result.boundingBox.y <= 20);
  assert.ok(result.boundingBox.x + result.boundingBox.width >= 120);
});

test("finds a QR-like region inside a larger photo instead of requiring a full-image QR", () => {
  const width = 260;
  const height = 220;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= 130 && x < 230 && y >= 45 && y < 145;
      const shade = inside ? ((Math.floor((x - 130) / 2) + Math.floor((y - 45) / 2)) % 2 ? 30 : 205) : 245;
      const offset = (y * width + x) * 4;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = 255;
    }
  }
  const result = findQrLikeRegionFromImage(pixels, width, height);
  assert.equal(result.type, "QR code");
  assert.ok(result.boundingBox.x <= 130 && result.boundingBox.y <= 45);
  assert.ok(result.boundingBox.x + result.boundingBox.width >= 230);
  assert.ok(result.boundingBox.y + result.boundingBox.height >= 145);
});

test("detects a transaction ID on the line after its label", () => {
  const words = [
    { ...word("Transaction", 0, 0), lineBreakBefore: true },
    { ...word("ID:", 100, 0), lineBreakBefore: false },
    { ...word("UTR20241015123456789", 0, 24), lineBreakBefore: true }
  ];
  const finding = detectIndianPii(words).find(({ type }) => type === "Bank transaction/reference ID");
  assert.ok(finding);
  assert.ok(finding.matchedText.includes("UTR20241015123456789"));
});

test("detects a labeled UPI line when OCR loses the @ sign", () => {
  const words = [word("UPI", 5, 10), word("ID:", 35, 10), word("nraresh29", 65, 10), word("oksb", 155, 10)];
  const finding = detectIndianPii(words).find(({ type }) => type === "UPI ID");
  assert.ok(finding);
  assert.equal(finding.validation, "upi-line-fallback");
  assert.ok(finding.boundingBox.x <= 5 && finding.boundingBox.width >= 180);
});

test("scales OCR word boxes back to original image coordinates", () => {
  const scaled = scaleOcrWordBoxes([word("email", 40, 80)], 4, 4);
  assert.deepEqual(scaled[0].bbox, { x0: 10, y0: 20, x1: 21.25, y1: 23.5 });
});

test("loads both face models with Promise.all and preserves their confidence thresholds", async () => {
  const loaded = await createFaceDetectors(
    async (path, minScore) => ({ path, minScore }),
    (path) => `extension://${path}`
  );
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map(({ minScore }) => minScore), [0.5, 0.3]);
  assert.equal(loaded[1].detector.path, "extension://models/face_detector_full_range.tflite");
});

test("explains that an invalidated extension requires a site-tab refresh and blocks upload", () => {
  const message = scanErrorMessage(new Error("Extension context invalidated."));
  assert.match(message, /Refresh this ChatGPT tab/);
  assert.match(message, /Upload remains blocked/);
});

test("redacts labeled card details even when the card number fails OCR validation", () => {
  const words = [
    { ...word("Credit", 0, 0), lineBreakBefore: true },
    { ...word("card", 60, 0), lineBreakBefore: false },
    { ...word("number:", 105, 0), lineBreakBefore: false },
    { ...word("4111", 0, 20), lineBreakBefore: true },
    { ...word("1111", 45, 20), lineBreakBefore: false },
    { ...word("1111", 90, 20), lineBreakBefore: false },
    { ...word("1112", 135, 20), lineBreakBefore: false },
    { ...word("CVV:", 0, 40), lineBreakBefore: true },
    { ...word("123", 55, 40), lineBreakBefore: false }
  ];
  assert.ok(detectIndianPii(words).some(({ type, matchedText }) => type === "Credit/debit card details" && matchedText.includes("4111 1111 1111 1112")));
});

test("does not label a reference-like number as a phone from a distant row", () => {
  const words = [
    { ...word("Phone:", 0, 0), lineBreakBefore: true },
    { ...word("Name", 0, 22), lineBreakBefore: true },
    { ...word("Reference", 0, 44), lineBreakBefore: true },
    { ...word("2024050727572", 90, 44), lineBreakBefore: false }
  ];
  assert.equal(detectIndianPii(words).some(({ type, matchedText }) => type === "Phone number" && matchedText.includes("2024050727572")), false);
});

test("recognizes payment-card OCR and selects only card number and expiry lines", () => {
  const words = [
    { ...word("BOBCARD", 0, 0), lineBreakBefore: true },
    { ...word("CORPORATE", 100, 0), lineBreakBefore: false },
    { ...word("1234", 0, 24), lineBreakBefore: true },
    { ...word("5678", 45, 24), lineBreakBefore: false },
    { ...word("9012", 90, 24), lineBreakBefore: false },
    { ...word("3456", 135, 24), lineBreakBefore: false },
    { ...word("EXPIRES", 0, 48), lineBreakBefore: true },
    { ...word("01/31", 72, 48), lineBreakBefore: false }
  ];
  const findings = detectIndianPii(words);
  assert.equal(isPaymentCardText("BOBCARD CORPORATE EXPIRES 01/31"), true);
  assert.ok(findings.some(({ type, validation, boundingBox }) =>
    type === "Credit/debit card details" && validation === "card-value-line" && boundingBox.height < 30));
});

test("redacts an email split into a user-name row and Gmail domain row", () => {
  const words = [
    { ...word("arvind.s", 0, 0), lineBreakBefore: true },
    { ...word("gmail.com", 0, 20), lineBreakBefore: true }
  ];
  const finding = detectIndianPii(words).find(({ type }) => type === "Email address");
  assert.ok(finding);
  assert.match(finding.validation, /mail-domain/);
  assert.ok(finding.matchedText.includes("arvind.s"));
  assert.ok(finding.boundingBox.height > 20);
});

test("continues a labeled email through a dotted username onto the Gmail domain row", () => {
  const words = [
    { ...word("Email:", 0, 0), lineBreakBefore: true },
    { ...word("first.last", 65, 0), lineBreakBefore: false },
    { ...word("gmail.com", 0, 20), lineBreakBefore: true }
  ];
  const finding = detectIndianPii(words).find(({ type }) => type === "Email address");
  assert.ok(finding);
  assert.match(finding.validation, /mail-domain|email-line/);
  assert.ok(finding.boundingBox.height > 20);
});

test("keeps payment-card redaction to card-related OCR rows", () => {
  const words = [
    { ...word("MEMBERSHIP", 0, 0), lineBreakBefore: true },
    { ...word("CARD", 80, 0), lineBreakBefore: false },
    { ...word("BOBCARD", 0, 24), lineBreakBefore: true },
    { ...word("1234", 0, 48), lineBreakBefore: true },
    { ...word("5678", 45, 48), lineBreakBefore: false },
    { ...word("9012", 90, 48), lineBreakBefore: false },
    { ...word("3456", 135, 48), lineBreakBefore: false },
    { ...word("EXPIRES", 0, 72), lineBreakBefore: true },
    { ...word("01/31", 72, 72), lineBreakBefore: false },
    { ...word("UNRELATED", 0, 300), lineBreakBefore: true }
  ];
  const finding = detectIndianPii(words).find(({ type, validation }) =>
    type === "Credit/debit card details" && validation === "card-value-line");
  assert.ok(finding);
  assert.ok(finding.boundingBox.height < 20);
  assert.ok(!finding.matchedText.includes("UNRELATED"));
  assert.ok(!finding.matchedText.includes("BOBCARD"));
});

test("detects Google transaction and reference IDs without selecting nearby labels", () => {
  const lines = [
    ["Google", "transaction", "ID"],
    ["CICApGjP4MKMgw", "Reference", "No:", "2024050727572"]
  ];
  const words = lines.flatMap((line, row) => line.map((text, index) => ({
    ...word(text, index * 100, row * 22),
    lineBreakBefore: index === 0
  })));
  const findings = detectIndianPii(words).filter(({ type }) => type === "Bank transaction/reference ID");
  assert.ok(findings.some(({ matchedText }) => matchedText === "CICApGjP4MKMgw"));
  assert.ok(findings.some(({ matchedText }) => matchedText === "2024050727572"));
  assert.ok(findings.every(({ boundingBox }) => boundingBox.width < 200));
});

test("detects GPS coordinates and capture time without including unrelated watermark text", () => {
  const lines = [
    ["Ordinary", "photo", "caption"],
    ["GPS", "Map", "Camera"],
    ["Mevalurkuppam,", "Tamil", "Nadu,", "India"],
    ["—", "PX", "|", "Lat", "13.026248°", "Long", "80.014114°", "-"],
    ["Tuesday,", "06/10/2026", "09:30", "AM", "GMT", "+05:30"],
    ["Unrelated", "caption", "outside", "overlay"]
  ];
  const words = lines.flatMap((line, row) => line.map((text, index) => ({
    ...word(text, index * 70, row * 22),
    lineBreakBefore: index === 0
  })));
  const detections = detectIndianPii(words);
  const coordinates = detections.find(({ type }) => type === "GPS coordinates");
  const timestamp = detections.find(({ type }) => type === "GPS capture timestamp");
  assert.ok(coordinates);
  assert.ok(timestamp);
  assert.equal(coordinates.matchedText, "Lat 13.026248° Long 80.014114°");
  assert.equal(timestamp.matchedText, "06/10/2026 09:30 AM GMT +05:30");
  assert.ok(!coordinates.matchedText.includes("PX"));
  assert.ok(!timestamp.matchedText.includes("Tuesday"));
  assert.ok(!detections.some(({ type }) => type === "GPS location overlay"));
  assert.ok(coordinates.boundingBox.width < 320);
  assert.ok(timestamp.boundingBox.width < 400);
  assert.ok(!detections.some(({ matchedText }) => matchedText.includes("Unrelated")));
});

test("masks DOB on a driving licence without masking every text line", () => {
  const lines = [
    "Indian Union Driving Licence",
    "Name: NARESH N R",
    "Date of Birth: 04-08-2006",
    "Address: 11 Anna Nagar Kancheepuram Tamil Nadu",
    "Blood Group: O-"
  ];
  const words = lines.flatMap((line, row) => line.split(/\s+/).map((text, index) => ({
    ...word(text, index * 70, row * 22),
    lineBreakBefore: index === 0
  })));
  const findings = detectIndianPii(words);
  assert.equal(findings.some(({ type }) => type === "Identity document text"), false);
  assert.ok(findings.some(({ type, matchedText }) => type === "Date of birth" && matchedText === "04-08-2006"));
  assert.ok(findings.every(({ boundingBox }) => boundingBox.height < 30));
});
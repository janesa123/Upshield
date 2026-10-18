const { isPaymentCardText } = require("./sensitiveImageContext");

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function isVerhoeffValid(value) {
  const digits = String(value).replace(/\D/g, "").split("").reverse().map(Number);
  if (!digits.length) return false;
  let checksum = 0;
  digits.forEach((digit, index) => {
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[index % 8][digit]];
  });
  return checksum === 0 && VERHOEFF_INV[checksum] === 0;
}

function isLuhnValid(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function makeTextMap(words) {
  let text = "";
  const spans = [];
  words.forEach((word) => {
    const value = String(word.text || "").trim();
    if (!value) return;
    if (text) text += word.lineBreakBefore ? "\n" : " ";
    const start = text.length;
    text += value;
    spans.push({ start, end: text.length, word });
  });
  return { text, spans };
}

function boundsForRange(spans, start, end) {
  const matches = spans.filter((span) => span.end > start && span.start < end);
  if (!matches.length) return null;
  const boxes = matches.map(({ word }) => word.bbox || {});
  const x0 = Math.min(...boxes.map((box) => box.x0 ?? 0));
  const y0 = Math.min(...boxes.map((box) => box.y0 ?? 0));
  const x1 = Math.max(...boxes.map((box) => box.x1 ?? 0));
  const y1 = Math.max(...boxes.map((box) => box.y1 ?? 0));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function confidenceForRange(spans, start, end) {
  const matches = spans.filter((span) => span.end > start && span.start < end);
  if (!matches.length) return 0;
  return Math.round(matches.reduce((sum, { word }) => sum + (word.confidence || 0), 0) / matches.length);
}

function detectIndianPii(words, fallbackText = "") {
  const { text: ocrText, spans } = makeTextMap(words);
  const text = ocrText || fallbackText;
  const detections = [];
  const add = (type, match, start, end, riskLevel = "high", validation) => {
    const boundingBox = boundsForRange(spans, start, end);
    if (!boundingBox) return;
    if (detections.some((item) => item.type === type && item.matchedText === match)) return;
    detections.push({ type, matchedText: match, confidence: confidenceForRange(spans, start, end), boundingBox, recommendedAction: "redact", riskLevel, validation });
  };
  const hasNearbyKeyword = (start, end, pattern) => pattern.test(text.slice(Math.max(0, start - 48), Math.min(text.length, end + 48)));
  const lineRange = (start, end) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = text.indexOf("\n", end);
    return [lineStart, nextBreak < 0 ? text.length : nextBreak];
  };
    const contextAroundLines = (start, end) => {
      const [lineStart, lineEnd] = lineRange(start, end);
      const previousBreak = text.lastIndexOf("\n", lineStart - 2);
      const nextBreak = text.indexOf("\n", lineEnd + 1);
      return text.slice(previousBreak < 0 ? 0 : previousBreak + 1, nextBreak < 0 ? text.length : nextBreak);
    };

  for (const match of text.matchAll(/\b(?:\d[ -]?){11}\d\b/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length === 12) {
      const [candidateLineStart, candidateLineEnd] = lineRange(match.index, match.index + match[0].length);
      const candidateLine = text.slice(candidateLineStart, candidateLineEnd);
      if (/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(match[0]) ||
        /\b(?:date|dob|issued|validity|expires?)\b/i.test(candidateLine)) continue;
      const checksumValid = isVerhoeffValid(digits) && /^[2-9]/.test(digits);
      add("Aadhaar", match[0], match.index, match.index + match[0].length,
        checksumValid ? "high" : "medium", checksumValid ? "checksum-valid" : "unverified-format");
    }
  }
  for (const match of text.matchAll(/\b[A-Z]{5}\d{4}[A-Z]\b/gi)) {
    if (hasNearbyKeyword(match.index, match.index + match[0].length, /\b(?:PAN|permanent account)\b/i)) add("PAN", match[0], match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/\b(?=[A-Z0-9]{6,9}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6,9}\b/gi)) {
    if (hasNearbyKeyword(match.index, match.index + match[0].length, /\bpassport(?:\s*(?:no|number))?\b/i)) {
      add("Passport number", match[0], match.index, match.index + match[0].length);
    }
  }
  const indianStateCodes = new Set("AN AP AR AS BR CH CG DD DL DN GA GJ HR HP JK JH KA KL LD MP MH MN ML MZ NL OD OR PB PY RJ SK TN TS TR UP UK WB".split(" "));
  for (const match of text.matchAll(/\b[A-Z]{2}[- ]?\d{2}[- ]?\d{4}[- ]?\d{7,11}\b/gi)) {
    const stateCode = match[0].slice(0, 2).toUpperCase();
    if (indianStateCodes.has(stateCode) ||
      hasNearbyKeyword(match.index, match.index + match[0].length, /\b(?:driving licen[cs]e|driver'?s licen[cs]e|DL\s*(?:no|number)|issued by government)\b/i)) {
      add("Driving licence number", match[0], match.index, match.index + match[0].length);
    }
  }
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\s*\.\s*[A-Z]{2,}\b/gi)) {
    add("Email address", match[0], match.index, match.index + match[0].length, "medium");
  }
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]{2,}\s*@\s*(?:g(?:mail|mal|mai1|ma1l)\s*\.?\s*(?:com|in)|googlemail\s*\.?\s*(?:com|in)|yahoo\s*\.?\s*(?:com|in)|outlook\s*\.?\s*(?:com|in)|hotmail\s*\.?\s*(?:com|in)|icloud\s*\.?\s*(?:com|in))\b/gi)) {
    add("Email address", match[0], match.index, match.index + match[0].length, "medium", "common-mail-domain-ocr-fallback");
  }
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]{2,}\s+(?:gmail|googlemail|yahoo|outlook|hotmail|live|icloud|protonmail)\s*\.\s*(?:com|in|org|net|co\s*\.\s*in|co\s*\.\s*uk)\b/gi)) {
    add("Email address", match[0], match.index, match.index + match[0].length, "medium", "mail-domain-fallback");
  }
  for (const match of text.matchAll(/\b(?:gmail|googlemail|yahoo|outlook|hotmail|live|icloud|protonmail)\s*\.\s*(?:com|in|org|net|co\s*\.\s*in|co\s*\.\s*uk)\b/gi)) {
    const [lineStart, lineEnd] = lineRange(match.index, match.index + match[0].length);
    let start = lineStart;
    let end = lineEnd;
    if (lineStart > 0) {
      const previousStart = text.lastIndexOf("\n", lineStart - 2) + 1;
      const previousLine = text.slice(previousStart, lineStart).trim();
      if (/^[A-Z0-9._%+-]{2,}$/i.test(previousLine)) start = previousStart;
    }
    const value = text.slice(start, end).trim();
    const box = boundsForRange(spans, start, end);
    if (!detections.some((item) => item.type === "Email address" && box && item.boundingBox.y === box.y)) {
      add("Email address", value, start, end, "medium", "mail-domain-only-fallback");
    }
  }
  for (const match of text.matchAll(/[^\n]+/g)) {
    const line = match[0].trim();
    if (!/\bemail\b/i.test(line)) continue;
    let start = match.index + match[0].indexOf(line);
    let [, end] = lineRange(start, start + line.length);
    let value = text.slice(start, end).trim();
    if (!/@|(?:gmail|googlemail|yahoo|outlook|hotmail|live|icloud|protonmail)\s*\./i.test(value) && end < text.length) {
      for (let row = 0; row < 2 && end < text.length; row += 1) {
        const nextStart = end + 1;
        const nextBreak = text.indexOf("\n", nextStart);
        const nextEnd = nextBreak < 0 ? text.length : nextBreak;
        const nextLine = text.slice(nextStart, nextEnd).trim();
        if (!nextLine || /^(?:email|e-mail|phone|mobile|address|date|dob|account|transaction)\b/i.test(nextLine)) break;
        end = nextEnd;
        value = text.slice(start, end).trim();
        if (/@|gmail|yahoo|outlook|hotmail|icloud|protonmail/i.test(value)) break;
      }
    }
    const emailLabelSpan = spans.find((span) => span.start >= start && span.end <= end &&
      /^e-?mail:?$/i.test(span.word.text.trim()));
    if (emailLabelSpan) {
      const labelBox = emailLabelSpan.word.bbox || {};
      const labelCenterY = ((labelBox.y0 ?? 0) + (labelBox.y1 ?? 0)) / 2;
      const labelHeight = Math.max(1, (labelBox.y1 ?? 0) - (labelBox.y0 ?? 0));
      const valueSpans = spans.filter((span) => {
        if (span === emailLabelSpan) return false;
        const box = span.word.bbox || {};
        const centerY = ((box.y0 ?? 0) + (box.y1 ?? 0)) / 2;
        return (box.x0 ?? -1) >= (labelBox.x1 ?? 0) - 2 &&
          Math.abs(centerY - labelCenterY) <= labelHeight * 1.5;
      });
      if (valueSpans.length) {
        start = Math.min(...valueSpans.map((span) => span.start));
        end = Math.max(...valueSpans.map((span) => span.end));
        value = valueSpans.map(({ word }) => word.text).join(" ");
      }
    }
    const exactAddressOnLine = detections.some((item) => item.type === "Email address" &&
      item.boundingBox.y >= 0 && spans.some((span) => span.start >= start && span.end <= end && span.word.bbox?.y0 === item.boundingBox.y));
    if (!exactAddressOnLine) add("Email address", value, start, end, "medium", "email-line-fallback");
  }
  for (const label of spans.filter((span) => /^e-?mail:?$/i.test(span.word.text.trim()))) {
    const labelBox = label.word.bbox || {};
    const labelCenterY = ((labelBox.y0 ?? 0) + (labelBox.y1 ?? 0)) / 2;
    const labelHeight = Math.max(1, (labelBox.y1 ?? 0) - (labelBox.y0 ?? 0));
    const valueSpans = spans.filter((span) => {
      if (span === label) return false;
      const box = span.word.bbox || {};
      const centerY = ((box.y0 ?? 0) + (box.y1 ?? 0)) / 2;
      return (box.x0 ?? -1) >= (labelBox.x1 ?? 0) - 2 &&
        Math.abs(centerY - labelCenterY) <= labelHeight * 1.5;
    });
    if (!valueSpans.length) continue;
    const start = Math.min(...valueSpans.map((span) => span.start));
    const end = Math.max(...valueSpans.map((span) => span.end));
    const addressLike = valueSpans.some(({ word }) =>
      /@|(?:gmail|googlemail|yahoo|outlook|hotmail|live|icloud|protonmail)\s*\.|[A-Z0-9._%+-]{3,}/i.test(word.text));
    if (addressLike && !detections.some((item) =>
      item.type === "Email address" && item.boundingBox.y >= (labelBox.y0 ?? 0) - labelHeight &&
      item.boundingBox.y <= (labelBox.y1 ?? 0) + labelHeight)) {
      add("Email address", valueSpans.map(({ word }) => word.text).join(" "), start, end, "medium", "email-label-row");
    }
  }
  for (const match of text.matchAll(/\b[A-Z0-9._-]{2,}@[A-Z0-9.-]{2,}\b/gi)) {
    const alreadyEmail = detections.some(({ type, matchedText }) => type === "Email address" && matchedText === match[0]);
    if (!alreadyEmail) add("UPI ID", match[0], match.index, match.index + match[0].length, "medium");
  }
  for (const match of text.matchAll(/[^\n]+/g)) {
    const line = match[0].trim();
    if (!/\b(?:UPI(?:\s*(?:ID|address))?|VPA|payment address)\b/i.test(line)) continue;
    const start = match.index + match[0].indexOf(line);
    const end = start + line.length;
    const lineBox = boundsForRange(spans, start, end);
    const handleAlreadyDetected = lineBox && detections.some((item) => item.type === "UPI ID" && item.boundingBox.y === lineBox.y);
    if (!handleAlreadyDetected) add("UPI ID", line, start, end, "high", "upi-line-fallback");
  }
  for (const match of text.matchAll(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length === 10 || (digits.length === 12 && digits.startsWith("91"))) add("Indian mobile number", match[0], match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/\+?\d[\d ().-]{5,}\d/g)) {
    const digits = match[0].replace(/\D/g, "");
    const start = match.index;
    const end = start + match[0].length;
    const lineContext = contextAroundLines(start, end);
    const explicitlyInternational = /^\s*\+/.test(match[0]);
    if (digits.length >= 7 && digits.length <= 15 &&
      (explicitlyInternational || /\b(?:phone|mobile|telephone|tel|contact)\b/i.test(lineContext)) &&
      !detections.some((item) => item.matchedText.replace(/\D/g, "") === digits && item.type === "Indian mobile number")) {
      add("Phone number", match[0], start, end, "medium");
    }
  }
  for (const match of text.matchAll(/\b(?:account|acct|a\/c)\s*(?:number|no\.?|#)?\s*[:#-]?\s*((?:\d[ -]?){7,17}\d)\b/gi)) {
    const valueOffset = match[0].lastIndexOf(match[1]);
    const start = match.index + valueOffset;
    add("Bank account number", match[1], start, start + match[1].length);
  }
  for (const match of text.matchAll(/\b\d{4,6}\b/g)) {
    if (hasNearbyKeyword(match.index, match.index + match[0].length, /\b(?:OTP|one[- ]time password|verification code)\b/i)) add("OTP", match[0], match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
    if (isLuhnValid(match[0])) add("Card number", match[0], match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/\b(?:credit|debit)\s*card\b|\bcard\s*(?:number|no\.?|details|holder)\b|\b(?:CVV2?|CVC2?|security code|valid thru|expiry date|expiration date)\b/gi)) {
    const [start, lineEnd] = lineRange(match.index, match.index + match[0].length);
    let end = lineEnd;
    let line = text.slice(start, end).trim();
    const lineDigits = line.replace(/\D/g, "");
    const cardLabelNeedsValueLine = /\b(?:credit|debit)\s*card\b|\bcard\s*(?:number|no\.?)\b/i.test(line) && lineDigits.length < 4;
    if ((line.replace(/\W/g, "").length <= match[0].replace(/\W/g, "").length || cardLabelNeedsValueLine) && end < text.length) {
      const nextStart = end + 1;
      const nextBreak = text.indexOf("\n", nextStart);
      const nextEnd = nextBreak < 0 ? text.length : nextBreak;
      const nextLine = text.slice(nextStart, nextEnd).trim();
      if (nextLine && !/^(?:address|phone|email|name|date of birth)\b/i.test(nextLine)) {
        end = nextEnd;
        line = text.slice(start, end).trim();
      }
    }
    add("Credit/debit card details", line, start, end, "high");
  }
  if (isPaymentCardText(text) && spans.length) {
    const lines = [];
    for (const span of spans) {
      if (span.word.lineBreakBefore || !lines.length) {
        lines.push({ start: span.start, end: span.end, spans: [span] });
      } else {
        const line = lines[lines.length - 1];
        line.end = span.end;
        line.spans.push(span);
      }
    }
    for (const line of lines) {
      const lineText = text.slice(line.start, line.end).trim();
      const digitCount = (lineText.match(/\d/g) || []).length;
      const hasCardValue = digitCount >= 8 || /\b\d{1,2}\s*\/\s*\d{2,4}\b/.test(lineText);
      const hasSecurityCode = /\b(?:CVV2?|CVC2?|security code)\b/i.test(lineText);
      const hasExpiryLabel = /\b(?:expiry|expires|valid thru|valid through|expiration date)\b/i.test(lineText);
      if (hasCardValue || hasSecurityCode || hasExpiryLabel) {
        add("Credit/debit card details", lineText, line.start, line.end, "high", "card-value-line");
      }
    }
  }
  for (const match of text.matchAll(/\b(?:bank balance|account balance|available balance|medical report|blood report|diagnosis|prescription)\b/gi)) {
    const type = /medical|blood|diagnosis|prescription/i.test(match[0]) ? "Medical information" : "Bank balance context";
    add(type, match[0], match.index, match.index + match[0].length, "medium");
  }
  for (const match of text.matchAll(/\b(?:home address|residential address|address|street|road|apartment|flat|postal code|postcode|pincode|pin code)\b/gi)) {
    let [start, end] = lineRange(match.index, match.index + match[0].length);
    const valueAfterLabel = text.slice(match.index + match[0].length, end).replace(/^[:\s,-]*/, "").trim();
    if (valueAfterLabel.replace(/\W/g, "").length < 8) {
      for (let row = 0; row < 3 && end < text.length; row += 1) {
        const nextStart = end + 1;
        const nextEnd = text.indexOf("\n", nextStart);
        const lineEnd = nextEnd < 0 ? text.length : nextEnd;
        const nextLine = text.slice(nextStart, lineEnd).trim();
        if (!nextLine || /^(?:date of birth|dob|blood group|validity|issued|email|phone|mobile|father'?s name)\b/i.test(nextLine)) break;
        end = lineEnd;
        if (/\b(?:street|road|lane|avenue|chennai|tamil nadu|pincode|pin code)\b/i.test(nextLine)) break;
      }
    }
    const value = text.slice(start, end).trim();
    const addressContent = value.slice(value.toLowerCase().indexOf(match[0].toLowerCase()) + match[0].length);
    if (addressContent.replace(/\W/g, "").length >= 4) add("Home address", value, start, end, "medium");
  }
  for (const match of text.matchAll(/^\s*\d{1,6}\s+[A-Z][A-Z0-9.' -]{2,60}\b(?:street|st\.?|road|rd\.?|lane|ln\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|apartment|apt\.?|flat)\b[^\n]*$/gim)) {
    const start = match.index + match[0].search(/\S/);
    const value = match[0].trim();
    add("Home address", value, start, start + value.length, "medium");
  }
  for (const match of text.matchAll(/\b(?:emergency contact|personal contacts?|contact list|contacts|next of kin)\b/gi)) {
    const [start, lineEnd] = lineRange(match.index, match.index + match[0].length);
    let end = lineEnd;
    if (/contact list|personal contacts?/i.test(match[0]) || /personal contact/i.test(text.slice(start, lineEnd))) {
      for (let row = 0; row < 10 && end < text.length; row += 1) {
        const nextStart = end + 1;
        const nextBreak = text.indexOf("\n", nextStart);
        const nextEnd = nextBreak < 0 ? text.length : nextBreak;
        const nextLine = text.slice(nextStart, nextEnd).trim();
        if (!nextLine || /^(?:address|bank|email|passport|account|statement|transaction)\b/i.test(nextLine)) break;
        end = nextEnd;
      }
    }
    add("Personal contact details", text.slice(start, end).trim(), start, end, "medium");
  }
  for (const match of text.matchAll(/\b(?:transaction(?:\s*(?:id|number|no\.?|reference))?|txn(?:\s*(?:id|no\.?))?|UTR|reference\s*(?:id|number|no\.?)|debited|credited|bank statement|statement date|available balance)\b/gi)) {
    let [start, end] = lineRange(match.index, match.index + match[0].length);
    let line = text.slice(start, end).trim();
    if (/\b(?:transaction\s*(?:id|number|no\.?)|txn\s*(?:id|no\.?)|reference\s*(?:id|number|no\.?))\b/i.test(match[0])) continue;
    if (line.replace(/\W/g, "").length <= match[0].replace(/\W/g, "").length && end < text.length) {
      const nextStart = end + 1;
      const nextEnd = text.indexOf("\n", nextStart);
      const lineEnd = nextEnd < 0 ? text.length : nextEnd;
      const nextLine = text.slice(nextStart, lineEnd).trim();
      if (/^[A-Z0-9-]{6,}$/i.test(nextLine)) {
        end = lineEnd;
        line = text.slice(start, end).trim();
      }
    }
    if (line.length > match[0].length || /statement/i.test(match[0])) {
      add("Bank transaction details", line, start, end, "medium");
    }
  }
  for (const match of text.matchAll(/\b(?:google\s+transaction\s+id|upi\s+transaction\s+id|transaction\s*(?:id|number|no\.?)|reference\s*(?:id|number|no\.?|#)|ref\s*(?:number|no\.?|#)|order\s*(?:id|number)|tracking\s*(?:id|number))\b/gi)) {
    const labelEnd = match.index + match[0].length;
    let valueStart = labelEnd;
    let valueEnd = lineRange(match.index, labelEnd)[1];
    let value = text.slice(labelEnd, valueEnd).replace(/^[\s:#-]+/, "").trim();
    if (!/[A-Z0-9]{5,}/i.test(value) && valueEnd < text.length) {
      const nextStart = valueEnd + 1;
      const nextBreak = text.indexOf("\n", nextStart);
      const nextEnd = nextBreak < 0 ? text.length : nextBreak;
      const nextLine = text.slice(nextStart, nextEnd).trim();
      const token = nextLine.match(/^[A-Z0-9][A-Z0-9-]{4,}/i);
      if (token) {
        valueStart = nextStart;
        valueEnd = nextStart + token[0].length;
        value = token[0];
      }
    } else {
      const rawValue = text.slice(labelEnd, valueEnd);
      valueStart = labelEnd + rawValue.indexOf(value);
      const nextLabelOffset = value.search(/\s+\b(?:reference|ref|order|tracking|transaction|upi)\s*(?:id|number|no\.?)\b/i);
      if (nextLabelOffset >= 0) {
        value = value.slice(0, nextLabelOffset).trim();
        valueEnd = valueStart + value.length;
      }
    }
    if (value && /[A-Z0-9]{5,}/i.test(value)) {
      add("Bank transaction/reference ID", value, valueStart, valueEnd, "high");
    }
  }
  for (const match of text.matchAll(/\b(?:lat(?:itude)?\s*[:=]?\s*)?[-+]?\d{1,2}\.\d{4,}\s*°?\s*(?:[,|]\s*)?(?:long?|lng|longitude)\s*[:=]?\s*[-+]?\d{1,3}\.\d{4,}\s*°?/gi)) {
    add("GPS coordinates", match[0].trim(), match.index, match.index + match[0].length, "high");
  }
  for (const match of text.matchAll(/\b(?:lat(?:itude)?\s*[:=]?\s*)?[-+]?\d{1,2}\.\d{4,}\s*°?\s*(?:[,|]\s*)?[-+]?\d{1,3}\.\d{4,}\s*°?/gi)) {
    const value = match[0];
    const nearbyText = contextAroundLines(match.index, match.index + value.length);
    if (!/\b(?:gps|long?|lng|longitude|camera|location)\b/i.test(nearbyText)) continue;
    add("GPS coordinates", value.trim(), match.index, match.index + match[0].length, "high");
  }
  for (const match of text.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[\s\S]{0,40}?\b\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s*(?:GMT|UTC)\s*[+-]?\d{1,2}:?\d{2})?/gi)) {
    const nearbyText = contextAroundLines(match.index, match.index + match[0].length);
    if (!/\b(?:gps|lat(?:itude)?|long?|lng|longitude|camera|location)\b/i.test(nearbyText)) continue;
    add("GPS capture timestamp", match[0].trim(), match.index, match.index + match[0].length, "high");
  }
  for (const match of text.matchAll(/\b(?:date\s*of\s*birth|dob|birth\s*date)\b\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/gi)) {
    const valueOffset = match[0].lastIndexOf(match[1]);
    const start = match.index + valueOffset;
    add("Date of birth", match[1], start, start + match[1].length, "high");
  }
  for (const match of text.matchAll(/\b(?:date\s*of\s*birth|dob|birth\s*date)\b\s*[:#-]?\s*$/gim)) {
    const [, end] = lineRange(match.index, match.index + match[0].length);
    if (end >= text.length) continue;
    const nextStart = end + 1;
    const nextEnd = text.indexOf("\n", nextStart);
    const candidateEnd = nextEnd < 0 ? text.length : nextEnd;
    const nextLine = text.slice(nextStart, candidateEnd).trim();
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(nextLine)) {
      add("Date of birth", nextLine, nextStart, candidateEnd, "high");
    }
  }
  return detections;
}

module.exports = { detectIndianPii, isLuhnValid, isVerhoeffValid };
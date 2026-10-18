# UPShield

UPShield is a Manifest V3 Chrome extension that locally scans PNG and JPG uploads for sensitive information before passing an approved, sanitized image to ChatGPT, Gemini, or Claude. Images and OCR text are not sent to an UPShield backend. English/Tamil OCR, face detection, and QR/barcode detection use bundled local models and libraries; redaction re-encodes to PNG with opaque black boxes, which also drops source image metadata.

## Build

```sh
npm install
npm test
npm run build
```

Load the generated `dist/` folder using `chrome://extensions` > **Developer mode** > **Load unpacked**. The extension requests no host permissions; its content script is declared only for the three supported provider origins.

## Scope and limitations

- Supported images: PNG and JPG. Processing runs locally in the browser.
- Detection covers Aadhaar candidates, context-labeled PAN/passport/driving-licence numbers (including standard Indian state/RTO/year/serial formats such as TN licence numbers) and DOB, OTP, UPI IDs, phone numbers, email addresses, address/contact-list lines, bank account/transaction/reference IDs, faces, and QR/barcodes. Email labels use OCR geometry to find values separated in the same row, and a narrow OCR fallback recognizes common Gmail misreads such as a dropped dot. Identity documents are not redacted line-by-line merely because a document heading was recognized. Payment-card redaction targets OCR rows containing card numbers, expiry, or security-code details rather than the entire card/image. QR/barcode scans include overlapping crops, sharp enlargement, contrast-threshold retries, and a local QR-texture locator fallback for QR-like regions the decoder cannot read; findings without a usable in-image box stop export instead of being silently skipped. OCR and document patterns remain heuristic; face/QR detection can miss obscured, tiny, rotated, or low-quality content and is not a guarantee that every sensitive item will be found.
- The provider page upload flow must be tested against the current ChatGPT, Gemini, and Claude interfaces. These sites can change their upload controls; confirm that the sanitized preview is shown and only the confirmed sanitized image reaches the provider before relying on the extension.
- The standalone popup shows the sanitized preview before offering a download; it does not submit images. If no patterns are detected, the extension warns that this is not proof the image is safe and labels the provider action as continuing without redaction.
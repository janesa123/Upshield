const test = require("node:test");
const assert = require("node:assert/strict");
const { getRedactionBounds } = require("../src/lib/redactor");

test("adds a small QR safety margin without obscuring unrelated image area", () => {
  const bounds = getRedactionBounds({
    type: "QR code",
    boundingBox: { x: 100, y: 80, width: 200, height: 200 }
  }, 500, 400);

  assert.deepEqual(bounds, { x: 84, y: 64, width: 232, height: 232 });
});

test("clips expanded QR redaction bounds to the image edges", () => {
  const bounds = getRedactionBounds({
    type: "QR code",
    boundingBox: { x: 5, y: 8, width: 50, height: 40 }
  }, 80, 70);

  assert.deepEqual(bounds, { x: 1, y: 4, width: 58, height: 48 });
});

test("fails closed when a finding has no usable bounding box", () => {
  assert.throws(
    () => getRedactionBounds({ type: "QR code", boundingBox: null }, 200, 200),
    /no bounding box/
  );
  assert.throws(
    () => getRedactionBounds({ type: "QR code", boundingBox: { x: 500, y: 500, width: 10, height: 10 } }, 200, 200),
    /outside the image/
  );
});

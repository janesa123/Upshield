const FACE_MODELS = [
  { path: "models/face_detector.tflite", minScore: 0.5 },
  { path: "models/face_detector_full_range.tflite", minScore: 0.3 }
];

async function createFaceDetectors(createDetector, resolveAsset) {
  return Promise.all(FACE_MODELS.map(async ({ path, minScore }) => ({
    detector: await createDetector(resolveAsset(path), minScore),
    minScore
  })));
}

module.exports = { createFaceDetectors };
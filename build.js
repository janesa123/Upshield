const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = __dirname;
const output = path.join(root, "dist");

async function build() {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(root, "manifest.json"), path.join(output, "manifest.json"));
  fs.copyFileSync(path.join(root, "background.js"), path.join(output, "background.js"));
  fs.copyFileSync(path.join(root, "offscreen.html"), path.join(output, "offscreen.html"));
  fs.copyFileSync(path.join(root, "popup.html"), path.join(output, "popup.html"));
  fs.copyFileSync(path.join(root, "style.css"), path.join(output, "style.css"));
  fs.cpSync(path.join(root, "vendor"), path.join(output, "vendor"), { recursive: true });
  fs.copyFileSync(path.join(root, "node_modules/@tesseract.js-data/tam/4.0.0/tam.traineddata.gz"), path.join(root, "vendor/lang/tam.traineddata.gz"));
  fs.copyFileSync(path.join(root, "node_modules/@tesseract.js-data/tam/4.0.0/tam.traineddata.gz"), path.join(output, "vendor/lang/tam.traineddata.gz"));
  fs.cpSync(path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"), path.join(root, "vendor/mediapipe/wasm"), { recursive: true });
  fs.cpSync(path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"), path.join(output, "vendor/mediapipe/wasm"), { recursive: true });
  fs.mkdirSync(path.join(output, "models"), { recursive: true });
  fs.copyFileSync(path.join(root, "models/face_detector.tflite"), path.join(output, "models/face_detector.tflite"));
  fs.copyFileSync(path.join(root, "models/face_detector_full_range.tflite"), path.join(output, "models/face_detector_full_range.tflite"));
  await Promise.all([
    esbuild.build({ entryPoints: ["src/content/uploadInterceptor.js"], bundle: true, outfile: "content.js", platform: "browser", target: "chrome120", format: "iife" }),
    esbuild.build({ entryPoints: ["src/content/uploadInterceptor.js"], bundle: true, outfile: "dist/content.js", platform: "browser", target: "chrome120", format: "iife" }),
    esbuild.build({ entryPoints: ["src/offscreen/ocr.js"], bundle: true, outfile: "offscreen.js", platform: "browser", target: "chrome120", format: "iife" }),
    esbuild.build({ entryPoints: ["src/offscreen/ocr.js"], bundle: true, outfile: "dist/offscreen.js", platform: "browser", target: "chrome120", format: "iife" }),
    esbuild.build({ entryPoints: ["popup.js"], bundle: true, outfile: "popup.bundle.js", platform: "browser", target: "chrome120", format: "iife" }),
    esbuild.build({ entryPoints: ["popup.js"], bundle: true, outfile: "dist/popup.bundle.js", platform: "browser", target: "chrome120", format: "iife" })
  ]);
  console.log("UPShield built in project root and dist/");
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
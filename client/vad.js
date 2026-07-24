// Phase 1: real voice-activity detection using Silero VAD (ONNX, running via WASM in the
// browser) through @ricky0123/vad-web, replacing the amplitude-threshold placeholder.
//
// This package ships as a UMD bundle exposing a global `vad` object (loaded via plain
// <script> CDN tags in index.html), not an ES module — unlike livekit-client, it can't be
// `import`ed from esm.sh. This file is itself an ES module purely so client.js can `import`
// a clean function from it; it reads the ambient `vad` global set by those script tags.
//
// baseAssetPath/onnxWASMBasePath default to "./" and would silently 404 (no VAD ever fires)
// if left unset — they must point at the same CDN + version as the <script> tags.
const VAD_WEB_VERSION = "0.0.29";
const ONNXRUNTIME_WEB_VERSION = "1.22.0";

export async function startVAD({ onSpeechStart, onSpeechEnd, onMisfire }) {
  if (typeof vad === "undefined") {
    throw new Error(
      "window.vad is not defined — check that the vad-web/onnxruntime-web <script> tags in index.html loaded before vad.js ran."
    );
  }
  return vad.MicVAD.new({
    baseAssetPath: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_WEB_VERSION}/dist/`,
    onnxWASMBasePath: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist/`,
    onSpeechStart,
    onSpeechEnd,
    onVADMisfire: onMisfire,
  });
}

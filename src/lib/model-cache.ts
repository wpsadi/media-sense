// Transformers.js stores downloaded model files in this Cache Storage bucket, keyed by full URL.
const CACHE_NAME = "transformers-cache"

// Every file the q4 model loads, on both the WebGPU and wasm paths.
const REQUIRED_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "processor_config.json",
  "preprocessor_config.json",
  "onnx/model_q4.onnx",
  "onnx/model_q4.onnx_data",
  "onnx/vision_encoder_q4.onnx",
  "onnx/vision_encoder_q4.onnx_data",
  "onnx/audio_encoder_q4.onnx",
  "onnx/audio_encoder_q4.onnx_data",
]

// True only when every required file is cached, so a partial download is never mistaken for a full one.
export async function isModelCached(modelId: string): Promise<boolean> {
  if (!("caches" in window)) return false
  try {
    const cache = await caches.open(CACHE_NAME)
    const urls = (await cache.keys()).map((request) => request.url)
    const folder = `/${modelId}/resolve/`
    return REQUIRED_FILES.every((file) => urls.some((url) => url.includes(folder) && url.endsWith(`/${file}`)))
  } catch {
    return false
  }
}

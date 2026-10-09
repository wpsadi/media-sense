---
name: embeddinggemma-browser
description: Load and use EmbeddingGemma 2 (onnx-community/embeddinggemma-2-ONNX) fully client-side in the browser with Transformers.js, including download progress, WebGPU/wasm selection, and text/image/video/audio embedding for search. Use when wiring the on-device embedding model into the React app, showing its download progress, or embedding images or video for retrieval.
---

# EmbeddingGemma 2 in the browser (client-side only)

The model runs entirely in the user's browser through Transformers.js. No server, no API key, no media leaves the device. Every change in this skill must keep that property: never call a hosted inference endpoint from the app.

## Model facts

- Model id: `onnx-community/embeddinggemma-2-ONNX` (Apache 2.0, Google DeepMind)
- Library: `@huggingface/transformers` (`npm i @huggingface/transformers`)
- 740M params total: 270M text backbone, vision encoder 170M, audio encoder 300M
- Output: one 768-dimensional, L2-normalized vector per input, shared across text, image, video, and audio
- Matryoshka truncation: 768, 512, 256, 128. Quality is near-lossless down to 256. 128 is text-only quality.
- Context: 8,192 tokens shared by all modalities in one input

## Download sizes by dtype

| dtype | Total | Use when |
|---|---|---|
| `q4` | ~473 MB | Default in the browser, especially on WebGPU |
| `q8` | ~850 MB | Quality matters most, or audio is the main modality |
| `fp16` | ~1465 MB | WebGPU with spare memory |
| `fp32` | ~2929 MB | Reference only; too large for normal browsers |

Per-component dtype is allowed: `dtype: { model: "q4", vision_encoder: "q4", audio_encoder: "q8" }`.

## Loading with real download progress

This is the loader the app's download dialog should call. `progress_callback` is the hook for the progress UI in [src/hooks/use-model-download.ts](../../../src/hooks/use-model-download.ts); replace that file's simulated timer with this callback.

```ts
// src/lib/embedding-model.ts
import { AutoModel, AutoProcessor } from "@huggingface/transformers"

export const EMBEDDING_MODEL_ID = "onnx-community/embeddinggemma-2-ONNX"

export type LoadProgress = {
  file: string
  loaded: number
  total: number
  percent: number // 0..100 for the file currently downloading
}

export async function loadEmbeddingModel(onProgress?: (p: LoadProgress) => void) {
  const progress_callback = (info: any) => {
    if (info.status === "progress" && onProgress) {
      onProgress({
        file: info.file,
        loaded: info.loaded,
        total: info.total,
        percent: info.progress,
      })
    }
  }

  const device = "gpu" in navigator ? "webgpu" : "wasm"
  const dtype = "q4"

  const processor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID, { progress_callback })
  const model = await AutoModel.from_pretrained(EMBEDDING_MODEL_ID, { device, dtype, progress_callback })
  return { processor, model }
}
```

Notes:
- `progress_callback` fires per downloaded file, so overall progress is the sum of `loaded` over the sum of `total` across files seen so far. Track files in a `Map` keyed by `file`. Do not treat one file's percent as the whole download.
- Files are cached by the browser after the first load. A second visit should report near-instant progress. Show "Model is downloaded" from a persisted flag only after a successful load, not from the cache check alone.
- The `"gpu" in navigator` check is a cheap WebGPU hint. If `device: "webgpu"` fails at model creation, retry with `"wasm"` and say so in the UI.
- Keep the loaded `{ processor, model }` in a module-level variable or a Zustand store so every component shares one instance. Do not load it per component.

## Intended usage (text, image, video, audio)

All inputs map into one vector space, so any embedding can be compared with any other. The usual pattern is: embed the media once and store the vectors, embed the user's text query at search time, then rank by dot product (cosine similarity, since vectors are normalized).

### Text search (asymmetric)

Queries and documents use different prefixes:

```ts
const query = (text: string) => `task: search result | query: ${text}`
const document = (text: string, title = "none") => `title: ${title} | text: ${text}`
```

Use `title: none` when there is no title. Prefixes apply to text only; images, video, and audio go in without a prefix.

### Image search

Use case: "find photos of cats sleeping on a couch" across an image library.

```ts
import { load_image, matmul } from "@huggingface/transformers"

const embed = async (...inputs: any[]) => (await model(await processor(...inputs))).sentence_embedding

// Index time: one call per image, store the 768-d vector with the image id
const imageVec = await embed(null, await load_image(imageUrl))

// Query time: text query with its prefix, scored against stored image vectors
const qVec = await embed([query("cats sleeping on a couch")])
const score = (await matmul(imageVec, qVec.transpose(1, 0))).tolist()[0][0]
```

- Each image costs about 280 tokens by default, so about 29 images fit in one input. Embed images one per call at index time, not batched.
- For fine detail (small text in a scan, product labels), raise the vision budget: `processor.image_processor.max_soft_tokens = 560` (or `1120`). Latency and memory go up with it. Options: 70, 140, 280, 560, 1120.

### Video search

Use case: "find the clip where a sea turtle swims" in a local video library.

```ts
import { load_video } from "@huggingface/transformers"

const video = await load_video(videoUrl, { fps: 1 })   // default: 1 frame per second
const videoVec = await embed(null, null, null, video)
```

- Default sampling is 1 fps. Videos over 32 frames are subsampled uniformly to 32 frames.
- Each frame costs about 140 tokens, so about 58 frames fit in the 8,192-token window. Keep the frame count low for long videos.
- On WebGPU, keep each batch under about 2,700 tokens total. Video longer than about 19 seconds at 1 fps exceeds this. Use `load_video(url, { num_frames: 16 })` or run on `wasm`.
- `load_video` decodes with browser APIs, so the source must be playable in the browser (same-origin or CORS-enabled). Files chosen with `<input type="file">` work through `URL.createObjectURL`.
- For a video library, store one vector per video, or one vector per segment if clips are long. Retrieval returns the video; to show a timestamp, embed segments and keep the start time with each vector.

### Mixed posts (interleaved media)

Use placeholder tokens in the text where each media item belongs: `<|image|>`, `<|video|>`, `<|audio|>`. The media lists are consumed in order:

```ts
const text = ["My two cats while I'm away <|image|> and my dive trip: <|video|>"]
const { sentence_embedding } = await model(await processor(text, [[catImage]], null, [diveVideo]))
```

One call produces one vector for the whole post. Interleaved inputs share the 8,192-token budget, so mixing modalities leaves less room for each.

### Audio

Audio must be mono 16 kHz: `load_audio(url, 16000)`. About 25 tokens per second, so roughly 327 seconds fit in one input. Audio is the modality most hurt by 4-bit quantization, so use `q8` for the audio encoder when audio retrieval quality matters.

## Recommended patterns

- **Truncate to save storage, then re-normalize.** `const short = full.slice(null, [0, 256]).normalize(2, -1)`. Skipping the re-normalize silently degrades ranking.
- **Only load what you use.** For text-only search, remove the encoder configs before loading:
  ```ts
  const config = await AutoConfig.from_pretrained(EMBEDDING_MODEL_ID)
  config.vision_config = config.audio_config = null
  ```
  This drops the model to about 270M params. Do not mix vectors from different configurations in one index, and do not mix truncated and full vectors in one index.
- **Index once, query often.** Store vectors (IndexedDB is a good client-side store) keyed by media id, with the model id and dimension stored alongside. Re-embed everything if either changes.
- **Free the media.** Revoke object URLs after embedding (`URL.revokeObjectURL`).

## Limitations to show or respect in the UI

- Embeddings are not safety-moderated. Filtering or moderation needs an application-level step.
- Quality varies across the 100+ languages. Test with your own content.
- Image and video retrieval scores are relative. Use them to rank, not as absolute "match" percentages.
- 128-dimension output is text-only quality. Validate on your own media before using it for image or video.
- Do not use the model for generation. It returns vectors only.

## Checklist before shipping a change

1. The model loads in the browser with no network call to a model API.
2. Progress is aggregated over all files, and the download dialog closes cleanly while loading continues.
3. Text queries use the `task: ... | query:` prefix and documents use `title: ... | text:`.
4. Image and video embeddings are computed one item per call, and video length fits the token budget.
5. Stored vectors record the model id and dimension.

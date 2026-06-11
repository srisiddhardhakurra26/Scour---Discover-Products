import type { Worker } from 'tesseract.js'

// Local OCR (tesseract.js, WASM) over product imagery. Manufacturer photos
// often bake spec text into the pixels — "256GB", "Noise Cancelling", pack
// counts — that never appears in the listing title. Runs only in the
// background enrichment queue, never on the search path.

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      // First call downloads the wasm core + eng traineddata (~15MB), cached
      // on disk afterwards.
      return createWorker('eng')
    })()
  }
  return workerPromise
}

// OCR over photos is noisy; keep only word-shaped tokens so a logo swoosh
// doesn't become detailsText garbage.
const WORD_RE = /^[A-Za-z0-9][A-Za-z0-9&+.'/-]{2,}$/

// Tesseract happily "reads" stylized product photography into junk like
// "JAR TFs res Lo" — at confidence ~30. Real baked-in spec text scores 90+.
const MIN_CONFIDENCE = 70

/**
 * Recognize text in an image (PNG/JPEG buffer). Returns a cleaned snippet,
 * or null when the image contains no usable text — the common case.
 */
export async function ocrImageText(image: Buffer): Promise<string | null> {
  const worker = await getWorker()
  const { data } = await worker.recognize(image)
  if (data.confidence < MIN_CONFIDENCE) return null
  const words = data.text.split(/\s+/).filter((w) => WORD_RE.test(w))
  if (words.length < 2) return null
  const text = words.join(' ').slice(0, 240).trim()
  return text.length >= 8 ? text : null
}

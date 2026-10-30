// Runs document detection off the main thread so the camera preview stays smooth.
import { detectQuadRGBA } from './detect'

self.onmessage = (e: MessageEvent<{ id: number; buf: ArrayBuffer; w: number; h: number }>) => {
  const { id, buf, w, h } = e.data
  const quad = detectQuadRGBA(new Uint8ClampedArray(buf), w, h)
  self.postMessage({ id, quad, w, h })
}

// In-app camera, modelled on dedicated scanner apps: live preview with document outline,
// Single/Batch shooting, and a swipeable strip of modes that hand the photo to the right tool.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/ui'
import type { TKey } from '../i18n'
import { detectQuadRGBA } from '../lib/detect'
import { approach, QuadTracker } from '../lib/quadTracker'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d, type Quad } from '../lib/image'
import { decodeCanvas } from '../lib/qr'
import { useApp } from '../state'
import { loadJSON, saveJSON } from '../lib/settings'
import { createDoc, defaultDocName } from '../lib/db'
import { drawStamp } from '../lib/stamp'
import { CombinationChips, locate, PresetBar, StampContentForm, TemplatePicker, useStampOptions, useStampPrefs, type Place } from '../components/StampEditor'
import { Segmented } from '../components/ui'
import { addQrHistory, QrResult } from './Qr'

export type CamMode = 'ocr' | 'idcard' | 'scan' | 'word' | 'qr' | 'idphoto' | 'timestamp'

const MODES: { id: CamMode; label: TKey }[] = [
  { id: 'ocr', label: 'tool.ocr' },
  { id: 'idcard', label: 'tool.idCard' },
  { id: 'scan', label: 'mode.scan' },
  { id: 'word', label: 'tool.toWord' },
  { id: 'qr', label: 'section.qr' },
  { id: 'idphoto', label: 'tool.idPhoto' },
  { id: 'timestamp', label: 'tool.timestamp' },
]

const ZOOM_STEPS = [1, 2, 3]

/** Modes that photograph a document and benefit from the live outline. */
const DOC_MODES: CamMode[] = ['scan', 'idcard', 'ocr', 'word']

type Facing = 'environment' | 'user'

function useCamera(facing: Facing) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting')
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false })
  // Hardware zoom range when the browser exposes it (Chrome on Android); otherwise zoom is digital.
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number } | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let alive = true
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    const start = async () => {
      stop()
      setState('starting')
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API')
        // Ask for the largest 4:3 frame the camera offers; the browser picks the closest it supports.
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 4032 }, height: { ideal: 3024 }, aspectRatio: { ideal: 4 / 3 } },
        })
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        streamRef.current = s
        const v = videoRef.current!
        v.srcObject = s
        await v.play().catch(() => {})
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean; zoom?: { min: number; max: number } }
        setTorch({ supported: !!caps.torch, on: false })
        setHwZoom(caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null)
        setState('live')
      } catch (e) {
        console.warn('AnyScan camera:', e)
        if (alive) setState('error')
      }
    }
    start()
    // Release the camera while the app is in the background, resume when it returns.
    const onVis = () => (document.visibilityState === 'hidden' ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
      stop()
    }
  }, [facing])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const on = !torch.on
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorch({ supported: true, on })
    } catch {
      setTorch({ supported: false, on: false })
    }
  }, [torch.on])

  const applyHwZoom = useCallback((z: number) => {
    const track = streamRef.current?.getVideoTracks()[0]
    track?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).catch(() => {})
  }, [])

  return { videoRef, state, torch, toggleTorch, hwZoom, applyHwZoom }
}

type Rect = { x: number; y: number; w: number; h: number }

/** Centre part of the frame left after a digital zoom of `dz`. */
function zoomRegion(v: HTMLVideoElement, dz: number): Rect {
  const w = v.videoWidth / dz
  const h = v.videoHeight / dz
  return { x: (v.videoWidth - w) / 2, y: (v.videoHeight - h) / 2, w, h }
}

/** The part of the frame that is visible in a `cover`-fitted, `dz`-zoomed preview of size w×h. */
function visibleCrop(v: HTMLVideoElement, w: number, h: number, dz: number): Rect {
  const k = Math.max(w / v.videoWidth, h / v.videoHeight) * dz
  const cw = w / k
  const ch = h / k
  return { x: (v.videoWidth - cw) / 2, y: (v.videoHeight - ch) / 2, w: cw, h: ch }
}

/** Grabs the current video frame (the digitally zoomed part of it) at full resolution as a JPEG file. */
async function grabFrame(v: HTMLVideoElement, dz: number): Promise<File> {
  const r = zoomRegion(v, dz)
  const c = createCanvas(r.w, r.h)
  ctx2d(c).drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
  const blob = await canvasToBlob(c, 'image/jpeg', 0.93)
  return new File([blob], `AnyScan-${Date.now()}.jpg`, { type: 'image/jpeg' })
}

export function CameraScreen({ mode: initialMode = 'scan' }: { mode?: CamMode }) {
  const { t, lang, back, replace, push, pickFiles, toast, home, setTab } = useApp()
  // Timestamp mode: live watermark drawn over the preview and baked into each shot.
  const stamp = useStampPrefs()
  const [place, setPlace] = useState<Place | null>(null)
  const stampOptions = useStampOptions(stamp.prefs, place)
  const [stampEdit, setStampEdit] = useState<null | 'templates' | 'content'>(null)
  const [lastStamped, setLastStamped] = useState<{ id: string; url: string } | null>(null)
  const stampRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<CamMode>(initialMode)
  const [batch, setBatch] = useState(false)
  const [shots, setShots] = useState<File[]>([])
  const [hints, setHints] = useState<(Quad | null)[]>([])
  const [shotUrl, setShotUrl] = useState<string>()
  const [facing, setFacing] = useState<Facing>('environment')
  const [qrText, setQrText] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const { videoRef, state, torch, toggleTorch, hwZoom, applyHwZoom } = useCamera(facing)
  // Zoom: hardware when available, otherwise digital (preview scaled, frames cropped to match).
  const [zoom, setZoomState] = useState(1)
  const maxZoom = hwZoom ? Math.min(hwZoom.max, 10) : 5
  const dz = hwZoom ? 1 : zoom
  const dzRef = useRef(1)
  dzRef.current = dz
  const setZoom = (z: number) => {
    const v = Math.min(maxZoom, Math.max(1, Math.round(z * 10) / 10))
    setZoomState(v)
    if (hwZoom) applyHwZoom(Math.max(hwZoom.min, v))
  }
  useEffect(() => setZoomState(1), [facing])
  const [prefs, setPrefs] = useState(() => ({ grid: false, timer: 0, auto: false, ...loadJSON<Partial<{ grid: boolean; timer: number; auto: boolean }>>('anyscan.camera', {}) }))
  const setPref = (p: Partial<typeof prefs>) =>
    setPrefs((s) => {
      const n = { ...s, ...p }
      saveJSON('anyscan.camera', n)
      return n
    })
  const [countdown, setCountdown] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // Thumbnail of the latest batch shot.
  useEffect(() => {
    const last = shots[shots.length - 1]
    if (!last) return setShotUrl(undefined)
    const u = URL.createObjectURL(last)
    setShotUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [shots])

  // Keep the selected mode centred in the strip.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-mode="${mode}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [mode])

  // Live QR decoding (QR mode).
  useEffect(() => {
    if (state !== 'live' || mode !== 'qr') return
    const small = createCanvas(1, 1)
    let alive = true
    let running = false
    const tick = async () => {
      const v = videoRef.current
      if (!alive || running || !v?.videoWidth || qrText) return
      running = true
      try {
        const z = zoomRegion(v, dzRef.current)
        const s = Math.min(1, 720 / Math.max(z.w, z.h))
        small.width = Math.round(z.w * s)
        small.height = Math.round(z.h * s)
        ctx2d(small).drawImage(v, z.x, z.y, z.w, z.h, 0, 0, small.width, small.height)
        const r = await decodeCanvas(small)
        if (r && alive) {
          addQrHistory(r, 'scan')
          setQrText(r)
        }
      } finally {
        running = false
      }
    }
    const id = window.setInterval(tick, 200)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [mode, state, qrText, videoRef])

  // Live document outline. Detection runs in a worker as fast as it can; a tracker steadies the
  // result (no flashing on a missed frame, no jumping on an outlier) and the polygon glides
  // towards it at display rate. It turns solid green once the page has held still.
  const trackerRef = useRef(new QuadTracker())
  const targetRef = useRef<Quad | null>(null) // normalised 0..1, also used as a crop hint on capture
  const polyRef = useRef<SVGPolygonElement>(null)
  const [outlineOn, setOutlineOn] = useState(false)
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (state !== 'live' || !DOC_MODES.includes(mode)) return
    const tracker = trackerRef.current
    tracker.reset()
    targetRef.current = null
    let alive = true
    let busy = false
    let worker: Worker | null = null
    try {
      worker = new Worker(new URL('../lib/detect.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker = null
    }
    const small = createCanvas(1, 1)
    const accept = (q: Quad | null, w: number, h: number) => {
      if (!alive) return
      const r = tracker.update(q ? (q.map((p) => ({ x: p.x / w, y: p.y / h })) as Quad) : null)
      targetRef.current = r.quad
      setOutlineOn(!!r.quad)
      setLocked(r.locked)
    }
    if (worker) worker.onmessage = (e: MessageEvent<{ quad: Quad | null; w: number; h: number }>) => {
      busy = false
      accept(e.data.quad, e.data.w, e.data.h)
    }
    const tick = () => {
      const v = videoRef.current
      if (!alive || busy || !v?.videoWidth) return
      const z = zoomRegion(v, dzRef.current)
      const s = 320 / Math.max(z.w, z.h)
      small.width = Math.round(z.w * s)
      small.height = Math.round(z.h * s)
      const c = ctx2d(small)
      c.drawImage(v, z.x, z.y, z.w, z.h, 0, 0, small.width, small.height)
      const img = c.getImageData(0, 0, small.width, small.height)
      busy = true
      if (worker) worker.postMessage({ id: 0, buf: img.data.buffer, w: img.width, h: img.height }, [img.data.buffer])
      else {
        accept(detectQuadRGBA(img.data, img.width, img.height), img.width, img.height)
        busy = false
      }
    }
    const id = window.setInterval(tick, worker ? 120 : 400)

    // Animate the drawn outline towards the tracked target every display frame.
    let shown: Quad | null = null
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const v = videoRef.current
      const stage = stageRef.current
      const poly = polyRef.current
      const target = targetRef.current
      if (!v?.videoWidth || !stage || !poly || !target) {
        shown = null
        return
      }
      shown = shown ? approach(shown, target, 0.25) : target
      // Coordinates are normalised to the zoomed region, which the preview shows centred and
      // cover-fitted; the zoom cancels out of the mapping.
      const W = stage.clientWidth
      const H = stage.clientHeight
      const k = Math.max(W / v.videoWidth, H / v.videoHeight)
      poly.setAttribute('points', shown.map((p) => `${(W / 2 + (p.x - 0.5) * v.videoWidth * k).toFixed(1)},${(H / 2 + (p.y - 0.5) * v.videoHeight * k).toFixed(1)}`).join(' '))
    }
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      window.clearInterval(id)
      cancelAnimationFrame(raf)
      worker?.terminate()
      targetRef.current = null
      setOutlineOn(false)
      setLocked(false)
    }
  }, [mode, state, videoRef])

  /** Sends photos (from the camera, the album or the system camera) to the tool for `mode`. */
  const deliver = async (files: File[], m: CamMode = mode, hints?: (Quad | null)[]) => {
    if (!files.length) return
    switch (m) {
      case 'scan':
        return replace('scan', { files, hints })
      case 'idcard':
        return replace('idcard', { files: files.slice(0, 2) })
      case 'ocr':
        return replace('ocr', { files })
      case 'word':
        return replace('ocr', { files, docx: true })
      case 'idphoto':
        return replace('idphoto', { file: files[0] })
      case 'timestamp':
        return replace('timestamp', { file: files[0] })
      case 'qr': {
        const r = await decodeCanvas(await blobToCanvas(files[0], 1600))
        if (!r) return toast(t('noQrFound'))
        addQrHistory(r, 'scan')
        setQrText(r)
      }
    }
  }

  // Look up the position once when the Timestamp camera opens.
  useEffect(() => {
    if (mode !== 'timestamp' || !stamp.prefs.autoLocation || place || !navigator.geolocation) return
    let alive = true
    locate(lang)
      .then((p) => alive && setPlace(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mode, stamp.prefs.autoLocation, place, lang])

  // Redraw the watermark every second so the clock is live.
  useEffect(() => {
    if (mode !== 'timestamp') return
    const draw = () => {
      const c = stampRef.current
      const stage = stageRef.current
      if (!c || !stage) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.round(stage.clientWidth * dpr)
      c.height = Math.round(stage.clientHeight * dpr)
      drawStamp(c, stampOptions(new Date()))
    }
    draw()
    const id = window.setInterval(draw, 1000)
    return () => window.clearInterval(id)
  }, [mode, stampOptions])

  useEffect(() => () => {
    if (lastStamped) URL.revokeObjectURL(lastStamped.url)
  }, [lastStamped])

  /** Timestamp mode: crop to what is on screen, bake in the watermark, save as its own document. */
  const shootStamped = async (v: HTMLVideoElement) => {
    const stage = stageRef.current!
    const r = visibleCrop(v, stage.clientWidth, stage.clientHeight, dzRef.current)
    const c = createCanvas(r.w, r.h)
    ctx2d(c).drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
    drawStamp(c, stampOptions(new Date()))
    const blob = await canvasToBlob(c, 'image/jpeg', 0.92)
    const d = await createDoc(defaultDocName(t('tool.timestamp')), [{ blob, w: c.width, h: c.height }])
    setLastStamped({ id: d.id, url: URL.createObjectURL(blob) })
    toast(t('saved'))
  }

  const capture = async () => {
    const v = videoRef.current
    if (!v || state !== 'live' || busy || mode === 'qr') return
    setBusy(true)
    setFlash((n) => n + 1)
    try {
      if (mode === 'timestamp') return await shootStamped(v)
      const f = await grabFrame(v, dzRef.current)
      const hint = targetRef.current
      if (mode === 'scan' && batch) {
        setShots((s) => [...s, f])
        setHints((h) => [...h, hint])
      }
      else if (mode === 'idcard') {
        const next = [...shots, f]
        if (next.length >= 2) await deliver(next)
        else {
          setShots(next)
          toast(t('nowBackSide'))
        }
      } else await deliver([f], mode, [hint])
    } finally {
      setBusy(false)
    }
  }

  // Self-timer: the shutter starts a countdown; tapping again cancels it.
  const countdownRef = useRef<number>(0)
  const shoot = () => {
    if (countdown != null) {
      window.clearInterval(countdownRef.current)
      return setCountdown(null)
    }
    if (!prefs.timer) return capture()
    let n = prefs.timer
    setCountdown(n)
    countdownRef.current = window.setInterval(() => {
      n -= 1
      if (n > 0) return setCountdown(n)
      window.clearInterval(countdownRef.current)
      setCountdown(null)
      capture()
    }, 1000)
  }
  useEffect(() => () => window.clearInterval(countdownRef.current), [])

  // Auto-capture (Scan mode): shoot once the outline has been locked for a moment. After a shot it
  // waits for the outline to unlock (next page / phone moved) before shooting again.
  const autoArmed = useRef(true)
  useEffect(() => {
    if (!locked) autoArmed.current = true
    if (!prefs.auto || mode !== 'scan' || !locked || !autoArmed.current || busy || countdown != null) return
    const id = window.setTimeout(() => {
      autoArmed.current = false
      capture()
    }, 900)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, prefs.auto, mode, busy, countdown])

  // Pinch to zoom on the preview (two fingers); one finger still swipes between modes.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)

  const switchMode = (m: CamMode) => {
    if (m === mode) return
    if (shots.length && !window.confirm(t('discardShots', { n: shots.length }))) return
    setShots([])
    setHints([])
    setQrText(null)
    setMode(m)
  }

  // Swipe left/right on the preview to change mode.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const idx = MODES.findIndex((m) => m.id === mode)

  const multiPick = mode === 'scan' || mode === 'ocr' || mode === 'word' || mode === 'idcard'
  const pickAlbum = () => pickFiles({ accept: 'image/*', multiple: multiPick }).then((f) => deliver(f))
  const systemCamera = () => {
    setMenu(false)
    pickFiles({ accept: 'image/*', capture: true }).then((f) => deliver(f))
  }

  return (
    <div className="cam">
      <div className="cam-top">
        <button className="cam-icon" onClick={back} aria-label={t('close')}>
          <Icon name="close" size={26} />
        </button>
        <div className="cam-top-right">
          {torch.supported && (
            <button className={`cam-icon ${torch.on ? 'on' : ''}`} onClick={toggleTorch} aria-label={t('flash')}>
              <Icon name="flash" size={24} />
            </button>
          )}
          <button className={`cam-icon ${prefs.timer ? 'on' : ''}`} onClick={() => setPref({ timer: prefs.timer === 0 ? 3 : prefs.timer === 3 ? 10 : 0 })} aria-label={t('cam.timer')}>
            <Icon name="clock" size={24} />
            {prefs.timer > 0 && <span className="cam-icon-badge">{prefs.timer}s</span>}
          </button>
          <button className={`cam-icon ${prefs.grid ? 'on' : ''}`} onClick={() => setPref({ grid: !prefs.grid })} aria-label={t('cam.grid')}>
            <Icon name="grid3" size={24} />
          </button>
          <button className="cam-icon" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} aria-label={t('flipCamera')}>
            <Icon name="flip" size={24} />
          </button>
          <button className="cam-icon" onClick={() => setMenu(true)} aria-label={t('more')}>
            <Icon name="more" size={26} />
          </button>
        </div>
      </div>

      <div
        className="cam-stage"
        ref={stageRef}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]
            pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }
            swipe.current = null
          } else swipe.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()]
            setZoom(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d))
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          if (pointers.current.size < 2) pinch.current = null
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          if (pointers.current.size < 2) pinch.current = null
          const s = swipe.current
          swipe.current = null
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
            const n = MODES[Math.min(MODES.length - 1, Math.max(0, idx + (dx < 0 ? 1 : -1)))]
            switchMode(n.id)
          }
        }}
      >
        <video ref={videoRef} playsInline muted autoPlay style={{ transform: `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${dz})` }} />
        {prefs.grid && (
          <svg className="cam-grid" width="100%" height="100%" aria-hidden="true">
            <line x1="33.33%" y1="0" x2="33.33%" y2="100%" />
            <line x1="66.67%" y1="0" x2="66.67%" y2="100%" />
            <line x1="0" y1="33.33%" x2="100%" y2="33.33%" />
            <line x1="0" y1="66.67%" x2="100%" y2="66.67%" />
          </svg>
        )}
        {DOC_MODES.includes(mode) && (
          <svg className={`cam-overlay ${outlineOn ? 'on' : ''} ${locked ? 'locked' : ''}`} width="100%" height="100%">
            <polygon ref={polyRef} />
          </svg>
        )}
        {mode === 'idcard' && (
          <div className="cam-guide card">
            <span>{shots.length === 0 ? t('cardFront') : t('cardBack')}</span>
          </div>
        )}
        {mode === 'idphoto' && <div className="cam-guide face" />}
        {mode === 'timestamp' && (
          <>
            <canvas ref={stampRef} className="cam-stamp" />
          </>
        )}
        {mode === 'qr' && (
          <div className="cam-guide qr">
            <i />
          </div>
        )}
        {state === 'error' && (
          <div className="cam-error">
            <Icon name="camera" size={40} />
            <p>{t('cameraUnavailable')}</p>
            <button className="btn primary" onClick={systemCamera}>
              <Icon name="camera" /> {t('useSystemCamera')}
            </button>
            <button className="btn soft" onClick={pickAlbum}>
              <Icon name="image" /> {t('album')}
            </button>
          </div>
        )}
        {flash > 0 && <div className="cam-flash" key={flash} />}
        {countdown != null && <div className="cam-countdown">{countdown}</div>}
        {mode === 'scan' && (
          <button className={`cam-auto ${prefs.auto ? 'on' : ''}`} onClick={() => setPref({ auto: !prefs.auto })} aria-pressed={prefs.auto}>
            {t('cam.auto')}
          </button>
        )}
        {state === 'live' && (
          <div className={`cam-zoom ${mode === 'scan' ? 'above-seg' : ''} ${mode === 'timestamp' ? 'side' : ''}`}>
            {ZOOM_STEPS.filter((z) => z <= maxZoom).map((z, i, steps) => {
              // The highlighted button is the step at or below the current zoom; while pinching
              // between steps it shows the exact value (e.g. 1.7×).
              const on = z <= zoom + 0.05 && (steps[i + 1] ?? Infinity) > zoom + 0.05
              return (
                <button key={z} className={on ? 'on' : ''} onClick={() => setZoom(z)}>
                  {on && Math.abs(zoom - z) >= 0.05 ? `${zoom.toFixed(1)}×` : `${z}×`}
                </button>
              )
            })}
          </div>
        )}
        {mode === 'scan' && (
          <div className="cam-seg" role="radiogroup">
            <button role="radio" aria-checked={!batch} className={!batch ? 'on' : ''} onClick={() => setBatch(false)}>
              {t('single')}
            </button>
            <button role="radio" aria-checked={batch} className={batch ? 'on' : ''} onClick={() => setBatch(true)}>
              {t('batch')}
            </button>
          </div>
        )}
      </div>

      <div className="cam-bottom">
        {mode === 'timestamp' && (
          // Kept below the preview so nothing covers the watermark being previewed.
          <div className="cam-ts-bar">
            <CombinationChips presetId={stamp.presetId} choosePreset={stamp.choosePreset} />
            <button className={`cam-info-toggle ${stamp.prefs.showInfo ? 'on' : ''}`} onClick={() => stamp.update({ showInfo: !stamp.prefs.showInfo })} aria-pressed={stamp.prefs.showInfo} aria-label={t('ts.showInfo')}>
              <Icon name="clock" size={16} /> {stamp.prefs.showInfo ? t('ts.infoOn') : t('ts.infoOff')}
            </button>
            <button className="cam-stamp-edit" onClick={() => setStampEdit('templates')}>
              <Icon name="edit" size={16} /> {t('ts.edit')}
            </button>
          </div>
        )}
        <div className="cam-strip" ref={stripRef}>
          {MODES.map((m) => (
            <button key={m.id} data-mode={m.id} className={m.id === mode ? 'on' : ''} onClick={() => switchMode(m.id)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <div className="cam-controls">
          <div className="cam-side">
            {mode === 'timestamp' && lastStamped ? (
              <button className="cam-thumb" onClick={() => push('doc', { id: lastStamped.id })} aria-label={t('view')}>
                <img src={lastStamped.url} alt="" />
              </button>
            ) : shots.length > 0 && mode === 'scan' ? (
              <button className="cam-thumb" onClick={() => deliver(shots, mode, hints)} aria-label={t('doneN', { n: shots.length })}>
                {shotUrl && <img src={shotUrl} alt="" />}
                <span className="cam-count">{shots.length}</span>
              </button>
            ) : (
              <button
                className="cam-icon"
                onClick={() => {
                  home()
                  setTab('tools')
                }}
                aria-label={t('tab.tools')}
              >
                <Icon name="grid" size={28} />
              </button>
            )}
          </div>
          <button className={`cam-shutter ${mode === 'qr' ? 'disabled' : ''}`} onClick={shoot} disabled={state !== 'live' || busy || mode === 'qr'} aria-label={t('takePhoto')}>
            <span />
          </button>
          <div className="cam-side">
            {shots.length > 0 && mode === 'scan' ? (
              <button className="cam-done" onClick={() => deliver(shots, mode, hints)}>
                <Icon name="check" size={22} stroke={2.6} />
              </button>
            ) : (
              <button className="cam-icon" onClick={pickAlbum} aria-label={t('album')}>
                <Icon name="image" size={28} />
              </button>
            )}
          </div>
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="option-list">
          <button className="option" onClick={systemCamera}>
            <Icon name="camera" /> {t('useSystemCamera')}
          </button>
          <button
            className="option"
            onClick={() => {
              setMenu(false)
              pickAlbum()
            }}
          >
            <Icon name="image" /> {t('album')}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          {t('systemCameraNote')}
        </p>
      </Sheet>
      {qrText && <QrResult text={qrText} onClose={() => setQrText(null)} />}
      <Sheet open={stampEdit != null} onClose={() => setStampEdit(null)} title={t('ts.edit')}>
        <div className="stack">
          <Segmented
            value={stampEdit ?? 'templates'}
            onChange={setStampEdit}
            options={[
              { value: 'templates', label: t('ts.templates') },
              { value: 'content', label: t('ts.content') },
            ]}
          />
          {stampEdit === 'content' ? (
            <StampContentForm prefs={stamp.prefs} update={stamp.update} place={place} setPlace={setPlace} live />
          ) : (
            <>
              <PresetBar prefs={stamp.prefs} presetId={stamp.presetId} choosePreset={stamp.choosePreset} />
              <TemplatePicker prefs={stamp.prefs} update={stamp.update} options={stampOptions} when={new Date()} />
            </>
          )}
          <button className="btn primary block" onClick={() => setStampEdit(null)}>
            {t('done')}
          </button>
        </div>
      </Sheet>
    </div>
  )
}

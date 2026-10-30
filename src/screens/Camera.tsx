// In-app camera, modelled on dedicated scanner apps: live preview with document outline,
// Single/Batch shooting, and a swipeable strip of modes that hand the photo to the right tool.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/ui'
import type { TKey } from '../i18n'
import { detectQuadRGBA } from '../lib/detect'
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d, type Quad } from '../lib/image'
import { decodeCanvas } from '../lib/qr'
import { useApp } from '../state'
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

/** Modes that photograph a document and benefit from the live outline. */
const DOC_MODES: CamMode[] = ['scan', 'idcard', 'ocr', 'word']

type Facing = 'environment' | 'user'

function useCamera(facing: Facing) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting')
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false })
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
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean }
        setTorch({ supported: !!caps.torch, on: false })
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

  return { videoRef, state, torch, toggleTorch }
}

/** Grabs the current video frame at full resolution as a JPEG file. */
async function grabFrame(v: HTMLVideoElement): Promise<File> {
  const c = createCanvas(v.videoWidth, v.videoHeight)
  ctx2d(c).drawImage(v, 0, 0, c.width, c.height)
  const blob = await canvasToBlob(c, 'image/jpeg', 0.93)
  return new File([blob], `AnyScan-${Date.now()}.jpg`, { type: 'image/jpeg' })
}

export function CameraScreen({ mode: initialMode = 'scan' }: { mode?: CamMode }) {
  const { t, back, replace, pickFiles, toast, home, setTab } = useApp()
  const [mode, setMode] = useState<CamMode>(initialMode)
  const [batch, setBatch] = useState(false)
  const [shots, setShots] = useState<File[]>([])
  const [shotUrl, setShotUrl] = useState<string>()
  const [facing, setFacing] = useState<Facing>('environment')
  const [outline, setOutline] = useState<string | null>(null)
  const [qrText, setQrText] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const { videoRef, state, torch, toggleTorch } = useCamera(facing)
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

  // Live document outline (document modes) or live QR decoding (QR mode).
  useEffect(() => {
    if (state !== 'live') return
    const small = createCanvas(1, 1)
    let alive = true
    let running = false
    const tick = async () => {
      const v = videoRef.current
      const stage = stageRef.current
      if (!alive || running || !v || !stage || !v.videoWidth || qrText) return
      running = true
      try {
        if (mode === 'qr') {
          const s = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight))
          small.width = Math.round(v.videoWidth * s)
          small.height = Math.round(v.videoHeight * s)
          ctx2d(small).drawImage(v, 0, 0, small.width, small.height)
          const r = await decodeCanvas(small)
          if (r && alive) {
            addQrHistory(r, 'scan')
            setQrText(r)
          }
        } else if (DOC_MODES.includes(mode)) {
          const s = 300 / Math.max(v.videoWidth, v.videoHeight)
          small.width = Math.round(v.videoWidth * s)
          small.height = Math.round(v.videoHeight * s)
          const c = ctx2d(small)
          c.drawImage(v, 0, 0, small.width, small.height)
          const q: Quad | null = detectQuadRGBA(c.getImageData(0, 0, small.width, small.height).data, small.width, small.height)
          if (!alive) return
          if (!q) setOutline(null)
          else {
            // The preview uses object-fit: cover, so map frame coordinates through the same crop.
            const W = stage.clientWidth
            const H = stage.clientHeight
            const k = Math.max(W / v.videoWidth, H / v.videoHeight)
            const dx = (W - v.videoWidth * k) / 2
            const dy = (H - v.videoHeight * k) / 2
            setOutline(q.map((p) => `${((p.x / small.width) * v.videoWidth * k + dx).toFixed(1)},${((p.y / small.height) * v.videoHeight * k + dy).toFixed(1)}`).join(' '))
          }
        } else setOutline(null)
      } finally {
        running = false
      }
    }
    const id = window.setInterval(tick, mode === 'qr' ? 200 : 350)
    return () => {
      alive = false
      window.clearInterval(id)
      setOutline(null)
    }
  }, [mode, state, qrText, videoRef])

  /** Sends photos (from the camera, the album or the system camera) to the tool for `mode`. */
  const deliver = async (files: File[], m: CamMode = mode) => {
    if (!files.length) return
    switch (m) {
      case 'scan':
        return replace('scan', { files })
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

  const shoot = async () => {
    const v = videoRef.current
    if (!v || state !== 'live' || busy || mode === 'qr') return
    setBusy(true)
    setFlash((n) => n + 1)
    try {
      const f = await grabFrame(v)
      if (mode === 'scan' && batch) setShots((s) => [...s, f])
      else if (mode === 'idcard') {
        const next = [...shots, f]
        if (next.length >= 2) await deliver(next)
        else {
          setShots(next)
          toast(t('nowBackSide'))
        }
      } else await deliver([f])
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: CamMode) => {
    if (m === mode) return
    if (shots.length && !window.confirm(t('discardShots', { n: shots.length }))) return
    setShots([])
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
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
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
        <video ref={videoRef} playsInline muted autoPlay className={facing === 'user' ? 'mirror' : ''} />
        {outline && (
          <svg className="cam-overlay" width="100%" height="100%">
            <polygon points={outline} />
          </svg>
        )}
        {mode === 'idcard' && (
          <div className="cam-guide card">
            <span>{shots.length === 0 ? t('cardFront') : t('cardBack')}</span>
          </div>
        )}
        {mode === 'idphoto' && <div className="cam-guide face" />}
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
        <div className="cam-strip" ref={stripRef}>
          {MODES.map((m) => (
            <button key={m.id} data-mode={m.id} className={m.id === mode ? 'on' : ''} onClick={() => switchMode(m.id)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        <div className="cam-controls">
          <div className="cam-side">
            {shots.length > 0 && mode === 'scan' ? (
              <button className="cam-thumb" onClick={() => deliver(shots)} aria-label={t('doneN', { n: shots.length })}>
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
              <button className="cam-done" onClick={() => deliver(shots)}>
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
    </div>
  )
}

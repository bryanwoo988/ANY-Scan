// Sharing and saving files. On iPhone the share sheet is the way to "Save to Files" or send to apps.

export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files })
  } catch {
    return false
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Opens the system share sheet, falling back to downloads. Returns false if the user cancelled. */
export async function shareOrDownload(files: { blob: Blob; name: string }[], title?: string): Promise<boolean> {
  const fileObjs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }))
  if (canShareFiles(fileObjs)) {
    try {
      await navigator.share({ files: fileObjs, title })
      return true
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
      // iOS only opens the share sheet right after a tap. If generating the file took too long,
      // let the caller ask for a second tap rather than silently downloading instead.
      if ((e as Error).name === 'NotAllowedError') throw e
    }
  }
  files.forEach((f) => download(f.blob, f.name))
  return true
}

export async function shareText(text: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'
    }
  }
  await copyText(text)
  return 'copied'
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

export class EdgeEngine {
  constructor() {
    this._audio = null
    this._pendingResolve = null
    this._gen = 0
    this._cache = new Map()  // key: `${voice}|${rate}|${text}` → Promise<{audio, format}>
  }

  _key(text, voice, ratePercent) { return `${voice}|${ratePercent}|${text}` }

  _fetch(text, voice, ratePercent, format) {
    const key = this._key(text, voice, ratePercent) + (format ? `|${format}` : '')
    let p = this._cache.get(key)
    if (!p) {
      p = window.electronAPI.edgeTTS({ text, voice, rate: ratePercent, format })
        .then(res => {
          if (typeof res === 'string') return { audio: res, format: 'mp3' }
          return res
        })
        .catch(err => { this._cache.delete(key); throw err })
      this._cache.set(key, p)
    }
    return p
  }

  prefetch(text, voice, speed) {
    if (!text) return
    const ratePercent = Math.round((speed - 1) * 100)
    this._fetch(text, voice, ratePercent).catch(() => {})
  }

  clearCache() { this._cache.clear() }

  async synthesize(text, voice, speed) {
    // Same in-memory 24kHz 48kbps MP3 path as speak()/playback.
    const ratePercent = Math.round((speed - 1) * 100)
    return this._fetch(text, voice, ratePercent)
  }

  async speak(text, voice, speed) {
    // Convert speed multiplier to percentage offset (1.0 → 0%, 1.5 → +50%, 0.5 → -50%)
    const ratePercent = Math.round((speed - 1) * 100)
    const myGen = ++this._gen

    let result
    try {
      result = await this._fetch(text, voice, ratePercent)
    } catch (err) {
      if (myGen !== this._gen) return  // cancelled while fetching — suppress error
      throw err
    }
    if (myGen !== this._gen) return  // cancelled between fetch and playback

    const base64 = result.audio
    return new Promise((resolve) => {
      if (myGen !== this._gen) { resolve(); return }

      const bytes = atob(base64)
      const arr = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
      const blob = new Blob([arr], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)

      const audio = new Audio(url)
      this._audio = audio
      this._pendingResolve = resolve

      const finish = () => {
        URL.revokeObjectURL(url)
        this._pendingResolve = null
        resolve()
      }
      audio.onended = finish
      audio.onerror = finish
      audio.play().catch(finish)
    })
  }

  cancel() {
    this._gen++  // invalidate any in-flight speak()
    if (this._audio) {
      this._audio.pause()
      this._audio.src = ''
      this._audio = null
    }
    if (this._pendingResolve) {
      this._pendingResolve()
      this._pendingResolve = null
    }
  }
}

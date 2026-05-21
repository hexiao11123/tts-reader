export class EdgeEngine {
  constructor() {
    this._audio = null
    this._pendingResolve = null
    this._gen = 0
    this._cache = new Map()  // key: `${voice}|${rate}|${text}` → Promise<base64>
  }

  _key(text, voice, ratePercent) { return `${voice}|${ratePercent}|${text}` }

  _fetch(text, voice, ratePercent) {
    const key = this._key(text, voice, ratePercent)
    let p = this._cache.get(key)
    if (!p) {
      p = window.electronAPI.edgeTTS({ text, voice, rate: ratePercent })
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

  async speak(text, voice, speed) {
    // Convert speed multiplier to percentage offset (1.0 → 0%, 1.5 → +50%, 0.5 → -50%)
    const ratePercent = Math.round((speed - 1) * 100)
    const myGen = ++this._gen

    let base64
    try {
      base64 = await this._fetch(text, voice, ratePercent)
    } catch (err) {
      if (myGen !== this._gen) return  // cancelled while fetching — suppress error
      throw err
    }
    if (myGen !== this._gen) return  // cancelled between fetch and playback

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

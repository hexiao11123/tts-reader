import { XunfeiEngine } from './engine-xunfei.js'
import { EdgeEngine } from './engine-edge.js'
import { concatInt16, decodeToPcm24k, pcmFromBase64, pcmFromMaybeWav, resampleInt16, TARGET_RATE } from './audio-export.js'

export const AI_DISCLOSURE = '本音频由人工智能生成'

export class EngineManager {
  constructor({ onFallback, onModeChange }) {
    this._xunfei = new XunfeiEngine()
    this._edge = new EdgeEngine()
    this._mode = 'system'        // 'edge' | 'xunfei' | 'system'
    this._currentVcn = '__system_default__'
    this._speed = 1.0
    this._paused = false
    this._pausedText = ''
    this._onFallback = onFallback || (() => {})
    this._onModeChange = onModeChange || (() => {})
    this._systemUtterance = null
    this._systemTimer = null    // setTimeout ID，用于取消还未触发的 speak
  }

  setMode(mode) { this._mode = mode }
  getMode() { return this._mode }
  getVcn() { return this._currentVcn }
  getSpeed() { return this._speed }
  setVcn(vcn)   {
    if (vcn !== this._currentVcn) this._edge.clearCache()
    this._currentVcn = vcn
  }
  setSpeed(s)   {
    if (s !== this._speed) this._edge.clearCache()
    this._speed = s
  }
  setCredentials(cfg) { this._xunfei.setCredentials(cfg) }

  prefetch(text) {
    if (this._mode === 'edge') this._edge.prefetch(text, this._currentVcn, this._speed)
  }

  async speak(text) {
    this._paused = false
    this._pausedText = text

    if (this._mode === 'edge') {
      try {
        await this._edge.speak(text, this._currentVcn, this._speed)
      } catch (err) {
        console.warn('Edge TTS 失败，回退系统语音:', err.message)
        this.setMode('system')
        this._onFallback(err.message)
        this._onModeChange('system')
        await this._speakSystem(text)
      }
    } else if (this._mode === 'xunfei') {
      try {
        await this._xunfei.speak(text, this._currentVcn, this._speed)
      } catch (err) {
        console.warn('讯飞失败，回退系统语音:', err.message)
        this.setMode('system')
        this._onFallback(err.message)
        this._onModeChange('system')
        await this._speakSystem(text)
      }
    } else {
      await this._speakSystem(text)
    }
  }

  async synthesize(text) {
    if (!text) return new Int16Array(0)
    if (this._mode === 'edge') {
      const result = await this._edge.synthesize(text, this._currentVcn, this._speed)
      const { buffer } = pcmFromBase64(result.audio)
      if (result.format === 'pcm' && buffer.byteLength > 44) {
        return pcmFromMaybeWav(buffer)
      }
      try {
        return await decodeToPcm24k(buffer)
      } catch (err) {
        const raw = await window.electronAPI.decodeMp3(result.audio)
        const bytes = raw instanceof Uint8Array ? raw.slice() : new Uint8Array(raw)
        const even = bytes.byteLength & ~1
        return new Int16Array(bytes.buffer, 0, even / 2)
      }
    }
    if (this._mode === 'xunfei') {
      const pcm16k = await this._xunfei.synthesize(text, this._currentVcn, this._speed)
      return resampleInt16(pcm16k, 16000, TARGET_RATE)
    }
    const buf = await window.electronAPI.systemTTS({
      text,
      voice: this._currentVcn,
      speed: this._speed,
    })
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    const copy = bytes.slice()
    const even = copy.byteLength & ~1
    return new Int16Array(copy.buffer, 0, even / 2)
  }

  async synthesizeBlocks(texts, { onProgress } = {}) {
    const chunks = []
    for (let i = 0; i < texts.length; i++) {
      if (onProgress) onProgress(i, texts.length)
      const pcm = await this.synthesize(texts[i])
      if (pcm && pcm.length) chunks.push(pcm)
    }
    if (onProgress) onProgress(texts.length, texts.length)
    return concatInt16(chunks)
  }

  _speakSystem(text) {
    return new Promise((resolve) => {
      // 清除上一个还未触发的 setTimeout，防止旧语音延迟启动造成双声音
      if (this._systemTimer) { clearTimeout(this._systemTimer); this._systemTimer = null }
      window.speechSynthesis.cancel()

      const utt = new SpeechSynthesisUtterance(text)
      utt.lang = 'zh-CN'
      utt.rate = this._speed
      const voices = window.speechSynthesis.getVoices()
      let zhVoice = null
      if (this._currentVcn && this._currentVcn !== '__system_default__') {
        zhVoice = voices.find(v => v.name === this._currentVcn)
      }
      if (!zhVoice) zhVoice = voices.find(v => v.lang.startsWith('zh-CN')) || voices.find(v => v.lang.startsWith('zh'))
      if (zhVoice) utt.voice = zhVoice
      this._systemUtterance = utt
      utt.onend = resolve
      utt.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') resolve() }
      this._systemTimer = setTimeout(() => {
        this._systemTimer = null
        window.speechSynthesis.speak(utt)
      }, 100)
    })
  }

  pause() {
    this._paused = true
    this._edge.cancel()
    if (this._systemTimer) { clearTimeout(this._systemTimer); this._systemTimer = null }
    this._xunfei.pause()
    window.speechSynthesis.cancel()
  }

  resume() {
    if (!this._paused) return
    this._paused = false
    // 所有引擎都从句首重播
    this.speak(this._pausedText).catch(err => console.warn('resume speak failed:', err.message))
  }

  cancel() {
    this._paused = false
    this._pausedText = ''
    this._edge.cancel()
    if (this._systemTimer) { clearTimeout(this._systemTimer); this._systemTimer = null }
    this._xunfei.cancel()
    window.speechSynthesis.cancel()
  }

  async testXunfei(cfg) {
    return this._xunfei.testCredentials(cfg)
  }
}

import { XunfeiEngine } from './engine-xunfei.js'

export class EngineManager {
  constructor({ onFallback }) {
    this._xunfei = new XunfeiEngine()
    this._mode = 'system'       // 'xunfei' | 'system'
    this._currentVcn = 'xiaoyan'
    this._speed = 1.0
    this._paused = false
    this._pausedText = ''
    this._onFallback = onFallback || (() => {})
    this._systemUtterance = null
  }

  setMode(mode) { this._mode = mode }
  setVcn(vcn)   { this._currentVcn = vcn }
  setSpeed(s)   { this._speed = s }
  setCredentials(cfg) { this._xunfei.setCredentials(cfg) }

  async speak(text) {
    this._paused = false
    this._pausedText = text

    if (this._mode === 'xunfei') {
      try {
        await this._xunfei.speak(text, this._currentVcn, this._speed)
      } catch (err) {
        console.warn('讯飞失败，回退系统语音:', err.message)
        this._onFallback(err.message)
        this.setMode('system')
        await this._speakSystem(text)
      }
    } else {
      await this._speakSystem(text)
    }
  }

  _speakSystem(text) {
    return new Promise((resolve) => {
      window.speechSynthesis.cancel()
      const utt = new SpeechSynthesisUtterance(text)
      utt.lang = 'zh-CN'
      utt.rate = this._speed
      // 优先选中文语音
      const voices = window.speechSynthesis.getVoices()
      const zhVoice = voices.find(v => v.lang.startsWith('zh-CN')) || voices.find(v => v.lang.startsWith('zh'))
      if (zhVoice) utt.voice = zhVoice
      this._systemUtterance = utt
      utt.onend = resolve
      utt.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') resolve() }
      setTimeout(() => window.speechSynthesis.speak(utt), 100)
    })
  }

  pause() {
    this._paused = true
    if (this._mode === 'xunfei') {
      this._xunfei.pause()
    } else {
      window.speechSynthesis.pause()
    }
  }

  resume() {
    if (!this._paused) return
    this._paused = false
    if (this._mode === 'xunfei') {
      // 讯飞无原生暂停，从句首重播
      this.speak(this._pausedText).catch(err => console.warn('resume speak failed:', err.message))
    } else {
      window.speechSynthesis.resume()
    }
  }

  cancel() {
    this._paused = false
    this._pausedText = ''
    this._xunfei.cancel()
    window.speechSynthesis.cancel()
  }

  async testXunfei(cfg) {
    return this._xunfei.testCredentials(cfg)
  }
}

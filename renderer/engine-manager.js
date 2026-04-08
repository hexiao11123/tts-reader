import { XunfeiEngine } from './engine-xunfei.js'
import { EdgeEngine } from './engine-edge.js'

export class EngineManager {
  constructor({ onFallback, onModeChange }) {
    this._xunfei = new XunfeiEngine()
    this._edge = new EdgeEngine()
    this._mode = 'edge'        // 'edge' | 'xunfei' | 'system'
    this._currentVcn = 'zh-CN-XiaoxiaoNeural'
    this._speed = 1.0
    this._paused = false
    this._pausedText = ''
    this._onFallback = onFallback || (() => {})
    this._onModeChange = onModeChange || (() => {})
    this._systemUtterance = null
    this._systemTimer = null    // setTimeout ID，用于取消还未触发的 speak
  }

  setMode(mode) { this._mode = mode }
  setVcn(vcn)   { this._currentVcn = vcn }
  setSpeed(s)   { this._speed = s }
  setCredentials(cfg) { this._xunfei.setCredentials(cfg) }

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

  _speakSystem(text) {
    return new Promise((resolve) => {
      // 清除上一个还未触发的 setTimeout，防止旧语音延迟启动造成双声音
      if (this._systemTimer) { clearTimeout(this._systemTimer); this._systemTimer = null }
      window.speechSynthesis.cancel()

      const utt = new SpeechSynthesisUtterance(text)
      utt.lang = 'zh-CN'
      utt.rate = this._speed
      const voices = window.speechSynthesis.getVoices()
      const zhVoice = voices.find(v => v.lang.startsWith('zh-CN')) || voices.find(v => v.lang.startsWith('zh'))
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

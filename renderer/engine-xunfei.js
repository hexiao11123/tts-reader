// 依赖：window.CryptoJS（由 index.html 通过 <script> 加载 crypto-js）

function buildAuthUrl(apiKey, apiSecret) {
  const host = 'tts-api.xfyun.cn'
  const path = '/v2/tts'
  const date = new Date().toUTCString()
  const signStr = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
  const sig = CryptoJS.HmacSHA256(signStr, apiSecret)
  const sigBase64 = CryptoJS.enc.Base64.stringify(sig)
  const authStr = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sigBase64}"`
  const authBase64 = btoa(authStr)
  return `wss://${host}${path}?authorization=${authBase64}&date=${encodeURIComponent(date)}&host=${host}`
}

async function playPCMChunks(chunks) {
  const totalLen = chunks.reduce((s, c) => s + c.length, 0)
  const pcm = new Int16Array(totalLen)
  let offset = 0
  for (const c of chunks) { pcm.set(c, offset); offset += c.length }
  const float32 = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 32768.0
  const ctx = new AudioContext({ sampleRate: 16000 })
  const buffer = ctx.createBuffer(1, float32.length, 16000)
  buffer.copyToChannel(float32, 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return new Promise(resolve => {
    source.onended = () => { ctx.close(); resolve() }
  })
}

export class XunfeiEngine {
  constructor() {
    this._ws = null
    this._cancelled = false
    this._config = { appId: '', apiKey: '', apiSecret: '' }
  }

  setCredentials(config) {
    this._config = config
  }

  // 语速映射：UI 0.5x-2.0x → 讯飞 0-100
  _mapSpeed(uiRate) {
    return Math.round((uiRate - 0.5) / 1.5 * 100)
  }

  async speak(text, vcn, speed) {
    this._cancelled = false
    const { appId, apiKey, apiSecret } = this._config
    if (!appId || !apiKey || !apiSecret) throw new Error('未配置讯飞凭证')

    const url = buildAuthUrl(apiKey, apiSecret)
    const chunks = []

    return new Promise((resolve, reject) => {
      const TIMEOUT = 5000
      let connected = false
      let done = false

      const timer = setTimeout(() => {
        if (!connected) { ws.close(); reject(new Error('连接超时')) }
      }, TIMEOUT)

      const ws = new WebSocket(url)
      this._ws = ws

      ws.onopen = () => {
        connected = true
        clearTimeout(timer)
        ws.send(JSON.stringify({
          common: { app_id: appId },
          business: {
            aue: 'raw', auf: 'audio/L16;rate=16000',
            vcn, speed: this._mapSpeed(speed), volume: 50, pitch: 50, tte: 'UTF8',
          },
          data: { status: 2, text: btoa(unescape(encodeURIComponent(text))) },
        }))
      }

      ws.onmessage = (e) => {
        if (this._cancelled) { ws.close(); resolve(); return }
        const msg = JSON.parse(e.data)
        if (msg.code !== 0) { ws.close(); reject(new Error(`讯飞错误码 ${msg.code}`)); return }
        if (msg.data?.audio) {
          const bin = atob(msg.data.audio)
          const arr = new Int16Array(bin.length / 2)
          for (let i = 0; i < arr.length; i++)
            arr[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8))
          chunks.push(arr)
        }
        if (msg.data?.status === 2) {
          done = true
          ws.close()
          playPCMChunks(chunks).then(resolve).catch(reject)
        }
      }

      ws.onerror = () => { if (!done) reject(new Error('WebSocket 错误')) }
      ws.onclose = () => { clearTimeout(timer); if (!done && !this._cancelled) reject(new Error('连接意外关闭')) }
    })
  }

  pause()  { this._cancelled = true; this._ws?.close() }
  resume() {} // 由 engine-manager 重新 speak 当前句
  cancel() { this._cancelled = true; this._ws?.close() }

  // 凭证验证：发送单字合成，能收到 status=2 即为成功
  async testCredentials(config) {
    const prev = this._config
    this.setCredentials(config)
    try {
      await this.speak('测', 'xiaoyan', 1.0)
      return true
    } catch {
      return false
    } finally {
      this._config = prev
    }
  }
}

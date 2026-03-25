# 朗读器 v2.0 语音升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有朗读器基础上接入讯飞 WebSocket TTS，支持两级音色选择，保留系统语音兜底，并将全部 UI 文案中文化。

**Architecture:** 新增三个独立模块（voices.js / engine-xunfei.js / engine-manager.js），renderer.js 只保留播放器逻辑并委托给 engine-manager；main.js 负责凭证加密读写；HTML/CSS 新增音色面板和设置面板。

**Tech Stack:** Electron 41, Web Speech API, WebSocket, Web Audio API, crypto-js, safeStorage

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `package.json` | 修改 | 新增 crypto-js 依赖 |
| `main.js` | 修改 | 新增 get-config / set-config IPC，safeStorage 加密读写 |
| `preload.js` | 修改 | 暴露 getConfig / setConfig |
| `renderer/voices.js` | 新建 | 音色分类数据常量 |
| `renderer/engine-xunfei.js` | 新建 | 讯飞 WebSocket TTS 引擎 |
| `renderer/engine-manager.js` | 新建 | 统一引擎接口，管理引擎切换与回退 |
| `renderer/index.html` | 修改 | 加载新模块，新增音色面板/设置面板 HTML，中文化文案 |
| `renderer/style.css` | 修改 | 新增音色面板、设置面板、通知条样式 |
| `renderer/renderer.js` | 修改 | 集成 engine-manager，新增音色/设置面板交互，中文化 |

---

## Task 1：安装 crypto-js

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/hee/tts-reader
npm install crypto-js
```

Expected: `added N packages`

- [ ] **Step 2: 验证安装**

```bash
node -e "const C = require('crypto-js'); console.log(typeof C.HmacSHA256)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add crypto-js for xunfei auth"
```

---

## Task 2：主进程凭证读写（main.js）

**Files:**
- Modify: `main.js`

- [ ] **Step 1: 在 main.js 顶部新增 safeStorage 引入和 configPath 定义**

在文件顶部 `const { app, BrowserWindow, ipcMain, dialog } = require('electron')` 这行后面加：

```js
const { safeStorage } = require('electron')

function getConfigPath() {
  return require('path').join(app.getPath('userData'), 'config.json')
}

function readConfig() {
  const p = getConfigPath()
  if (!require('fs').existsSync(p)) return {}
  try { return JSON.parse(require('fs').readFileSync(p, 'utf-8')) } catch { return {} }
}

function writeConfig(data) {
  require('fs').writeFileSync(getConfigPath(), JSON.stringify(data, null, 2))
}
```

- [ ] **Step 2: 新增 get-config IPC handler**（在 open-file handler 之后）

```js
ipcMain.handle('get-config', () => {
  const cfg = readConfig()
  const xf = cfg.xunfei || {}
  const decrypt = (v) => {
    if (!v || !safeStorage.isEncryptionAvailable()) return ''
    try { return safeStorage.decryptString(Buffer.from(v, 'base64')) } catch { return '' }
  }
  return {
    xunfei: {
      appId:     decrypt(xf.appId),
      apiKey:    decrypt(xf.apiKey),
      apiSecret: decrypt(xf.apiSecret),
    },
    lastVoice: cfg.lastVoice || 'xiaoyan',
    lastSpeed: cfg.lastSpeed || 1.0,
  }
})
```

- [ ] **Step 3: 新增 set-config IPC handler**

```js
ipcMain.handle('set-config', (_, patch) => {
  const cfg = readConfig()
  const encrypt = (v) => {
    if (!v || !safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.encryptString(v).toString('base64')
  }
  if (patch.xunfei) {
    cfg.xunfei = {
      appId:     encrypt(patch.xunfei.appId),
      apiKey:    encrypt(patch.xunfei.apiKey),
      apiSecret: encrypt(patch.xunfei.apiSecret),
    }
  }
  if (patch.lastVoice !== undefined) cfg.lastVoice = patch.lastVoice
  if (patch.lastSpeed !== undefined) cfg.lastSpeed = patch.lastSpeed
  writeConfig(cfg)
  return { ok: true }
})
```

- [ ] **Step 4: 启动 app 验证无报错**

```bash
npm start
```

Expected: app 正常打开，控制台无错误

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat: add get-config/set-config IPC with safeStorage encryption"
```

---

## Task 3：preload.js 暴露配置 API

**Files:**
- Modify: `preload.js`

- [ ] **Step 1: 更新 preload.js**

完整替换为：

```js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFile:  () => ipcRenderer.invoke('open-file'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
})
```

- [ ] **Step 2: 重启 app，在 DevTools Console 验证**

```js
window.electronAPI.getConfig().then(console.log)
```

Expected: `{ xunfei: { appId: '', apiKey: '', apiSecret: '' }, lastVoice: 'xiaoyan', lastSpeed: 1 }`

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat: expose getConfig/setConfig in preload"
```

---

## Task 4：音色数据文件

**Files:**
- Create: `renderer/voices.js`

- [ ] **Step 1: 创建 renderer/voices.js**

```js
export const VOICE_CATEGORIES = [
  {
    id: 'gentle-female',
    label: '温柔女声',
    voices: [
      { vcn: 'xiaoyan',   name: '晓燕' },
      { vcn: 'aisjiuxu',  name: '晓萌' },
      { vcn: 'aisxping',  name: '晓萍' },
      { vcn: 'aisjinger', name: '晶晶' },
    ],
  },
  {
    id: 'magnetic-male',
    label: '磁性男声',
    voices: [
      { vcn: 'aisbabyxu',  name: '小炫' },
      { vcn: 'x2_mingming', name: '明明' },
      { vcn: 'x2_xiaofeng', name: '小峰' },
    ],
  },
  {
    id: 'news',
    label: '新闻播报',
    voices: [
      { vcn: 'aisjingjing', name: '晶晶' },
      { vcn: 'x2_vixf',    name: '讯飞助手' },
    ],
  },
  {
    id: 'child',
    label: '儿童声',
    voices: [
      { vcn: 'x2_xiaomei', name: '小美' },
      { vcn: 'x2_xiaobei', name: '小贝' },
    ],
  },
  {
    id: 'system',
    label: '系统语音',
    voices: [], // 运行时动态填充
  },
]

export function findVoice(vcn) {
  for (const cat of VOICE_CATEGORIES) {
    const v = cat.voices.find(v => v.vcn === vcn)
    if (v) return { category: cat, voice: v }
  }
  return null
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/voices.js
git commit -m "feat: add voice categories data"
```

---

## Task 5：讯飞引擎

**Files:**
- Create: `renderer/engine-xunfei.js`

- [ ] **Step 1: 创建 renderer/engine-xunfei.js**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add renderer/engine-xunfei.js
git commit -m "feat: add xunfei WebSocket TTS engine"
```

---

## Task 6：引擎管理器

**Files:**
- Create: `renderer/engine-manager.js`

- [ ] **Step 1: 创建 renderer/engine-manager.js**

```js
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
      this.speak(this._pausedText)
    } else {
      window.speechSynthesis.resume()
    }
  }

  cancel() {
    this._paused = false
    this._xunfei.cancel()
    window.speechSynthesis.cancel()
  }

  async testXunfei(cfg) {
    return this._xunfei.testCredentials(cfg)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer/engine-manager.js
git commit -m "feat: add engine manager with xunfei/system switching and fallback"
```

---

## Task 7：HTML 结构更新

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: 完整替换 renderer/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>朗读器</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="app">
    <!-- 通知条 -->
    <div class="notification-bar" id="notificationBar"></div>

    <!-- 顶部文件栏 -->
    <div class="topbar">
      <span class="file-name" id="fileName">未打开文件</span>
      <button class="btn-open" id="btnOpen">打开文件</button>
    </div>

    <!-- 文本显示区域 -->
    <div class="text-area" id="textArea">
      <div class="placeholder" id="placeholder">
        <p>点击「打开文件」加载 Word、PDF 或 TXT 文档</p>
      </div>
      <div class="sentences" id="sentences"></div>
    </div>

    <!-- 播放器控制栏 -->
    <div class="player">
      <!-- 音色行 -->
      <div class="voice-row">
        <div class="voice-selector-wrap">
          <button class="btn-voice" id="btnVoice">音色：加载中…</button>
          <!-- 向上弹出面板 -->
          <div class="voice-panel" id="voicePanel" style="display:none">
            <div class="voice-categories" id="voiceCategories"></div>
            <div class="voice-divider"></div>
            <div class="voice-list" id="voiceList"></div>
          </div>
        </div>
        <button class="btn-settings" id="btnSettings" title="设置">⚙</button>
      </div>

      <!-- 进度条 -->
      <div class="progress-container">
        <span class="time" id="currentTime">00:00</span>
        <div class="progress-bar" id="progressBar">
          <div class="progress-fill" id="progressFill"></div>
          <div class="progress-thumb" id="progressThumb"></div>
        </div>
        <span class="time" id="totalTime">00:00</span>
      </div>

      <!-- 控制按钮 -->
      <div class="controls">
        <button class="ctrl-btn" id="btnRestart" title="回到开头">⏮</button>
        <button class="ctrl-btn" id="btnPrev"    title="上一句">◀◀</button>
        <button class="ctrl-btn btn-play" id="btnPlay" title="播放">▶</button>
        <button class="ctrl-btn" id="btnNext"    title="下一句">▶▶</button>
        <button class="ctrl-btn" id="btnEnd"     title="跳到结尾">⏭</button>

        <div class="speed-control">
          <span class="speed-label">语速</span>
          <input type="range" id="speedSlider" min="0.5" max="2" step="0.1" value="1" />
          <span class="speed-value" id="speedValue">1.0x</span>
        </div>
      </div>
    </div>

    <!-- 设置面板（覆盖层） -->
    <div class="settings-overlay" id="settingsOverlay" style="display:none">
      <div class="settings-panel">
        <h3>讯飞语音设置</h3>
        <label>AppID<input type="text" id="cfgAppId" placeholder="请输入 AppID" /></label>
        <label>APIKey<input type="text" id="cfgApiKey" placeholder="请输入 APIKey" /></label>
        <label>APISecret<input type="password" id="cfgApiSecret" placeholder="请输入 APISecret" /></label>
        <div class="settings-actions">
          <a class="btn-link" href="https://www.xfyun.cn/services/online_tts" target="_blank">去讯飞开放平台注册 ↗</a>
          <button class="btn-save" id="btnSave">保存</button>
        </div>
        <div class="settings-status" id="settingsStatus">状态：○ 未配置</div>
        <button class="btn-close-settings" id="btnCloseSettings">✕</button>
      </div>
    </div>
  </div>

  <script src="../node_modules/tesseract.js/dist/tesseract.min.js"></script>
  <script src="../node_modules/crypto-js/crypto-js.js"></script>
  <script type="module" src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: 启动 app 验证页面结构无报错**

```bash
npm start
```

Expected: 界面正常显示，底部有「音色」按钮和 ⚙ 按钮

- [ ] **Step 3: Commit**

```bash
git add renderer/index.html
git commit -m "feat: update HTML with voice panel and settings overlay"
```

---

## Task 8：CSS 样式更新

**Files:**
- Modify: `renderer/style.css`

- [ ] **Step 1: 在 style.css 末尾追加以下样式**

```css
/* ── 通知条 ─────────────────────────────────── */
.notification-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  background: #f38ba8;
  color: #1e1e2e;
  font-size: 13px;
  text-align: center;
  padding: 6px 16px;
  z-index: 1000;
  display: none;
  animation: slideDown 0.2s ease;
}
.notification-bar.show { display: block; }
@keyframes slideDown {
  from { transform: translateY(-100%); }
  to   { transform: translateY(0); }
}

/* ── 音色行 ──────────────────────────────────── */
.voice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0 4px;
}

.voice-selector-wrap {
  position: relative;
}

.btn-voice {
  background: var(--surface2);
  border: none;
  color: var(--accent-light);
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-voice:hover { background: #3a3a52; }

/* 向上弹出面板 */
.voice-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  background: var(--surface2);
  border-radius: 10px;
  padding: 12px;
  min-width: 280px;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.4);
  z-index: 100;
}

.voice-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.voice-cat-btn {
  background: var(--surface);
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.voice-cat-btn.active,
.voice-cat-btn:hover {
  background: var(--accent);
  color: #fff;
}

.voice-divider {
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: 8px 0;
}

.voice-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.voice-item-btn {
  background: var(--surface);
  border: none;
  color: var(--text);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
}
.voice-item-btn.active { background: var(--accent); color: #fff; }
.voice-item-btn:hover  { background: #3a3a52; }

/* ── 设置按钮 ─────────────────────────────────── */
.btn-settings {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.btn-settings:hover { color: var(--text); background: var(--surface2); }

/* ── 设置覆盖层 ───────────────────────────────── */
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-panel {
  background: var(--surface);
  border-radius: 14px;
  padding: 28px 32px;
  width: 360px;
  position: relative;
  box-shadow: 0 8px 40px rgba(0,0,0,0.5);
}

.settings-panel h3 {
  font-size: 16px;
  color: var(--text);
  margin-bottom: 20px;
}

.settings-panel label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
  gap: 4px;
}

.settings-panel input {
  background: var(--surface2);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
  transition: border-color 0.15s;
}
.settings-panel input:focus { border-color: var(--accent); }

.settings-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
}

.btn-link {
  font-size: 12px;
  color: var(--accent-light);
  text-decoration: none;
}
.btn-link:hover { text-decoration: underline; }

.btn-save {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 7px 20px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-save:hover { opacity: 0.85; }

.settings-status {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 12px;
}
.settings-status.ok   { color: #a6e3a1; }
.settings-status.fail { color: #f38ba8; }

.btn-close-settings {
  position: absolute;
  top: 14px; right: 16px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}
.btn-close-settings:hover { color: var(--text); }
```

- [ ] **Step 2: 重启 app 验证样式无报错**

```bash
npm start
```

Expected: 点击「音色」按钮出现面板，点击 ⚙ 出现设置覆盖层

- [ ] **Step 3: Commit**

```bash
git add renderer/style.css
git commit -m "feat: add voice panel and settings panel styles"
```

---

## Task 9：renderer.js 集成

**Files:**
- Modify: `renderer/renderer.js`

- [ ] **Step 1: 完整替换 renderer/renderer.js**

```js
import { VOICE_CATEGORIES, findVoice } from './voices.js'
import { EngineManager } from './engine-manager.js'

// ── 状态 ─────────────────────────────────────────────────────────────────
let sentences = []
let durations  = []
let totalDuration = 0
let currentIndex = 0
let isPlaying = false
let isPaused  = false
let speed = 1.0
let progressInterval = null
let currentSentenceStart = 0
let elapsedBeforeCurrent = 0
let currentVcn = 'xiaoyan'
let voicePanelOpen = false
let activeCategoryId = 'gentle-female'

// ── 引擎管理器 ────────────────────────────────────────────────────────────
const engine = new EngineManager({
  onFallback: (msg) => showNotification(`讯飞连接失败，已切换系统语音（${msg}）`)
})

// ── DOM ──────────────────────────────────────────────────────────────────
const btnOpen      = document.getElementById('btnOpen')
const btnPlay      = document.getElementById('btnPlay')
const btnPrev      = document.getElementById('btnPrev')
const btnNext      = document.getElementById('btnNext')
const btnRestart   = document.getElementById('btnRestart')
const btnEnd       = document.getElementById('btnEnd')
const speedSlider  = document.getElementById('speedSlider')
const speedValue   = document.getElementById('speedValue')
const progressBar  = document.getElementById('progressBar')
const progressFill = document.getElementById('progressFill')
const progressThumb= document.getElementById('progressThumb')
const currentTimeEl= document.getElementById('currentTime')
const totalTimeEl  = document.getElementById('totalTime')
const fileNameEl   = document.getElementById('fileName')
const sentencesEl  = document.getElementById('sentences')
const placeholder  = document.getElementById('placeholder')
const btnVoice     = document.getElementById('btnVoice')
const voicePanel   = document.getElementById('voicePanel')
const voiceCatsEl  = document.getElementById('voiceCategories')
const voiceListEl  = document.getElementById('voiceList')
const btnSettings  = document.getElementById('btnSettings')
const settingsOverlay = document.getElementById('settingsOverlay')
const cfgAppId     = document.getElementById('cfgAppId')
const cfgApiKey    = document.getElementById('cfgApiKey')
const cfgApiSecret = document.getElementById('cfgApiSecret')
const btnSave      = document.getElementById('btnSave')
const btnCloseSettings = document.getElementById('btnCloseSettings')
const settingsStatus   = document.getElementById('settingsStatus')
const notificationBar  = document.getElementById('notificationBar')

// ── 初始化 ────────────────────────────────────────────────────────────────
async function init() {
  // 加载已保存配置
  const cfg = await window.electronAPI.getConfig()
  engine.setCredentials(cfg.xunfei)
  speed = cfg.lastSpeed || 1.0
  speedSlider.value = speed
  speedValue.textContent = speed.toFixed(1) + 'x'
  engine.setSpeed(speed)

  // 确定初始音色
  currentVcn = cfg.lastVoice || 'xiaoyan'
  const found = findVoice(currentVcn)
  if (found) {
    activeCategoryId = found.category.id
    engine.setVcn(currentVcn)
    engine.setMode(found.category.id === 'system' ? 'system' : 'xunfei')
  }

  // 填充系统语音列表
  const sysVoices = window.speechSynthesis.getVoices()
  const sysCat = VOICE_CATEGORIES.find(c => c.id === 'system')
  sysCat.voices = sysVoices
    .filter(v => v.lang.startsWith('zh'))
    .map(v => ({ vcn: v.name, name: v.name.replace(/^Microsoft /, '').split(' ')[0] }))
  if (sysCat.voices.length === 0) sysCat.voices = [{ vcn: '__system_default__', name: '系统默认' }]

  renderVoicePanel()
  updateVoiceButton()
  btnPlay.disabled = true
}

window.speechSynthesis.onvoiceschanged = init
init()

// ── 音色面板 ──────────────────────────────────────────────────────────────
function renderVoicePanel() {
  // 一级分类
  voiceCatsEl.innerHTML = ''
  for (const cat of VOICE_CATEGORIES) {
    const btn = document.createElement('button')
    btn.className = 'voice-cat-btn' + (cat.id === activeCategoryId ? ' active' : '')
    btn.textContent = cat.label
    btn.addEventListener('click', () => {
      activeCategoryId = cat.id
      renderVoicePanel()
    })
    voiceCatsEl.appendChild(btn)
  }

  // 二级音色
  voiceListEl.innerHTML = ''
  const cat = VOICE_CATEGORIES.find(c => c.id === activeCategoryId)
  for (const v of cat.voices) {
    const btn = document.createElement('button')
    btn.className = 'voice-item-btn' + (v.vcn === currentVcn ? ' active' : '')
    btn.textContent = v.name
    btn.addEventListener('click', () => {
      selectVoice(cat, v)
      closeVoicePanel()
    })
    voiceListEl.appendChild(btn)
  }
}

function selectVoice(cat, voice) {
  currentVcn = voice.vcn
  engine.setVcn(voice.vcn)
  engine.setMode(cat.id === 'system' ? 'system' : 'xunfei')
  updateVoiceButton()
  window.electronAPI.setConfig({ lastVoice: voice.vcn })
}

function updateVoiceButton() {
  const cat = VOICE_CATEGORIES.find(c => c.id === activeCategoryId)
  const voice = cat?.voices.find(v => v.vcn === currentVcn)
  btnVoice.textContent = voice ? `音色：${cat.label} · ${voice.name} ▾` : '音色 ▾'
}

function openVoicePanel()  { voicePanelOpen = true;  voicePanel.style.display = 'block'; renderVoicePanel() }
function closeVoicePanel() { voicePanelOpen = false; voicePanel.style.display = 'none' }

btnVoice.addEventListener('click', (e) => {
  e.stopPropagation()
  voicePanelOpen ? closeVoicePanel() : openVoicePanel()
})
document.addEventListener('click', () => { if (voicePanelOpen) closeVoicePanel() })
voicePanel.addEventListener('click', e => e.stopPropagation())

// ── 设置面板 ──────────────────────────────────────────────────────────────
btnSettings.addEventListener('click', async () => {
  const cfg = await window.electronAPI.getConfig()
  cfgAppId.value     = cfg.xunfei.appId     || ''
  cfgApiKey.value    = cfg.xunfei.apiKey    || ''
  cfgApiSecret.value = cfg.xunfei.apiSecret || ''
  const hasConfig = cfg.xunfei.appId && cfg.xunfei.apiKey && cfg.xunfei.apiSecret
  settingsStatus.textContent = hasConfig ? '状态：● 已配置' : '状态：○ 未配置'
  settingsStatus.className = 'settings-status'
  settingsOverlay.style.display = 'flex'
})

btnCloseSettings.addEventListener('click', () => { settingsOverlay.style.display = 'none' })
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) settingsOverlay.style.display = 'none' })

btnSave.addEventListener('click', async () => {
  const cfg = { appId: cfgAppId.value.trim(), apiKey: cfgApiKey.value.trim(), apiSecret: cfgApiSecret.value.trim() }
  await window.electronAPI.setConfig({ xunfei: cfg })
  engine.setCredentials(cfg)

  settingsStatus.textContent = '状态：○ 测试中...'
  settingsStatus.className = 'settings-status'
  const ok = await engine.testXunfei(cfg)
  settingsStatus.textContent = ok ? '状态：● 已连接' : '状态：● 连接失败，请检查凭证'
  settingsStatus.className = 'settings-status ' + (ok ? 'ok' : 'fail')
})

// ── 文本切分 ──────────────────────────────────────────────────────────────
function splitSentences(text) {
  return text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split(/(?<=[。！？…\n\.!?]+)/)
    .map(s => s.trim()).filter(s => s.length > 0)
}

function estimateDuration(text, rate) {
  return (text.replace(/\s/g, '').length || 1) / (4.5 * rate)
}

// ── 加载文本 ──────────────────────────────────────────────────────────────
function loadText(text) {
  sentences = splitSentences(text)
  recalcDurations()
  renderSentences()
  currentIndex = 0
  elapsedBeforeCurrent = 0
  updateProgressUI(0)
  setPlayIcon(false)
  isPlaying = false
  isPaused  = false
  stopProgressTick()
  btnPlay.disabled = false
}

function recalcDurations() {
  durations = sentences.map(s => estimateDuration(s, speed))
  totalDuration = durations.reduce((a, b) => a + b, 0)
  totalTimeEl.textContent = formatTime(totalDuration)
}

// ── 渲染句子 ──────────────────────────────────────────────────────────────
function renderSentences() {
  placeholder.style.display = 'none'
  sentencesEl.innerHTML = ''
  sentences.forEach((s, i) => {
    const span = document.createElement('span')
    span.className = 'sentence'
    span.textContent = s + ' '
    span.dataset.index = i
    span.addEventListener('click', () => jumpToIndex(i))
    sentencesEl.appendChild(span)
  })
}

function highlightSentence(index) {
  document.querySelectorAll('.sentence').forEach(el => el.classList.remove('active'))
  const el = document.querySelector(`.sentence[data-index="${index}"]`)
  if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
}

// ── 播放引擎 ──────────────────────────────────────────────────────────────
async function speak(index) {
  if (index >= sentences.length) { stopAll(); updateProgressUI(totalDuration); return }

  engine.cancel()
  currentIndex = index
  highlightSentence(index)
  isPlaying = true; isPaused = false
  setPlayIcon(true)
  currentSentenceStart = Date.now()
  startProgressTick()

  await engine.speak(sentences[index])

  if (isPlaying && !isPaused) {
    stopProgressTick()
    elapsedBeforeCurrent += durations[index]
    speak(index + 1)
  }
}

function pauseResume() {
  if (!isPlaying && !isPaused && sentences.length > 0) { speak(currentIndex); return }
  if (isPlaying && !isPaused) {
    engine.pause()
    isPaused = true; isPlaying = false
    stopProgressTick(); setPlayIcon(false)
  } else if (isPaused) {
    isPaused = false; isPlaying = true
    setPlayIcon(true)
    currentSentenceStart = Date.now()
    startProgressTick()
    engine.resume()
  }
}

function stopAll() {
  engine.cancel()
  isPlaying = false; isPaused = false
  stopProgressTick(); setPlayIcon(false)
}

function jumpToIndex(index) {
  stopProgressTick()
  elapsedBeforeCurrent = durations.slice(0, index).reduce((a, b) => a + b, 0)
  speak(index)
}

// ── 进度条 ────────────────────────────────────────────────────────────────
function startProgressTick() {
  stopProgressTick()
  progressInterval = setInterval(tickProgress, 100)
}
function stopProgressTick() {
  if (progressInterval) { clearInterval(progressInterval); progressInterval = null }
}
function tickProgress() {
  if (totalDuration === 0) return
  const total = elapsedBeforeCurrent + (Date.now() - currentSentenceStart) / 1000
  updateProgressUI(Math.min(total, totalDuration))
}
function updateProgressUI(elapsed) {
  const pct = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0
  progressFill.style.width = pct + '%'
  progressThumb.style.left = pct + '%'
  currentTimeEl.textContent = formatTime(elapsed)
}

let isDragging = false
progressBar.addEventListener('mousedown', (e) => { isDragging = true; seekTo(e) })
document.addEventListener('mousemove', (e) => { if (isDragging) seekTo(e) })
document.addEventListener('mouseup', () => { isDragging = false })

function seekTo(e) {
  const rect = progressBar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const targetTime = pct * totalDuration
  let acc = 0, targetIndex = 0
  for (let i = 0; i < durations.length; i++) {
    if (acc + durations[i] > targetTime) { targetIndex = i; break }
    acc += durations[i]; targetIndex = i + 1
  }
  targetIndex = Math.min(targetIndex, sentences.length - 1)
  elapsedBeforeCurrent = durations.slice(0, targetIndex).reduce((a, b) => a + b, 0)
  updateProgressUI(targetTime)
  if (isPlaying || isPaused) speak(targetIndex)
  else { currentIndex = targetIndex; highlightSentence(targetIndex) }
}

// ── 控制按钮 ──────────────────────────────────────────────────────────────
btnOpen.addEventListener('click', async () => {
  const result = await window.electronAPI.openFile()
  if (!result) return
  if (result.error) { alert('文件解析失败：' + result.error); return }
  fileNameEl.textContent = result.fileName
  fileNameEl.classList.add('loaded')
  if (result.needsOCR) await handleOCR(result.buffer, result.fileName)
  else loadText(result.text)
})

btnPlay.addEventListener('click', pauseResume)
btnPrev.addEventListener('click', () => jumpToIndex(Math.max(0, currentIndex - 1)))
btnNext.addEventListener('click', () => jumpToIndex(Math.min(sentences.length - 1, currentIndex + 1)))
btnRestart.addEventListener('click', () => jumpToIndex(0))
btnEnd.addEventListener('click', () => {
  stopAll(); updateProgressUI(totalDuration)
  currentIndex = sentences.length - 1; highlightSentence(currentIndex)
})

speedSlider.addEventListener('input', () => {
  speed = parseFloat(speedSlider.value)
  speedValue.textContent = speed.toFixed(1) + 'x'
  engine.setSpeed(speed)
  if (sentences.length > 0) {
    const idx = currentIndex
    recalcDurations()
    elapsedBeforeCurrent = durations.slice(0, idx).reduce((a, b) => a + b, 0)
  }
  if (isPlaying || isPaused) speak(currentIndex)
  window.electronAPI.setConfig({ lastSpeed: speed })
})

// ── OCR ───────────────────────────────────────────────────────────────────
async function handleOCR(bufferArray, fileName) {
  showStatus('正在识别扫描版 PDF，请稍候...')
  btnPlay.disabled = true
  try {
    const pdfjsLib = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
    const uint8 = new Uint8Array(bufferArray)
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise
    const worker = await Tesseract.createWorker('chi_sim', 1, {
      workerPath: '../node_modules/tesseract.js/dist/worker.min.js',
      corePath: '../node_modules/tesseract.js-core/',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    })
    let fullText = ''
    for (let p = 1; p <= pdf.numPages; p++) {
      showStatus(`OCR 识别中：第 ${p} / ${pdf.numPages} 页...`)
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width; canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const { data: { text } } = await worker.recognize(canvas)
      fullText += text + '\n'
    }
    await worker.terminate()
    hideStatus(); loadText(fullText)
  } catch (err) { hideStatus(); alert('OCR 识别失败：' + err.message) }
}

function showStatus(msg) {
  let el = document.getElementById('statusMsg')
  if (!el) {
    el = document.createElement('div'); el.id = 'statusMsg'
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#313145;color:#cdd6f4;padding:20px 32px;border-radius:12px;font-size:15px;z-index:999;box-shadow:0 4px 24px rgba(0,0,0,0.4)'
    document.body.appendChild(el)
  }
  el.textContent = msg
}
function hideStatus() { document.getElementById('statusMsg')?.remove() }

// ── 通知条 ────────────────────────────────────────────────────────────────
let notifTimer = null
function showNotification(msg) {
  notificationBar.textContent = msg
  notificationBar.classList.add('show')
  clearTimeout(notifTimer)
  notifTimer = setTimeout(() => notificationBar.classList.remove('show'), 3000)
}

// ── 工具函数 ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
function setPlayIcon(playing) { btnPlay.textContent = playing ? '⏸' : '▶' }
```

- [ ] **Step 2: 启动 app 完整验证**

```bash
npm start
```

验证清单：
- [ ] 打开 TXT 文件可以播放
- [ ] 点击「音色」弹出面板，可切换分类和音色
- [ ] 点击 ⚙ 打开设置面板
- [ ] 点击「打开文件」标签显示文件名
- [ ] 进度条拖动正常
- [ ] 语速滑块正常

- [ ] **Step 3: Commit**

```bash
git add renderer/renderer.js
git commit -m "feat: integrate engine manager, voice panel, settings panel, Chinese UI"
```

---

## Task 10：讯飞凭证配置验证

> 需要有效的讯飞 AppID / APIKey / APISecret 才能完成此步骤。

- [ ] **Step 1: 打开设置面板，填入讯飞凭证，点击「保存」**

Expected: 状态显示「● 已连接」

- [ ] **Step 2: 选择讯飞音色（如温柔女声·晓燕），打开文档，播放**

Expected: 用讯飞语音朗读，声音自然

- [ ] **Step 3: 断网测试回退**

关闭网络后点击播放，Expected: 顶部出现「讯飞连接失败，已切换系统语音」通知条，继续用系统语音朗读

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify xunfei integration complete"
```

---

## Task 11：打包发布 v2.0

- [ ] **Step 1: 更新版本号**

修改 `package.json` 中 `"version": "1.0.0"` 为 `"version": "2.0.0"`

- [ ] **Step 2: 提交并打 tag**

```bash
git add package.json
git commit -m "chore: bump version to 2.0.0"
git tag v2.0.0
git push origin main
git push origin v2.0.0
```

Expected: GitHub Actions 自动构建 Mac + Windows 安装包，完成后飞书收到通知

---

## 完成标志

- [ ] 讯飞语音正常朗读中文
- [ ] 两级音色选择面板工作正常
- [ ] 讯飞失败自动回退系统语音并提示
- [ ] 设置面板可保存凭证并测试连接
- [ ] 全部 UI 文案为中文
- [ ] 语速 / 音色 / 凭证持久化保存

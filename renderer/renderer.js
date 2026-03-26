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

// ── 引擎管理��� ────────────────────────────────────────────────────────────
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

// ── 文本切分 ─────────────────────��────────────────────────────────────────
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

// ── 渲染句子 ─────────────────────────────────────────────────���────────────
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

// ── 播放引擎 ───────────────────────────────────────────────────���──────��───
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

// ── 进度条 ─────────────────���──────────────────────────────────────────────
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

// ── OCR ───────��───────────────────────────────────────────────────────────
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

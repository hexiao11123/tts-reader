import { VOICE_CATEGORIES, findVoice } from './voices.js'
import { EngineManager } from './engine-manager.js'

// ── 状态 ─────────────────────────────────────────────────────────────────
let files = []             // [{ id, name, text, paragraphs, sentences, durations, totalDuration, blocks, sentenceToBlock }]
let activeFileId = null
let nextFileId = 1

let currentIndex = 0       // 当前全局句索引（当前文件内）
let isPlaying = false
let isPaused  = false
let speed = 1.0
let fontSize = 17          // 正文字号（px）
const DEFAULT_FONT_SIZE = 17
const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 24
let progressInterval = null
let blockHighlightTimer = null
let currentSentenceStart = 0
let elapsedBeforeCurrent = 0
let speakGen = 0
let currentVcn = 'xiaoyan'
let voicePanelOpen = false
let activeCategoryId = 'edge'

// 单块最大字符数：超过则拆分，避免 Edge TTS 单次请求过长
const MAX_BLOCK_CHARS = 400

// ── 引擎管理 ──────────────────────────────────────────────────────────────
const engine = new EngineManager({
  onFallback: (errMsg) => showNotification('Edge TTS 失败: ' + errMsg),
  onModeChange: (mode) => {
    if (mode === 'system') {
      activeCategoryId = 'system'
      const sysCat = VOICE_CATEGORIES.find(c => c.id === 'system')
      if (sysCat && sysCat.voices.length > 0) currentVcn = sysCat.voices[0].vcn
      updateVoiceButton()
    }
  }
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
const textArea     = document.getElementById('textArea')
const sentencesEl  = document.getElementById('sentences')
const placeholder  = document.getElementById('placeholder')
const fileSidebar  = document.getElementById('fileSidebar')
const fileListEl   = document.getElementById('fileList')
const btnFontMinus = document.getElementById('btnFontMinus')
const btnFontPlus  = document.getElementById('btnFontPlus')
const fontSizeValue= document.getElementById('fontSizeValue')
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
const voiceCredSection = document.getElementById('voiceCredSection')
const vpAppId          = document.getElementById('vpAppId')
const vpApiKey         = document.getElementById('vpApiKey')
const vpApiSecret      = document.getElementById('vpApiSecret')
const vpSave           = document.getElementById('vpSave')
const vpStatus         = document.getElementById('vpStatus')

// ── 初始化 ────────────────────────────────────────────────────────────────
async function init() {
  const cfg = await window.electronAPI.getConfig()
  engine.setCredentials(cfg.xunfei)
  speed = cfg.lastSpeed || 1.0
  speedSlider.value = speed
  speedValue.textContent = speed.toFixed(1) + 'x'
  engine.setSpeed(speed)
  fontSize = cfg.lastFontSize || 17
  applyFontSize()

  const sysVoices = window.speechSynthesis.getVoices()
  const sysCat = VOICE_CATEGORIES.find(c => c.id === 'system')
  sysCat.voices = sysVoices
    .filter(v => v.lang.startsWith('zh'))
    .map(v => ({ vcn: v.name, name: v.name.replace(/^Microsoft /, '').split(' ')[0] }))
  if (sysCat.voices.length === 0) sysCat.voices = [{ vcn: '__system_default__', name: '系统默认' }]

  currentVcn = cfg.lastVoice || 'zh-CN-XiaoxiaoNeural'
  const found = findVoice(currentVcn)
  if (found) {
    activeCategoryId = found.category.id
    engine.setVcn(currentVcn)
    engine.setMode(found.category.engine || 'system')
  }

  renderVoicePanel()
  updateVoiceButton()
  btnPlay.disabled = true
}

window.speechSynthesis.onvoiceschanged = init
init()

// ── 音色面板 ──────────────────────────────────────────────────────────────
function renderVoicePanel() {
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

  voiceCredSection.style.display = (cat?.engine === 'xunfei') ? 'block' : 'none'
}

function selectVoice(cat, voice) {
  currentVcn = voice.vcn
  engine.setVcn(voice.vcn)
  engine.setMode(cat.engine || 'system')
  updateVoiceButton()
  window.electronAPI.setConfig({ lastVoice: voice.vcn })
}

function updateVoiceButton() {
  const cat = VOICE_CATEGORIES.find(c => c.id === activeCategoryId)
  const voice = cat?.voices.find(v => v.vcn === currentVcn)
  btnVoice.textContent = voice ? `音色：${cat.label} · ${voice.name} ▾` : '音色 ▾'
}

async function openVoicePanel() {
  voicePanelOpen = true
  voicePanel.style.display = 'block'
  renderVoicePanel()
  const cfg = await window.electronAPI.getConfig()
  vpAppId.value     = cfg.xunfei.appId     || ''
  vpApiKey.value    = cfg.xunfei.apiKey    || ''
  vpApiSecret.value = cfg.xunfei.apiSecret || ''
  const hasConfig = cfg.xunfei.appId && cfg.xunfei.apiKey && cfg.xunfei.apiSecret
  vpStatus.textContent = hasConfig ? '● 已配置' : '○ 未配置'
  vpStatus.className = 'voice-cred-status ' + (hasConfig ? 'ok' : '')
}
function closeVoicePanel() { voicePanelOpen = false; voicePanel.style.display = 'none' }

btnVoice.addEventListener('click', (e) => {
  e.stopPropagation()
  voicePanelOpen ? closeVoicePanel() : openVoicePanel()
})
document.addEventListener('click', () => { if (voicePanelOpen) closeVoicePanel() })
voicePanel.addEventListener('click', e => e.stopPropagation())

vpSave.addEventListener('click', async () => {
  const cfg = { appId: vpAppId.value.trim(), apiKey: vpApiKey.value.trim(), apiSecret: vpApiSecret.value.trim() }
  await window.electronAPI.setConfig({ xunfei: cfg })
  engine.setCredentials(cfg)
  vpStatus.textContent = '○ 测试中...'
  vpStatus.className = 'voice-cred-status'
  const ok = await engine.testXunfei(cfg)
  vpStatus.textContent = ok ? '● 已连接' : '● 连接失败'
  vpStatus.className = 'voice-cred-status ' + (ok ? 'ok' : 'fail')
})

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

// ── 文本解析（保留段落结构） ───────────────────────────────────────────────
function parseDocumentText(text) {
  // 1. 规范化换行
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 2. 按空行切分段落（连续两个及以上换行 = 段落边界）
  const paraTexts = text.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0)
  // 3. 段落内按句末标点/换行切句
  const paragraphs = paraTexts.map(pt => ({
    text: pt,
    sentences: pt
      .split(/(?<=[。！？；…\n\.!?]+)/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }))
  // 4. 展平全局句
  const sentences = []
  for (const p of paragraphs) for (const s of p.sentences) sentences.push(s)
  return { paragraphs, sentences }
}

function estimateDuration(text, rate) {
  return (text.replace(/\s/g, '').length || 1) / (4.5 * rate)
}

function mergeSentences(list) {
  let out = ''
  for (const s of list) {
    if (out && /[.!?]$/.test(out)) out += ' '  // 英文标点后补空格
    out += s
  }
  return out
}

// 构建朗读块：每个块 = 一个段落（超长段落再按字符数拆分），块内句子合并一次合成
function buildBlocks(paragraphs, sentences) {
  const blocks = []
  const sentenceToBlock = new Array(sentences.length).fill(0)
  let gi = 0

  for (const p of paragraphs) {
    const startGi = gi
    const endGi = gi + p.sentences.length
    let curSents = []
    let curChars = 0
    const pushBlock = () => {
      if (curSents.length === 0) return
      const text = mergeSentences(curSents.map(i => sentences[i]))
      blocks.push({ text, sents: curSents.slice() })
      curSents = []
      curChars = 0
    }
    for (let i = startGi; i < endGi; i++) {
      const c = sentences[i].length
      if (curSents.length > 0 && curChars + c > MAX_BLOCK_CHARS) pushBlock()
      curSents.push(i)
      curChars += c
    }
    pushBlock()
    gi = endGi
  }

  blocks.forEach((b, bi) => { for (const gi of b.sents) sentenceToBlock[gi] = bi })
  return { blocks, sentenceToBlock }
}

function buildFile(name, text) {
  const parsed = parseDocumentText(text)
  const durations = parsed.sentences.map(s => estimateDuration(s, speed))
  const totalDuration = durations.reduce((a, b) => a + b, 0)
  const { blocks, sentenceToBlock } = buildBlocks(parsed.paragraphs, parsed.sentences)
  blocks.forEach(b => { b.duration = b.sents.reduce((a, i) => a + durations[i], 0) })
  return {
    id: nextFileId++, name, text,
    paragraphs: parsed.paragraphs,
    sentences: parsed.sentences,
    durations, totalDuration, blocks, sentenceToBlock,
  }
}

function getActiveFile() {
  return files.find(f => f.id === activeFileId) || null
}

// ── 渲染（段落结构） ───────────────────────────────────────────────────────
function renderDocument(file) {
  placeholder.style.display = 'none'
  sentencesEl.innerHTML = ''
  let gi = 0
  for (const p of file.paragraphs) {
    const paraDiv = document.createElement('div')
    paraDiv.className = 'para'
    for (const s of p.sentences) {
      const span = document.createElement('span')
      span.className = 'sentence'
      span.textContent = s + ' '
      span.dataset.index = gi
      const idx = gi  // 捕获当前句索引，避免闭包共享变量陷阱
      span.addEventListener('click', () => jumpToIndex(idx))
      paraDiv.appendChild(span)
      gi++
    }
    sentencesEl.appendChild(paraDiv)
  }
}

function highlightSentence(index) {
  document.querySelectorAll('.sentence').forEach(el => el.classList.remove('active'))
  const el = document.querySelector(`.sentence[data-index="${index}"]`)
  if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
}

// ── 播放引擎（块级） ───────────────────────────────────────────────────────
async function playBlocks(bi, firstBlockOverride) {
  const file = getActiveFile()
  if (!file) return
  if (bi >= file.blocks.length) { stopAll(); updateProgressUI(file.totalDuration); return }

  engine.cancel()
  const gen = ++speakGen
  const block = firstBlockOverride || file.blocks[bi]

  currentIndex = block.sents[0]
  isPlaying = true; isPaused = false
  setPlayIcon(true)
  currentSentenceStart = Date.now()
  startProgressTick()

  // 预取下一块（减少块间停顿）
  if (bi + 1 < file.blocks.length) engine.prefetch(file.blocks[bi + 1].text)

  startBlockHighlight(block)

  await engine.speak(block.text)

  if (gen !== speakGen) return
  stopBlockHighlight()
  if (isPlaying && !isPaused) {
    stopProgressTick()
    elapsedBeforeCurrent += block.duration
    playBlocks(bi + 1)
  }
}

function startBlockHighlight(block) {
  stopBlockHighlight()
  const file = getActiveFile()
  if (!file) return
  let lastIdx = -1
  const tick = () => {
    const elapsed = (Date.now() - currentSentenceStart) / 1000
    let acc = 0
    for (const gi of block.sents) {
      const d = file.durations[gi]
      if (elapsed < acc + d) {
        if (gi !== lastIdx) { highlightSentence(gi); lastIdx = gi; currentIndex = gi }
        return
      }
      acc += d
    }
    const last = block.sents[block.sents.length - 1]
    if (last !== lastIdx) { highlightSentence(last); lastIdx = last; currentIndex = last }
  }
  tick()
  blockHighlightTimer = setInterval(tick, 80)
}

function stopBlockHighlight() {
  if (blockHighlightTimer) { clearInterval(blockHighlightTimer); blockHighlightTimer = null }
}

function jumpToIndex(gi) {
  const file = getActiveFile()
  if (!file || file.sentences.length === 0) return
  gi = Math.max(0, Math.min(gi, file.sentences.length - 1))
  elapsedBeforeCurrent = file.durations.slice(0, gi).reduce((a, b) => a + b, 0)

  const bi = file.sentenceToBlock[gi]
  const block = file.blocks[bi]
  const pos = block.sents.indexOf(gi)
  if (pos === 0) {
    playBlocks(bi)
  } else {
    const restSents = block.sents.slice(pos)
    const head = {
      text: mergeSentences(restSents.map(i => file.sentences[i])),
      sents: restSents,
      duration: restSents.reduce((a, i) => a + file.durations[i], 0),
    }
    playBlocks(bi, head)
  }
}

function pauseResume() {
  const file = getActiveFile()
  if (!isPlaying && !isPaused) {
    if (file && file.sentences.length > 0) {
      if (currentIndex >= file.sentences.length) currentIndex = 0
      jumpToIndex(currentIndex)
    }
    return
  }
  if (isPlaying && !isPaused) {
    engine.pause()
    isPaused = true; isPlaying = false
    stopProgressTick(); stopBlockHighlight(); setPlayIcon(false)
  } else if (isPaused) {
    isPaused = false; isPlaying = true
    setPlayIcon(true)
    jumpToIndex(currentIndex)  // 从当前句恢复
  }
}

function stopAll() {
  engine.cancel()
  isPlaying = false; isPaused = false
  stopProgressTick(); stopBlockHighlight(); setPlayIcon(false)
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
  const file = getActiveFile()
  if (!file || file.totalDuration === 0) return
  const total = elapsedBeforeCurrent + (Date.now() - currentSentenceStart) / 1000
  updateProgressUI(Math.min(total, file.totalDuration))
}
function updateProgressUI(elapsed) {
  const file = getActiveFile()
  const pct = file && file.totalDuration > 0 ? (elapsed / file.totalDuration) * 100 : 0
  progressFill.style.width = pct + '%'
  progressThumb.style.left = pct + '%'
  currentTimeEl.textContent = formatTime(elapsed)
}

let isDragging = false
progressBar.addEventListener('mousedown', (e) => { isDragging = true; seekTo(e) })
document.addEventListener('mousemove', (e) => { if (isDragging) seekTo(e) })
document.addEventListener('mouseup', () => { isDragging = false })

function seekTo(e) {
  const file = getActiveFile()
  if (!file) return
  const rect = progressBar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const targetTime = pct * file.totalDuration
  let acc = 0, targetIndex = 0
  for (let i = 0; i < file.durations.length; i++) {
    if (acc + file.durations[i] > targetTime) { targetIndex = i; break }
    acc += file.durations[i]; targetIndex = i + 1
  }
  targetIndex = Math.min(targetIndex, file.sentences.length - 1)
  elapsedBeforeCurrent = file.durations.slice(0, targetIndex).reduce((a, b) => a + b, 0)
  updateProgressUI(targetTime)
  if (isPlaying || isPaused) jumpToIndex(targetIndex)
  else { currentIndex = targetIndex; highlightSentence(targetIndex) }
}

// ── 多文件管理 ────────────────────────────────────────────────────────────
function renderFileList() {
  fileListEl.innerHTML = ''
  for (const f of files) {
    const item = document.createElement('div')
    item.className = 'file-item' + (f.id === activeFileId ? ' active' : '')
    item.textContent = f.name
    item.title = f.name
    item.addEventListener('click', () => activateFile(f.id))
    fileListEl.appendChild(item)
  }
  fileSidebar.style.display = files.length > 0 ? 'flex' : 'none'
}

function activateFile(id) {
  stopAll()
  activeFileId = id
  const file = getActiveFile()
  if (!file) return
  fileNameEl.textContent = file.name
  fileNameEl.classList.add('loaded')
  renderDocument(file)
  currentIndex = 0
  elapsedBeforeCurrent = 0
  totalTimeEl.textContent = formatTime(file.totalDuration)
  updateProgressUI(0)
  setPlayIcon(false)
  isPlaying = false; isPaused = false
  btnPlay.disabled = false
  renderFileList()
}

async function addFiles(results) {
  for (const r of results) {
    if (r.error) { showNotification(`解析失败 ${r.fileName}: ${r.error}`); continue }
    if (r.needsOCR) {
      const text = await runOCR(r.buffer, r.fileName)
      if (text !== null) files.push(buildFile(r.fileName, text))
    } else {
      files.push(buildFile(r.fileName, r.text))
    }
  }
  renderFileList()
  if (files.length > 0 && !activeFileId) {
    activateFile(files[0].id)
  }
}

// ── 控制按钮 ──────────────────────────────────────────────────────────────
btnOpen.addEventListener('click', async () => {
  const results = await window.electronAPI.openFile()
  if (!results || results.length === 0) return
  await addFiles(results)
})

btnPlay.addEventListener('click', pauseResume)
btnPrev.addEventListener('click', () => jumpToIndex(Math.max(0, currentIndex - 1)))
btnNext.addEventListener('click', () => {
  const file = getActiveFile()
  if (file) jumpToIndex(Math.min(file.sentences.length - 1, currentIndex + 1))
})
btnRestart.addEventListener('click', () => jumpToIndex(0))
btnEnd.addEventListener('click', () => {
  const file = getActiveFile()
  if (!file) return
  stopAll()
  updateProgressUI(file.totalDuration)
  currentIndex = file.sentences.length - 1
  highlightSentence(currentIndex)
})

speedSlider.addEventListener('input', () => {
  speed = parseFloat(speedSlider.value)
  speedValue.textContent = speed.toFixed(1) + 'x'
  engine.setSpeed(speed)
  const file = getActiveFile()
  if (file) {
    file.durations = file.sentences.map(s => estimateDuration(s, speed))
    file.totalDuration = file.durations.reduce((a, b) => a + b, 0)
    const { blocks, sentenceToBlock } = buildBlocks(file.paragraphs, file.sentences)
    file.blocks = blocks
    file.sentenceToBlock = sentenceToBlock
    blocks.forEach(b => { b.duration = b.sents.reduce((a, i) => a + file.durations[i], 0) })
    elapsedBeforeCurrent = file.durations.slice(0, currentIndex).reduce((a, b) => a + b, 0)
    totalTimeEl.textContent = formatTime(file.totalDuration)
  }
  if (isPlaying || isPaused) jumpToIndex(currentIndex)
  window.electronAPI.setConfig({ lastSpeed: speed })
})

// ── OCR ───────────────────────────────────────────────────────────────────
async function runOCR(bufferArray, fileName) {
  showStatus(`正在识别扫描版 PDF：${fileName} ...`)
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
    return fullText
  } catch (err) {
    showNotification('OCR 识别失败：' + err.message)
    return null
  } finally {
    hideStatus()
  }
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
  notifTimer = setTimeout(() => notificationBar.classList.remove('show'), 4000)
}

// ── 工具函数 ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
function setPlayIcon(playing) { btnPlay.textContent = playing ? '⏸' : '▶' }

// ── 字体大小 ──────────────────────────────────────────────────────────────
function applyFontSize() {
  textArea.style.fontSize = fontSize + 'px'
  fontSizeValue.textContent = fontSize === DEFAULT_FONT_SIZE ? '默认' : fontSize
  window.electronAPI.setConfig({ lastFontSize: fontSize })
}

btnFontMinus.addEventListener('click', () => {
  fontSize = Math.max(MIN_FONT_SIZE, fontSize - 1)
  applyFontSize()
})
btnFontPlus.addEventListener('click', () => {
  fontSize = Math.min(MAX_FONT_SIZE, fontSize + 1)
  applyFontSize()
})
fontSizeValue.addEventListener('click', () => {
  fontSize = DEFAULT_FONT_SIZE
  applyFontSize()
})

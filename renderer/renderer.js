// ── 状态 ──────────────────────────────────────────────────────────────────
let sentences = []        // 句子文本数组
let durations = []        // 每句预估时长（秒）
let totalDuration = 0     // 总时长（秒）
let currentIndex = 0      // 当前朗读句子索引
let isPlaying = false
let isPaused = false
let speed = 1.0
let progressInterval = null
let currentSentenceStart = 0   // 当前句开始朗读的时间戳
let elapsedBeforeCurrent = 0   // 当前句之前所有句子累计时长
let currentUtterance = null    // 持有引用防止 GC
let voices = []                // 可用语音列表

// 等待语音列表加载
function loadVoices() {
  voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      voices = window.speechSynthesis.getVoices()
    }
  }
}
loadVoices()

// ── DOM ──────────────────────────────────────────────────────────────────
const btnOpen     = document.getElementById('btnOpen')
const btnPlay     = document.getElementById('btnPlay')
const btnPrev     = document.getElementById('btnPrev')
const btnNext     = document.getElementById('btnNext')
const btnRestart  = document.getElementById('btnRestart')
const btnEnd      = document.getElementById('btnEnd')
const speedSlider = document.getElementById('speedSlider')
const speedValue  = document.getElementById('speedValue')
const progressBar = document.getElementById('progressBar')
const progressFill= document.getElementById('progressFill')
const progressThumb=document.getElementById('progressThumb')
const currentTimeEl=document.getElementById('currentTime')
const totalTimeEl = document.getElementById('totalTime')
const fileNameEl  = document.getElementById('fileName')
const sentencesEl = document.getElementById('sentences')
const placeholder = document.getElementById('placeholder')

// ── 文本切分 ──────────────────────────────────────────────────────────────
function splitSentences(text) {
  // 按中文/英文句子结束符切分，保留标点
  const raw = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/(?<=[。！？…\n\.!?]+)/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
  return raw
}

// 按中文约 4.5 字/秒预估时长（考虑语速）
function estimateDuration(text, rate) {
  const charCount = text.replace(/\s/g, '').length || 1
  return charCount / (4.5 * rate)
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
  isPaused = false
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
  if (el) {
    el.classList.add('active')
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// ── TTS 引擎 ──────────────────────────────────────────────────────────────
function speak(index) {
  if (index >= sentences.length) {
    // 朗读完毕
    stopAll()
    updateProgressUI(totalDuration)
    return
  }

  window.speechSynthesis.cancel()
  currentIndex = index
  highlightSentence(index)

  // cancel() 后需短暂等待，否则 speak() 在某些 Electron 版本中静默失败
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(sentences[index])
    utterance.lang = 'zh-CN'
    utterance.rate = speed

    // 优先选中文语音
    if (voices.length > 0) {
      const zhVoice = voices.find(v => v.lang.startsWith('zh-CN'))
        || voices.find(v => v.lang.startsWith('zh'))
        || voices[0]
      utterance.voice = zhVoice
    }

    utterance.onstart = () => {
      currentSentenceStart = Date.now()
      isPlaying = true
      isPaused = false
      setPlayIcon(true)
      startProgressTick()
    }

    utterance.onend = () => {
      stopProgressTick()
      elapsedBeforeCurrent += durations[index]
      speak(index + 1)
    }

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.error('TTS error:', e.error)
      }
    }

    currentUtterance = utterance  // 防止被 GC
    window.speechSynthesis.speak(utterance)
  }, 100)
}

function pauseResume() {
  if (!isPlaying && !isPaused) {
    // 还没开始 → 开始
    speak(currentIndex)
    return
  }

  if (isPlaying && !isPaused) {
    window.speechSynthesis.pause()
    isPaused = true
    isPlaying = false
    stopProgressTick()
    setPlayIcon(false)
  } else if (isPaused) {
    window.speechSynthesis.resume()
    isPaused = false
    isPlaying = true
    // 修正计时起点：恢复后重新从当前句估算已过时间
    const elapsed = elapsedBeforeCurrent + (Date.now() - currentSentenceStart) / 1000
    currentSentenceStart = Date.now() - ((elapsed - elapsedBeforeCurrent) * 1000)
    startProgressTick()
    setPlayIcon(true)
  }
}

function stopAll() {
  window.speechSynthesis.cancel()
  isPlaying = false
  isPaused = false
  stopProgressTick()
  setPlayIcon(false)
}

function jumpToIndex(index) {
  stopProgressTick()
  // 计算该句之前的累计时长
  elapsedBeforeCurrent = durations.slice(0, index).reduce((a, b) => a + b, 0)
  speak(index)
}

// ── 进度条 ────────────────────────────────────────────────────────────────
function startProgressTick() {
  stopProgressTick()
  progressInterval = setInterval(tickProgress, 100)
}

function stopProgressTick() {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
}

function tickProgress() {
  if (totalDuration === 0) return
  const sentenceElapsed = (Date.now() - currentSentenceStart) / 1000
  const total = elapsedBeforeCurrent + sentenceElapsed
  updateProgressUI(Math.min(total, totalDuration))
}

function updateProgressUI(elapsed) {
  const pct = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0
  progressFill.style.width = pct + '%'
  progressThumb.style.left = pct + '%'
  currentTimeEl.textContent = formatTime(elapsed)
}

// 拖动进度条
let isDragging = false

progressBar.addEventListener('mousedown', (e) => {
  isDragging = true
  seekTo(e)
})

document.addEventListener('mousemove', (e) => {
  if (isDragging) seekTo(e)
})

document.addEventListener('mouseup', () => {
  isDragging = false
})

function seekTo(e) {
  const rect = progressBar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const targetTime = pct * totalDuration

  // 找到对应句子
  let acc = 0
  let targetIndex = 0
  for (let i = 0; i < durations.length; i++) {
    if (acc + durations[i] > targetTime) {
      targetIndex = i
      break
    }
    acc += durations[i]
    targetIndex = i + 1
  }
  targetIndex = Math.min(targetIndex, sentences.length - 1)

  elapsedBeforeCurrent = durations.slice(0, targetIndex).reduce((a, b) => a + b, 0)
  updateProgressUI(targetTime)

  if (isPlaying || isPaused) {
    speak(targetIndex)
  } else {
    currentIndex = targetIndex
    highlightSentence(targetIndex)
  }
}

// ── 控制按钮事件 ──────────────────────────────────────────────────────────
btnOpen.addEventListener('click', async () => {
  const result = await window.electronAPI.openFile()
  if (!result) return
  if (result.error) {
    alert('文件解析失败：' + result.error)
    return
  }
  fileNameEl.textContent = result.fileName
  fileNameEl.classList.add('loaded')

  if (result.needsOCR) {
    await handleOCR(result.buffer, result.fileName)
  } else {
    loadText(result.text)
  }
})

btnPlay.addEventListener('click', pauseResume)

btnPrev.addEventListener('click', () => {
  const target = Math.max(0, currentIndex - 1)
  jumpToIndex(target)
})

btnNext.addEventListener('click', () => {
  const target = Math.min(sentences.length - 1, currentIndex + 1)
  jumpToIndex(target)
})

btnRestart.addEventListener('click', () => {
  jumpToIndex(0)
})

btnEnd.addEventListener('click', () => {
  stopAll()
  updateProgressUI(totalDuration)
  currentIndex = sentences.length - 1
  highlightSentence(currentIndex)
})

speedSlider.addEventListener('input', () => {
  speed = parseFloat(speedSlider.value)
  speedValue.textContent = speed.toFixed(1) + 'x'

  if (sentences.length > 0) {
    const wasIndex = currentIndex
    recalcDurations()
    elapsedBeforeCurrent = durations.slice(0, wasIndex).reduce((a, b) => a + b, 0)
  }

  // 重启当前句以应用新语速
  if (isPlaying || isPaused) {
    speak(currentIndex)
  }
})

// ── OCR（扫描版 PDF）──────────────────────────────────────────────────────
async function handleOCR(bufferArray, fileName) {
  showStatus('正在识别扫描版 PDF，请稍候...')
  btnPlay.disabled = true

  try {
    const pdfjsLib = await import('../node_modules/pdfjs-dist/build/pdf.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'

    const uint8 = new Uint8Array(bufferArray)
    const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise
    const totalPages = pdf.numPages

    const worker = await Tesseract.createWorker('chi_sim', 1, {
      workerPath: '../node_modules/tesseract.js/dist/worker.min.js',
      corePath: '../node_modules/tesseract.js-core/',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    })

    let fullText = ''
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      showStatus(`OCR 识别中：第 ${pageNum} / ${totalPages} 页...`)

      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: 2.0 })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise

      const { data: { text } } = await worker.recognize(canvas)
      fullText += text + '\n'
    }

    await worker.terminate()
    hideStatus()
    loadText(fullText)
  } catch (err) {
    hideStatus()
    alert('OCR 识别失败：' + err.message)
  }
}

function showStatus(msg) {
  let el = document.getElementById('statusMsg')
  if (!el) {
    el = document.createElement('div')
    el.id = 'statusMsg'
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#313145;color:#cdd6f4;padding:20px 32px;border-radius:12px;font-size:15px;z-index:999;box-shadow:0 4px 24px rgba(0,0,0,0.4)'
    document.body.appendChild(el)
  }
  el.textContent = msg
}

function hideStatus() {
  const el = document.getElementById('statusMsg')
  if (el) el.remove()
}

// ── 工具函数 ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function setPlayIcon(playing) {
  btnPlay.textContent = playing ? '⏸' : '▶'
}

// 初始禁用控制按钮
btnPlay.disabled = true

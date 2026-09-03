const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)
const { encodeWav, pcmToM4a, mp3ToPcm24k, TARGET_RATE } = require('./lib/audio-encode')
const { synthesizeSystemPcm } = require('./lib/system-tts')

const EDGE_PLAYBACK_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
const EDGE_EXPORT_PCM_FORMAT = 'raw-24khz-16bit-mono-pcm'

function escapeSsml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function edgeSynthesize({ text, voice, rate, format }) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')
  const outputFormat = format === 'pcm'
    ? (OUTPUT_FORMAT.RAW_24KHZ_16BIT_MONO_PCM || EDGE_EXPORT_PCM_FORMAT)
    : (OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3 || EDGE_PLAYBACK_FORMAT)

  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, outputFormat)

  const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${escapeSsml(voice)}'><prosody rate='${rateStr}'>${escapeSsml(text)}</prosody></voice></speak>`

  const { audioStream } = tts._rawSSMLRequest(ssml)
  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on('data', d => chunks.push(d))
    audioStream.on('end', resolve)
    audioStream.on('error', reject)
  })
  tts.close()
  return Buffer.concat(chunks)
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function readConfig() {
  const p = getConfigPath()
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return {} }
}

function writeConfig(data) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,  // 允许 file:// 加载本地 WASM/Worker
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e2e',
  })

  win.loadFile('renderer/index.html')
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── 文件解析 ────────────────────────────────────────────────────────────────
// 通过文件头判断真实格式（扩展名可能被改名，例如 .wps 实为 docx）
function detectFormat(buf) {
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'ole2' // .doc / 老 .wps
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'zip'  // .docx / 新 .wps
  return 'plain'
}

async function parseDocx(filePath) {
  const mammoth = require('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

// textutil 转纯文本（macOS 自带，支持 .doc，保留段落空行结构）
async function parseViaTextutil(filePath) {
  const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath])
  return stdout
}

async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  let text = ''

  if (ext === '.txt') {
    text = fs.readFileSync(filePath, 'utf-8')
  } else if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath)
    const pdfParse = require('pdf-parse')
    const data = await pdfParse(buffer)
    text = data.text.trim()
    // 文字太少说明是扫描版图片 PDF，交给渲染进程做 OCR
    if (text.length < 100) {
      return { fileName, needsOCR: true, buffer: Array.from(buffer) }
    }
  } else if (ext === '.docx' || ext === '.doc' || ext === '.wps') {
    const buffer = fs.readFileSync(filePath)
    const fmt = detectFormat(buffer)
    if (ext === '.docx' || fmt === 'zip') {
      // 真 .docx，或被改名成 .doc/.wps 的 docx（zip 容器）→ mammoth
      text = await parseDocx(filePath)
    } else if (fmt === 'ole2') {
      // 真 .doc 或老版 .wps（OLE2 二进制）→ textutil
      if (ext === '.wps') {
        // textutil 不识别 .wps 扩展名，拷贝为临时 .doc 再转
        const tmp = path.join(app.getPath('temp'), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.doc`)
        fs.copyFileSync(filePath, tmp)
        try { text = await parseViaTextutil(tmp) }
        finally { try { fs.unlinkSync(tmp) } catch {} }
      } else {
        text = await parseViaTextutil(filePath)
      }
    } else {
      throw new Error('无法识别的文档内容（既不是 Word 也不是 WPS）')
    }
  } else {
    throw new Error('不支持的格式：' + (ext || '未知'))
  }

  return { fileName, text: (text || '').trim() }
}

// 打开文件对话框（支持多选）
ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [
      { name: '所有支持的文档', extensions: ['txt', 'pdf', 'doc', 'docx', 'wps'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: 'PDF 文件', extensions: ['pdf'] },
      { name: 'Word / WPS 文档', extensions: ['doc', 'docx', 'wps'] },
    ],
    properties: ['openFile', 'multiSelections'],
  })
  if (canceled || filePaths.length === 0) return null

  const results = []
  for (const filePath of filePaths) {
    try {
      results.push(await parseFile(filePath))
    } catch (err) {
      results.push({ fileName: path.basename(filePath), error: err.message })
    }
  }
  return results
})

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
    lastVoice: cfg.lastVoice || '',
    lastSpeed: cfg.lastSpeed || 1.0,
    lastFontSize: cfg.lastFontSize || 17,
    enableEdgeExperimental: !!cfg.enableEdgeExperimental,
  }
})

ipcMain.handle('get-app-info', () => ({
  version: app.getVersion(),
  name: '朗读器',
  lastFreeVersion: '3.1.0',
}))

ipcMain.handle('open-privacy', () => {
  const privacyWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 400,
    minHeight: 400,
    title: '隐私说明',
    backgroundColor: '#1e1e2e',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  privacyWin.loadFile(path.join(__dirname, 'docs', 'privacy.html'))
  return { ok: true }
})

ipcMain.handle('edge-tts', async (_, { text, voice, rate, format }) => {
  const wantPcm = format === 'pcm'
  if (wantPcm) {
    try {
      const buf = await edgeSynthesize({ text, voice, rate, format: 'pcm' })
      if (buf.length > 44) return { audio: buf.toString('base64'), format: 'pcm' }
    } catch (err) {
      console.warn('Edge PCM 不可用，回退播放同款 MP3:', err.message)
    }
  }
  const buf = await edgeSynthesize({ text, voice, rate, format: 'mp3' })
  return { audio: buf.toString('base64'), format: 'mp3' }
})

ipcMain.handle('system-tts', async (_, { text, voice, speed }) => {
  const pcm = await synthesizeSystemPcm(text, voice, speed)
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
})

ipcMain.handle('decode-mp3', async (_, b64) => {
  const pcm = await mp3ToPcm24k(Buffer.from(b64, 'base64'))
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
})

ipcMain.handle('choose-export-path', async (event, { defaultName, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const filters = format === 'm4a'
    ? [{ name: 'M4A 音频', extensions: ['m4a'] }]
    : format === 'both'
      ? [{ name: 'WAV / M4A', extensions: ['wav', 'm4a'] }]
      : [{ name: 'WAV 音频', extensions: ['wav'] }]
  const { canceled, filePath } = await dialog.showSaveDialog(win || undefined, {
    title: '导出音频',
    defaultPath: defaultName,
    filters,
  })
  if (canceled || !filePath) return null
  return filePath
})

ipcMain.handle('save-export', async (_, { destPath, formats, pcm, m4a }) => {
  const pcmBuf = Buffer.from(ArrayBuffer.isView(pcm)
    ? Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    : pcm)
  const samples = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, Math.floor(pcmBuf.length / 2))
  const base = destPath.replace(/\.(wav|m4a)$/i, '')
  const written = {}
  if (formats.includes('wav')) {
    const wavPath = base + '.wav'
    fs.writeFileSync(wavPath, encodeWav(samples, TARGET_RATE))
    written.wav = wavPath
  }
  if (formats.includes('m4a')) {
    const m4aPath = base + '.m4a'
    const m4aBytes = m4a
      ? (ArrayBuffer.isView(m4a) ? Buffer.from(m4a.buffer, m4a.byteOffset, m4a.byteLength) : Buffer.from(m4a))
      : null
    const bytes = (m4aBytes && m4aBytes.length > 32) ? m4aBytes : await pcmToM4a(samples, TARGET_RATE)
    fs.writeFileSync(m4aPath, bytes)
    written.m4a = m4aPath
  }
  return { ok: true, written }
})

ipcMain.handle('set-config', (_, patch) => {
  if (patch.xunfei && !safeStorage.isEncryptionAvailable()) return { error: 'encryption_unavailable' }
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
  if (patch.lastFontSize !== undefined) cfg.lastFontSize = patch.lastFontSize
  if (patch.enableEdgeExperimental !== undefined) cfg.enableEdgeExperimental = !!patch.enableEdgeExperimental
  writeConfig(cfg)
  return { ok: true }
})

const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

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
    lastVoice: cfg.lastVoice || 'zh-CN-XiaoxiaoNeural',
    lastSpeed: cfg.lastSpeed || 1.0,
    lastFontSize: cfg.lastFontSize || 17,
  }
})

ipcMain.handle('edge-tts', async (_, { text, voice, rate }) => {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')

  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  // rate is a percentage offset: 0 = normal, +50 = 1.5x, -50 = 0.5x
  const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'><prosody rate='${rateStr}'>${text}</prosody></voice></speak>`

  const { audioStream } = tts._rawSSMLRequest(ssml)
  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on('data', d => chunks.push(d))
    audioStream.on('end', resolve)
    audioStream.on('error', reject)
  })
  tts.close()
  return Buffer.concat(chunks).toString('base64')
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
  writeConfig(cfg)
  return { ok: true }
})

const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

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
    width: 900,
    height: 700,
    minWidth: 700,
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

// 打开文件对话框
ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [
      { name: '支持的文档', extensions: ['txt', 'pdf', 'docx'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: 'PDF 文件', extensions: ['pdf'] },
      { name: 'Word 文档', extensions: ['docx'] },
    ],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null

  const filePath = filePaths[0]
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)

  try {
    let text = ''

    if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf-8')
    } else if (ext === '.docx') {
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      text = result.value
    } else if (ext === '.pdf') {
      const pdfParse = require('pdf-parse')
      const buffer = fs.readFileSync(filePath)
      const data = await pdfParse(buffer)
      text = data.text.trim()
      // 文字太少说明是扫描版图片 PDF，交给渲染进程做 OCR
      if (text.length < 100) {
        return { fileName, needsOCR: true, buffer: Array.from(buffer) }
      }
    }

    return { fileName, text: text.trim() }
  } catch (err) {
    return { error: err.message }
  }
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
    lastVoice: cfg.lastVoice || 'xiaoyan',
    lastSpeed: cfg.lastSpeed || 1.0,
  }
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
  writeConfig(cfg)
  return { ok: true }
})

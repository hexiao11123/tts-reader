# 朗读器 v2.0 语音升级设计文档

**日期：** 2026-03-24
**项目：** tts-reader
**版本：** 1.0 → 2.0

---

## 一、需求概述

在现有朗读器基础上升级语音功能：

1. **接入讯飞 TTS**：用高质量神经语音替代系统 TTS，朗读更自然
2. **保留系统语音**：作为兜底，配额耗尽或无网络时自动切换
3. **两级音色选择**：先选风格分类，再选具体音色
4. **讯飞账号自助管理**：用户在讯飞开放平台自行注册、充值，在 app 内填入凭证
5. **界面全中文化**：所有 UI 文案换成中文

---

## 二、整体架构

```
Electron 主进程
  - 文件解析（Word / PDF / TXT + OCR）
  - 讯飞凭证读写（通过 safeStorage 加密，存于 userData/config.json）
  - IPC 通道：get-config / set-config

渲染进程
  ├── TTS 引擎管理器（统一接口）
  │     ├── 讯飞引擎（WebSocket + Web Audio API）
  │     └── 系统引擎（Web Speech API，原有逻辑）
  ├── 播放器 UI（底部控制栏扩展版）
  └── 设置面板
```

### 引擎管理器接口

```js
// 异步，返回 Promise<void>，resolve 于本句朗读结束
engineManager.speak(text, voiceConfig)

// 暂停：讯飞引擎关闭 WebSocket（下次 resume 从当前句开头重播）
// 系统引擎调用 speechSynthesis.pause()
engineManager.pause()

// 继续：讯飞引擎重新 speak 当前句；系统引擎调用 speechSynthesis.resume()
engineManager.resume()

// 取消：关闭 WebSocket / speechSynthesis.cancel()
engineManager.cancel()
```

**speak() 行为约定：** 若上一句仍在播放，先调用 `cancel()` 再开始新句。speak() 是 async 的，上层 Player 用 await 串行触发下一句。

---

## 三、讯飞 WebSocket 引擎

### 3.1 API 端点

使用讯飞标准 WebSocket TTS：`wss://tts-api.xfyun.cn/v2/tts`

**仅使用该端点的标准音色**（不混用 x4_ 前缀的 Spark 端点音色）。

### 3.2 鉴权 — WebSocket URL 构造

```js
function buildAuthUrl(apiKey, apiSecret) {
  const host = 'tts-api.xfyun.cn'
  const path = '/v2/tts'
  const date = new Date().toUTCString()                       // RFC1123 格式
  const signStr = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
  const signature = CryptoJS.HmacSHA256(signStr, apiSecret)  // HMAC-SHA256
  const sigBase64 = CryptoJS.enc.Base64.stringify(signature)
  const authStr = `api_key="${apiKey}", algorithm="hmac-sha256", ` +
                  `headers="host date request-line", signature="${sigBase64}"`
  const authBase64 = btoa(authStr)
  return `wss://${host}${path}?authorization=${authBase64}` +
         `&date=${encodeURIComponent(date)}&host=${host}`
}
```

依赖：渲染进程通过 `<script>` 加载 `crypto-js` 库（npm install crypto-js）。

### 3.3 逐句朗读流程

```
1. buildAuthUrl(apiKey, apiSecret) → wsUrl
2. ws = new WebSocket(wsUrl)
3. ws.onopen → 发送合成请求帧（JSON）
4. ws.onmessage → 解析帧：
     - code !== 0 → 触发回退，关闭连接
     - data.audio → Base64 解码 → PCM 数据追加到 audioChunks[]
     - data.status === 2 → 合成结束，关闭连接，播放全部音频
5. ws.onerror / ws.onclose（未收到 status=2 前）→ 触发回退
```

### 3.4 PCM 音频格式与播放

讯飞返回：**16000 Hz、16-bit、单声道 PCM**（小端序）。

```js
async function playPCMChunks(chunks, appId) {
  // 合并所有 chunk 为一个 Int16Array
  const totalLen = chunks.reduce((s, c) => s + c.length, 0)
  const pcm = new Int16Array(totalLen)
  let offset = 0
  for (const c of chunks) { pcm.set(c, offset); offset += c.length }

  // 转为 Float32（Web Audio 要求）
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
```

**策略：收到全部帧后统一播放**（等待 status=2 后一次性构建 AudioBuffer），保证无间隙、无音调错误。平均延迟约 300–600ms，可接受。

### 3.5 语速映射

UI 滑块 0.5x–2.0x 线性映射到讯飞 speed 0–100：

```
speed = Math.round((uiRate - 0.5) / 1.5 * 100)
```

### 3.6 暂停 / 继续

讯飞引擎无原生暂停，行为如下：
- **暂停**：关闭当前 WebSocket，记录 `pausedIndex`（当前句索引）
- **继续**：重新 speak(sentences[pausedIndex])，从句首重播

此行为已知限制：继续时当前句从头播放，不从暂停点续播。

### 3.7 回退机制

以下情况触发回退（切换至系统引擎继续当前句）：

- `ws.onerror` 事件
- `ws.onclose`（在收到 `status=2` 之前）
- 响应帧 `code !== 0`（讯飞 API 错误码非零）
- WebSocket 连接超时（5 秒内未触发 `onopen`）

回退后顶部显示提示条：「讯飞连接失败，已切换系统语音」，3 秒后自动消失。

---

## 四、音色体系

### 4.1 预设分类（全部使用 tts-api.xfyun.cn/v2/tts 标准端点）

| 分类 | vcn 代码 | 显示名称 |
|------|---------|---------|
| 温柔女声 | xiaoyan / aisjiuxu / aisxping / aisjinger | 晓燕 / 晓萌 / 晓萍 / 晶晶 |
| 磁性男声 | aisbabyxu / x2_mingming / x2_xiaofeng | 小炫 / 明明 / 小峰 |
| 新闻播报 | aisjingjing / x2_vixf | 晶晶 / 讯飞助手 |
| 儿童声 | x2_xiaomei / x2_xiaobei | 小美 / 小贝 |
| 系统语音 | （Web Speech API）| 列出系统已安装的中文语音 |

### 4.2 两级选择交互

点击底部「音色」按钮 → 面板向上弹出：
- **第一级**：分类标签横排
- **第二级**：选中分类下的音色按钮，点击立即生效并收起面板
- 选择「系统语音」分类即切换至系统引擎（**无独立引擎切换按钮**）

---

## 五、UI 设计

### 5.1 底部控制栏

```
┌────────────────────────────────────────────────────────┐
│  音色: [温柔女声·晓燕 ▾]   ⚙                           │
│  ⏮  ◀◀  ▶/⏸  ▶▶  ⏭                                   │
│  ━━━━━━●━━━━━━━━━  00:23 / 02:15   语速 [━●━] 1.0x      │
└────────────────────────────────────────────────────────┘
```

- **不设独立引擎切换按钮**，引擎跟随音色分类：选讯飞音色 = 用讯飞，选系统语音 = 用系统
- ⚙ 按钮打开设置面板

### 5.2 设置面板

右上角 ⚙ 打开，覆盖层展示：

```
┌──────────────────────────────────────┐
│  讯飞语音设置                         │
│  AppID:     [__________________]     │
│  APIKey:    [__________________]     │
│  APISecret: [__________________]     │
│  [去讯飞开放平台注册 ↗]   [保存]      │
│  状态：● 已连接 / ○ 未配置 / ○ 失败  │
└──────────────────────────────────────┘
```

**保存后凭证测试流程：**
1. 用新凭证构造 WebSocket URL，发起连接
2. 发送单字合成请求（`text: "测"`）
3. 收到非零 code 或 5 秒超时 → 状态显示「● 失败」
4. 收到 `status=2` → 状态显示「● 已连接」，关闭测试连接

### 5.3 中文化清单

| 原文 | 替换为 |
|------|--------|
| Open File | 打开文件 |
| No file opened | 未打开文件 |
| ⏮ title="Go to start" | 回到开头 |
| ◀◀ title="Prev" | 上一句 |
| ▶ / ⏸ | 播放 / 暂停 |
| ▶▶ title="Next" | 下一句 |
| ⏭ title="Go to end" | 跳到结尾 |
| Speed | 语速 |
| Settings | 设置 |
| Save | 保存 |
| OCR running... | 正在识别扫描版 PDF，请稍候… |
| OCR page X/Y | OCR 识别中：第 X / Y 页… |
| Parse failed | 文件解析失败 |
| OCR failed | OCR 识别失败 |
| iFlytek fallback notice | 讯飞连接失败，已切换系统语音 |

---

## 六、凭证存储

使用 Electron `safeStorage` API 加密存储（OS 级密钥链）：

```js
// 主进程写入
const encrypted = safeStorage.encryptString(value)
fs.writeFileSync(configPath, JSON.stringify({ appId: encrypted.toString('base64'), ... }))

// 读取时解密
const raw = Buffer.from(stored, 'base64')
const plain = safeStorage.decryptString(raw)
```

`userData/config.json` 完整结构：

```json
{
  "xunfei": {
    "appId": "<encrypted-base64>",
    "apiKey": "<encrypted-base64>",
    "apiSecret": "<encrypted-base64>"
  },
  "lastVoice": "xiaoyan",
  "lastSpeed": 1.0
}
```

---

## 七、文件变更范围

| 文件 | 变更内容 |
|------|---------|
| `main.js` | 新增 `get-config` / `set-config` IPC，safeStorage 读写 |
| `preload.js` | 暴露 `getConfig` / `setConfig` |
| `renderer/index.html` | 新增音色面板、设置面板 HTML 结构；加载 crypto-js |
| `renderer/renderer.js` | 新增讯飞引擎、引擎管理器、音色面板、设置面板逻辑 |
| `renderer/style.css` | 新增音色面板、设置面板、提示条样式 |
| `package.json` | 新增依赖：`crypto-js` |

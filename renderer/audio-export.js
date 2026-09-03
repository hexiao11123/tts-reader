const TARGET_RATE = 24000

export function concatInt16(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Int16Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export function resampleInt16(src, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return src
  const ratio = toRate / fromRate
  const outLen = Math.max(1, Math.round(src.length * ratio))
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio
    const i0 = Math.min(Math.floor(pos), src.length - 1)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const frac = pos - i0
    out[i] = Math.round(src[i0] * (1 - frac) + src[i1] * frac)
  }
  return out
}

function floatToInt16(ch, srcRate, toRate = TARGET_RATE) {
  const outLen = Math.max(1, Math.round(ch.length * toRate / srcRate))
  const pcm = new Int16Array(outLen)
  const ratio = srcRate / toRate
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.min(Math.floor(src), ch.length - 1)
    const i1 = Math.min(i0 + 1, ch.length - 1)
    const frac = src - i0
    const f = ch[i0] * (1 - frac) + ch[i1] * frac
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f * 32767)))
  }
  return pcm
}

export function pcmFromBase64(b64) {
  const bytes = atob(b64)
  const buf = new ArrayBuffer(bytes.length)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return { buffer: buf, bytes: arr }
}

export function pcmFromMaybeWav(arrayBuffer) {
  const arr = new Uint8Array(arrayBuffer)
  const view = new DataView(arrayBuffer)
  const tag = (start) => String.fromCharCode(arr[start], arr[start + 1], arr[start + 2], arr[start + 3])
  if (arr.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    let offset = 12
    while (offset + 8 <= arr.length) {
      const id = tag(offset)
      const size = view.getUint32(offset + 4, true)
      if (id === 'data') {
        const start = offset + 8
        const even = size & ~1
        return new Int16Array(arrayBuffer, start, even / 2)
      }
      offset += 8 + size + (size % 2)
    }
  }
  const even = arr.byteLength & ~1
  return new Int16Array(arrayBuffer, 0, even / 2)
}

export async function decodeToPcm24k(arrayBuffer) {
  const ctx = new AudioContext()
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuffer.slice(0))
    return floatToInt16(audioBuf.getChannelData(0), audioBuf.sampleRate, TARGET_RATE)
  } finally {
    await ctx.close()
  }
}

export async function encodeM4aViaMediaRecorder(pcmInt16, sampleRate = TARGET_RATE) {
  const mimeCandidates = [
    'audio/mp4;codecs="mp4a.40.2"',
    'audio/mp4',
    'audio/aac',
  ]
  const mime = mimeCandidates.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
  if (!mime) throw new Error('当前环境不支持 AAC 编码')

  const ctx = new AudioContext({ sampleRate })
  try {
    const buffer = ctx.createBuffer(1, Math.max(1, pcmInt16.length), sampleRate)
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < pcmInt16.length; i++) ch[i] = pcmInt16[i] / 32768

    const dest = ctx.createMediaStreamDestination()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(dest)

    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 48000 })
    const chunks = []
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
    const stopped = new Promise((resolve, reject) => {
      rec.onstop = resolve
      rec.onerror = () => reject(new Error('MediaRecorder 编码失败'))
    })
    rec.start(100)
    await new Promise((resolve, reject) => {
      src.onended = resolve
      src.onerror = reject
      src.start()
    })
    await new Promise(r => setTimeout(r, 80))
    rec.stop()
    await stopped
    const blob = new Blob(chunks, { type: mime.includes('mp4') ? 'audio/mp4' : 'audio/aac' })
    if (blob.size < 32) throw new Error('AAC 编码结果为空')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    await ctx.close()
  }
}

export { TARGET_RATE }

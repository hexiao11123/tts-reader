'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

const TARGET_RATE = 24000

function resampleInt16(input, fromRate, toRate) {
  if (fromRate === toRate) return input instanceof Int16Array ? input : new Int16Array(input.buffer, input.byteOffset, input.byteLength / 2)
  const src = input instanceof Int16Array ? input : new Int16Array(input.buffer, input.byteOffset, input.byteLength / 2)
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

function concatInt16(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Int16Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function encodeWav(pcmInt16, sampleRate = TARGET_RATE) {
  const pcm = pcmInt16 instanceof Int16Array ? pcmInt16 : new Int16Array(pcmInt16)
  const dataSize = pcm.length * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, dataSize).copy(buf, 44)
  return buf
}

function parseWav(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是有效的 WAV 文件')
  }
  let offset = 12
  let sampleRate = 44100
  let channels = 1
  let bits = 16
  let pcmSlice = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(start + 2)
      sampleRate = buf.readUInt32LE(start + 4)
      bits = buf.readUInt16LE(start + 14)
    } else if (id === 'data') {
      pcmSlice = buf.subarray(start, start + size)
      break
    }
    offset = start + size + (size % 2)
  }
  if (!pcmSlice) throw new Error('WAV 缺少 data 块')
  if (bits !== 16) throw new Error('仅支持 16-bit WAV')
  let mono
  if (channels === 1) {
    mono = new Int16Array(pcmSlice.buffer, pcmSlice.byteOffset, Math.floor(pcmSlice.length / 2))
  } else {
    const frames = Math.floor(pcmSlice.length / 2 / channels)
    const src = new Int16Array(pcmSlice.buffer, pcmSlice.byteOffset, frames * channels)
    mono = new Int16Array(frames)
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let c = 0; c < channels; c++) sum += src[i * channels + c]
      mono[i] = Math.round(sum / channels)
    }
  }
  return { pcm: new Int16Array(mono), sampleRate }
}

function findFfmpeg() {
  const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']
  const extras = [process.env.FFMPEG_PATH, '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean)
  for (const p of extras) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return names[0]
}

async function encodeM4aFile(wavPath, outPath, bitrate = '48k') {
  // Prefer ffmpeg (Linux CI + many desktops), then macOS afconvert.
  const ffmpeg = findFfmpeg()
  try {
    await execFileAsync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', wavPath,
      '-c:a', 'aac', '-b:a', bitrate, '-ac', '1', '-ar', String(TARGET_RATE),
      outPath,
    ], { timeout: 120000 })
    return
  } catch (err) {
    if (process.platform !== 'darwin') throw new Error('M4A 编码失败（需要 ffmpeg 或系统 AAC 编码器）: ' + (err.message || err))
  }
  await execFileAsync('afconvert', [
    '-f', 'm4af', '-d', 'aac', '-b', '48000',
    wavPath, outPath,
  ], { timeout: 120000 })
}

async function pcmToM4a(pcmInt16, sampleRate = TARGET_RATE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-export-'))
  const wavPath = path.join(dir, 'in.wav')
  const m4aPath = path.join(dir, 'out.m4a')
  try {
    fs.writeFileSync(wavPath, encodeWav(pcmInt16, sampleRate))
    await encodeM4aFile(wavPath, m4aPath)
    return fs.readFileSync(m4aPath)
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

module.exports = {
  TARGET_RATE,
  resampleInt16,
  concatInt16,
  encodeWav,
  parseWav,
  encodeM4aFile,
  pcmToM4a,
}

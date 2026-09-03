'use strict'

const assert = require('assert')
const {
  TARGET_RATE,
  resampleInt16,
  concatInt16,
  encodeWav,
  parseWav,
  pcmToM4a,
} = require('../lib/audio-encode')

function tone(n, freq = 440, rate = TARGET_RATE) {
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 8000)
  return pcm
}

async function main() {
  const a = tone(1200)
  const b = tone(800, 660)
  const joined = concatInt16([a, b])
  assert.strictEqual(joined.length, 2000)

  const up = resampleInt16(tone(16000, 440, 16000), 16000, 24000)
  assert.ok(Math.abs(up.length - 24000) < 3)

  const wav = encodeWav(joined, TARGET_RATE)
  assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF')
  assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE')
  assert.strictEqual(wav.readUInt32LE(24), 24000)
  assert.strictEqual(wav.readUInt16LE(22), 1)
  assert.strictEqual(wav.readUInt16LE(34), 16)
  const parsed = parseWav(wav)
  assert.strictEqual(parsed.sampleRate, 24000)
  assert.strictEqual(parsed.pcm.length, joined.length)
  assert.strictEqual(parsed.pcm[10], joined[10])

  const m4a = await pcmToM4a(tone(TARGET_RATE), TARGET_RATE)
  assert.ok(m4a.length > 100, 'm4a too small')
  const hasFtyp = m4a.slice(4, 8).toString('ascii') === 'ftyp' || m4a.includes(Buffer.from('ftyp'))
  assert.ok(hasFtyp, 'not an m4a/mp4')

  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { execFileSync } = require('child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-probe-'))
  const wavPath = path.join(dir, 't.wav')
  const m4aPath = path.join(dir, 't.m4a')
  fs.writeFileSync(wavPath, encodeWav(tone(TARGET_RATE), TARGET_RATE))
  fs.writeFileSync(m4aPath, m4a)
  const wavProbe = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', wavPath], { encoding: 'utf8' })
  const wavInfo = JSON.parse(wavProbe).streams[0]
  assert.strictEqual(Number(wavInfo.sample_rate), 24000)
  assert.strictEqual(Number(wavInfo.channels), 1)
  assert.ok(wavInfo.codec_name === 'pcm_s16le' || wavInfo.bits_per_sample === 16)

  const m4aProbe = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', m4aPath], { encoding: 'utf8' })
  const m4aInfo = JSON.parse(m4aProbe).streams[0]
  assert.strictEqual(m4aInfo.codec_name, 'aac')
  const br = Number(m4aInfo.bit_rate)
  assert.ok(br > 20000 && br < 80000, 'aac bitrate should be ~48kbps, got ' + br)
  fs.rmSync(dir, { recursive: true, force: true })

  console.log('audio-encode tests passed', {
    wavBytes: wav.length,
    m4aBytes: m4a.length,
    sampleRate: TARGET_RATE,
    aacBitrate: br,
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

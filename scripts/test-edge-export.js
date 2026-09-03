'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')
const { encodeWav, pcmToM4a, mp3ToPcm24k, TARGET_RATE } = require('../lib/audio-encode')

async function edgeMp3(text) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata('zh-CN-XiaoxiaoNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='zh-CN-XiaoxiaoNeural'><prosody rate='+0%'>${text}</prosody></voice></speak>`
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

async function main() {
  const mp3 = await edgeMp3('本音频由人工智能生成。导出测试。')
  assert.ok(mp3.length > 500, 'edge mp3 too small')
  assert.strictEqual(mp3[0], 0xff) // MP3 frame sync

  const pcm = await mp3ToPcm24k(mp3)
  assert.ok(pcm.length > 1000, 'decoded pcm too short')

  const wav = encodeWav(pcm, TARGET_RATE)
  const m4a = await pcmToM4a(pcm, TARGET_RATE)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-edge-export-'))
  const wavPath = path.join(dir, 'out.wav')
  const m4aPath = path.join(dir, 'out.m4a')
  fs.writeFileSync(wavPath, wav)
  fs.writeFileSync(m4aPath, m4a)

  const wavInfo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', wavPath], { encoding: 'utf8' })).streams[0]
  assert.strictEqual(Number(wavInfo.sample_rate), 24000)
  assert.strictEqual(Number(wavInfo.channels), 1)
  assert.ok(wavInfo.codec_name === 'pcm_s16le' || wavInfo.bits_per_sample === 16)

  const m4aInfo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', m4aPath], { encoding: 'utf8' })).streams[0]
  assert.strictEqual(m4aInfo.codec_name, 'aac')
  const br = Number(m4aInfo.bit_rate)
  assert.ok(br > 20000 && br < 80000, 'aac bitrate should be ~48kbps, got ' + br)

  fs.rmSync(dir, { recursive: true, force: true })
  console.log('edge export path tests passed', {
    mp3Bytes: mp3.length,
    pcmSamples: pcm.length,
    wavBytes: wav.length,
    m4aBytes: m4a.length,
    aacBitrate: br,
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

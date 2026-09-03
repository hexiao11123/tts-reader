'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)
const { TARGET_RATE, parseWav, resampleInt16 } = require('./audio-encode')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tts-sys-'))
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

function writeText(dir, text) {
  const p = path.join(dir, 'in.txt')
  fs.writeFileSync(p, text, 'utf8')
  return p
}

async function synthesizeDarwin(text, voice, speed) {
  const dir = tmpDir()
  const txt = writeText(dir, text)
  const aiff = path.join(dir, 'out.aiff')
  const wav = path.join(dir, 'out.wav')
  const args = ['-o', aiff, '-f', txt, '-r', String(Math.round(190 * speed))]
  if (voice && voice !== '__system_default__') args.push('-v', voice)
  try {
    try {
      await execFileAsync('say', args, { timeout: 120000 })
    } catch (err) {
      if (!voice || voice === '__system_default__') throw err
      await execFileAsync('say', ['-o', aiff, '-f', txt, '-r', String(Math.round(190 * speed))], { timeout: 120000 })
    }
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${TARGET_RATE}`, aiff, wav], { timeout: 60000 })
    const { pcm, sampleRate } = parseWav(fs.readFileSync(wav))
    return resampleInt16(pcm, sampleRate, TARGET_RATE)
  } finally {
    cleanup(dir)
  }
}

async function synthesizeWin32(text, voice, speed) {
  const dir = tmpDir()
  const txt = writeText(dir, text)
  const wav = path.join(dir, 'out.wav')
  const ps1 = path.join(dir, 'speak.ps1')
  const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)))
  const voiceLine = (voice && voice !== '__system_default__')
    ? `try { $synth.SelectVoice(${JSON.stringify(voice)}) } catch {}\r\n`
    : ''
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.Rate = ${rate}`,
    voiceLine.trim(),
    `$synth.SetOutputToWaveFile(${JSON.stringify(wav)})`,
    `$text = [System.IO.File]::ReadAllText(${JSON.stringify(txt)}, [System.Text.Encoding]::UTF8)`,
    '$synth.Speak($text)',
    '$synth.Dispose()',
  ].filter(Boolean).join('\r\n')
  fs.writeFileSync(ps1, '\uFEFF' + script, 'utf8')
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { timeout: 180000 })
    const { pcm, sampleRate } = parseWav(fs.readFileSync(wav))
    return resampleInt16(pcm, sampleRate, TARGET_RATE)
  } finally {
    cleanup(dir)
  }
}

async function synthesizeLinux(text, voice, speed) {
  const dir = tmpDir()
  const wav = path.join(dir, 'out.wav')
  const txt = writeText(dir, text)
  const wpm = Math.max(80, Math.round(175 * speed))
  const bins = ['espeak-ng', 'espeak']
  let lastErr
  try {
    for (const bin of bins) {
      const attempts = []
      if (voice && voice !== '__system_default__') {
        attempts.push(['-w', wav, '-s', String(wpm), '-f', txt, '-v', voice])
      }
      attempts.push(['-w', wav, '-s', String(wpm), '-f', txt, '-v', 'zh'])
      attempts.push(['-w', wav, '-s', String(wpm), '-f', txt])
      for (const args of attempts) {
        try {
          await execFileAsync(bin, args, { timeout: 120000 })
          lastErr = null
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!lastErr) break
    }
    if (lastErr) {
      throw new Error('系统语音导出需要本机 TTS（macOS say / Windows 系统语音）。当前环境不可用: ' + lastErr.message)
    }
    const { pcm, sampleRate } = parseWav(fs.readFileSync(wav))
    return resampleInt16(pcm, sampleRate, TARGET_RATE)
  } finally {
    cleanup(dir)
  }
}

async function synthesizeSystemPcm(text, voice, speed = 1) {
  if (!text || !String(text).trim()) return new Int16Array(0)
  const t = String(text)
  const v = voice || ''
  const s = Number(speed) || 1
  if (process.platform === 'darwin') return synthesizeDarwin(t, v, s)
  if (process.platform === 'win32') return synthesizeWin32(t, v, s)
  return synthesizeLinux(t, v, s)
}

module.exports = { synthesizeSystemPcm }

export const VOICE_CATEGORIES = [
  {
    id: 'edge',
    label: 'Edge 神经语音',
    engine: 'edge',
    voices: [
      { vcn: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女）' },
      { vcn: 'zh-CN-YunyangNeural',  name: '云扬（男）' },
    ],
  },
  {
    id: 'system',
    label: '系统语音',
    engine: 'system',
    voices: [], // 运行时动态填充
  },
]

export function findVoice(vcn) {
  for (const cat of VOICE_CATEGORIES) {
    const v = cat.voices.find(v => v.vcn === vcn)
    if (v) return { category: cat, voice: v }
  }
  return null
}

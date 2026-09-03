export const VOICE_CATEGORIES = [
  {
    id: 'system',
    label: '系统语音',
    engine: 'system',
    voices: [], // 运行时动态填充
  },
  {
    id: 'edge',
    label: 'Edge 神经语音（实验）',
    engine: 'edge',
    experimental: true,
    voices: [
      { vcn: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女）' },
      { vcn: 'zh-CN-YunyangNeural',  name: '云扬（男）' },
    ],
  },
]

export function findVoice(vcn) {
  for (const cat of VOICE_CATEGORIES) {
    const v = cat.voices.find(v => v.vcn === vcn)
    if (v) return { category: cat, voice: v }
  }
  return null
}

export function visibleCategories(enableEdgeExperimental) {
  return VOICE_CATEGORIES.filter(c => !c.experimental || enableEdgeExperimental)
}

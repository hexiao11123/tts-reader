export const VOICE_CATEGORIES = [
  {
    id: 'gentle-female',
    label: '温柔女声',
    voices: [
      { vcn: 'xiaoyan',   name: '晓燕' },
      { vcn: 'aisjiuxu',  name: '晓萌' },
      { vcn: 'aisxping',  name: '晓萍' },
      { vcn: 'aisjinger', name: '晶晶' },
    ],
  },
  {
    id: 'magnetic-male',
    label: '磁性男声',
    voices: [
      { vcn: 'aisbabyxu',  name: '小炫' },
      { vcn: 'x2_mingming', name: '明明' },
      { vcn: 'x2_xiaofeng', name: '小峰' },
    ],
  },
  {
    id: 'news',
    label: '新闻播报',
    voices: [
      { vcn: 'aisjingjing', name: '晶晶' },
      { vcn: 'x2_vixf',    name: '讯飞助手' },
    ],
  },
  {
    id: 'child',
    label: '儿童声',
    voices: [
      { vcn: 'x2_xiaomei', name: '小美' },
      { vcn: 'x2_xiaobei', name: '小贝' },
    ],
  },
  {
    id: 'system',
    label: '系统语音',
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

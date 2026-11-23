// Speech-to-text for the long-press voice reply. G2 sends 16 kHz s16le mono PCM;
// we wrap it in a WAV container and send it to MiniMax ASR (asr-1.0).
export function pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array {
  const h = new DataView(new ArrayBuffer(44))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ')
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true)
  h.setUint32(24, sampleRate, true); h.setUint32(28, sampleRate * 2, true)
  h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length)
  out.set(new Uint8Array(h.buffer), 0)
  out.set(pcm, 44)
  return out
}

export async function transcribe(pcm: Uint8Array, env = process.env): Promise<string> {
  if (!env.MINIMAX_API_KEY) return ''
  const base = (env.MINIMAX_STT_BASE_URL ?? 'https://api.minimax.cn').replace(/\/$/, '')
  const form = new FormData()
  form.append('model', 'asr-1.0')
  form.append('response_format', 'json')
  form.append('file', new Blob([pcmToWav(pcm) as BlobPart], { type: 'audio/wav' }), 'reply.wav')
  const r = await fetch(`${base}/v1/speech_to_text`, {
    method: 'POST', headers: { authorization: `Bearer ${env.MINIMAX_API_KEY}`, language: env.STT_LANGUAGE ?? 'en' }, body: form,
    signal: AbortSignal.timeout(25_000),
  })
  if (!r.ok) throw new Error(`STT HTTP ${r.status}`)
  const j = (await r.json()) as { text?: string }
  return (j.text ?? '').trim()
}

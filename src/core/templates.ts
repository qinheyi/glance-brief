// Local, offline reply templates. Used when no LLM key is configured or the
// LLM call fails, so the read→write loop always works.
import type { DraftRequest, DraftResult } from './types.ts'

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}

export function templateDraft(req: DraftRequest): DraftResult {
  if (req.channel === 'telegram') {
    const intent = req.intent?.trim()
    return {
      engine: 'template',
      variants: [
        { label: 'Reply', body: intent ? intent : 'Yes, sounds good.' },
        { label: 'Short', body: 'On it.' },
        { label: 'Later', body: 'In a meeting, back in 30 min.' },
      ],
    }
  }
  const hi = `Hi ${firstName(req.to.name)},`
  const sign = `\n\n${firstName(req.userName)}`
  const intent = req.intent?.trim()
  const main = intent
    ? `${hi} ${intent.replace(/[.!]?$/, '.')}${sign}`
    : `${hi} thanks — yes, that works for me. I'll confirm details shortly.${sign}`
  return {
    engine: 'template',
    variants: [
      { label: 'Reply', body: main },
      { label: 'Short', body: `${hi} on it — will get back to you today.${sign}` },
      { label: 'Later', body: `${hi} in meetings now; I'll reply properly this afternoon.${sign}` },
    ],
  }
}

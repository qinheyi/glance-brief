# Glance Brief

**Meeting briefs and a 30-second inbox for Even Realities G2 smart glasses.**
Glance at who you are about to meet and what they want, clear urgent email and Telegram messages, and reply by voice. Nothing is sent until you confirm with one tap.

Built for **Heads Up: Even Realities Hackathon** (DoraHacks, Nov 23–29 2026). Track **04 · AI Assistants & Work** (Gmail + Google Calendar). Also entered for the **Best Telegram integration** prize.

- **Web preview (no glasses needed):** https://glance-brief.vercel.app (runs fully offline on demo data with local reply templates)
- **Demo video (≤ 3 min):** _link added at submission_

| Next meeting brief | Urgent email card | AI draft, waiting for your tap |
|---|---|---|
| ![brief](docs/screenshots/01-brief-next.png) | ![inbox](docs/screenshots/03-inbox-urgent.png) | ![draft](docs/screenshots/08-draft-confirm.png) |

All screenshots are real 576×288 frames captured from the official Even Hub simulator (`/api/screenshot/glasses`). The people and messages in them are **demo data** (see below).

## The problem

You walk into a meeting and can't remember what the client asked for last week. Ten minutes later your phone buzzes with "need a yes by 5pm" and you have to pull it out mid-conversation. Calendars and inboxes are built for a phone or laptop screen. On glasses you need **one thing at a time**, a few words, and a write action you can finish without looking down.

**Who it's for:** people who spend the day in meetings (founders, sales, account managers, PMs) and need to stay on top of a handful of important people without checking their phone.

## What it does

1. **Brief before the meeting.** Tap to see your next meeting: when, where, who, the three things that matter from your recent email threads with those people, and what you owe them.
2. **Inbox in 30 seconds.** Swipe through email (and Telegram) as one stack sorted by urgency. Each card says *why* it is ranked there (`VIP · due today · meeting soon · asks you`).
3. **Reply by voice, confirm by tap.** Long-press, say what you want ("yes, Monday works, I'll send the PO this afternoon"), let go. The app turns your audio into text, an LLM writes a short reply in three versions (*Reply / Short / Later*), and you swipe to pick one. **Tap = send, double-tap = discard.** If you say nothing, you still get a sensible AI draft.

### Gesture map (G2 touchpad or R1 ring)

| Screen | Tap | Double-tap | Swipe ↑ / ↓ | Long-press → release |
|---|---|---|---|---|
| Meeting brief | next meeting | exit app | open inbox | reply to that meeting's thread |
| Inbox card | back to brief | back to brief | previous / next card | voice reply to this message |
| Listening | stop & draft | cancel | – | release = stop & draft |
| Draft | **SEND** (the only write path) | **discard, nothing sent** | switch Reply / Short / Later | – |

Safety: the send effect can only come from a tap on the Draft screen. Gestures are ignored while a send is in flight, so a message can't go out twice, and the backend refuses `/api/send` unless the request says `confirmed: true`. Unit tests cover the first two rules.

## Architecture

```
 G2 glasses  ◄─BLE─►  Even Realities App (WebView)            your server (Node, no deps)
 576×288 text UI      ┌───────────────────────────┐  /api/*   ┌──────────────────────────────┐
 touchpad / R1 ring   │ src/glasses.ts  SDK adapter├──────────►│ server/index.ts              │
 microphone (PCM)     │ src/app.ts      effects    │           │  ├ google.ts  Gmail+Calendar │──► Google APIs
                      │ src/core/*      pure logic │           │  ├ telegram.ts Bot API       │──► Telegram
                      │   machine.ts  state machine│           │  ├ llm.ts  drafts            │──► MiniMax / OpenRouter
                      │   triage.ts   urgency score│           │  └ stt.ts  PCM→WAV→ASR       │──► MiniMax asr-1.0
                      │   screens.ts  576×288 text │           └──────────────────────────────┘
                      │ src/mirror.ts browser view │   API keys and OAuth tokens stay on the server
                      └───────────────────────────┘
```

- **`src/core/`** holds the logic and does no I/O, so it is easy to test: a reducer turns gestures into a new state plus *effects* (`micStart`, `micStopAndDraft`, `send`, `exit`). The glasses adapter and the browser mirror both drive the same state machine.
- **Display fit:** every line is measured with [`@evenrealities/pretext`](https://www.npmjs.com/package/@evenrealities/pretext), which uses the G2 firmware's glyph metrics. Text is truncated by pixel width, not by character count, and each body is capped at 7 lines of 27 px. That gives three containers (header / body / footer), each one line of text, with the body capturing events.
- **Event handling** follows the official template rule: `CLICK_EVENT = 0` is left out of the protobuf on the wire, so the default is resolved per envelope and explicit event ids are matched first.
- **Triage** is a transparent scoring function (VIP, deadline words, sender is in a meeting within 3 h, direct question, unread/important, newsletter penalty, freshness) rather than a black box, so each card can show its reasons.
- **Voice:** G2 microphone PCM (16 kHz s16le) is collected only while you hold the touchpad. The server wraps it in WAV and sends it to MiniMax `asr-1.0`. Audio is never stored (unless `GLANCE_DEBUG_AUDIO=1`).
- **Backend:** Node ≥ 22.18 runs the TypeScript directly, with no runtime dependencies. It follows the hackathon rule "route API calls through your own server and never ship API keys inside the app".
- **Google sign-in** doesn't work inside the WebView, so you link your account once from a normal browser at `/auth/google`. The refresh token stays in `.data/` on the server (git-ignored).

## Run it

Requirements: Node ≥ 22.18. Linux, macOS or Windows.

```bash
git clone https://github.com/qinheyi/glance-brief && cd glance-brief
npm install
npm run server      # backend on :8787 (demo data + local templates if no keys are set)
npm run dev         # Vite on :5173, proxies /api to the backend
npx evenhub-simulator http://localhost:5173      # official Even Hub simulator
```

On Linux the simulator needs WebKitGTK (`sudo apt install libwebkit2gtk-4.1-0`). Use the simulator's touchpad controls, or drive it from scripts with its automation API (`--automation-port 9898`, `POST /api/input {"action":"long_press"}`).

On real G2 hardware: `npm run dev`, then `npx evenhub qr --url http://<your-lan-ip>:5173` and scan the code with the Even Realities App. Package with `npm run pack` (needs `evenhub login`). Before you pack, replace the `network` whitelist in `app.json` with your backend's HTTPS origin.

Browser only: open http://localhost:5173 and use the on-screen buttons or the keys (Space = tap, D = double-tap, ↑/↓ = swipe, hold L = long-press).

### Configuration (`.env.example`)

Every key is optional. Set them as environment variables for `npm run server`; none of them are ever sent to the WebView.

| Variable | Effect |
|---|---|
| `MINIMAX_API_KEY` | AI reply drafts (MiniMax-M3.1-Flash) and voice transcription (asr-1.0) |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Drafts through OpenRouter instead (track-listed app). `LLM_PROVIDER=minimax/openrouter/template` forces one |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Live Gmail + Calendar. Open `http://localhost:8787/auth/google` once to link (scopes: `gmail.readonly`, `gmail.send`, `calendar.readonly`) |
| `GLANCE_VIPS` | Comma-separated VIP addresses for triage |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS` | Live Telegram cards from your bot or groups (optionally only the listed chat ids). Replies go back as threaded `sendMessage` |
| `GLANCE_DEMO=1` | Force demo data even when accounts are linked |

```bash
npm test        # 16 unit tests: gestures, confirm-before-send, triage, display fit, parsing, MIME, Telegram
npm run build   # type-check + production bundle
```

## Demo data

The demo video, the screenshots and the web preview use **built-in demo data** (`src/core/demoData.ts`): fictional people at made-up `.demo` domains, three meetings and seven messages, with times generated relative to "now". In demo mode, **sending is simulated**. The backend logs `DEMO send (not delivered)` and nothing leaves the machine. Demo Telegram items have `chatId: 0` and are never sent to the Bot API.

The Gmail, Calendar and Telegram adapters (`server/google.ts`, `server/telegram.ts`) call the real REST APIs, and their parsing and MIME/threading logic is unit-tested. For the hackathon demo they ran in demo mode, without a linked personal account.

## How AI is used

- **Reply drafting:** an LLM writes three short variants (≤ 45 words for email, ≤ 25 words casual style for Telegram). It is told never to invent facts, prices or dates that are not in the thread or in what you said. MiniMax `MiniMax-M3.1-Flash` by default, or OpenRouter. If no key is set or the call fails, the app falls back to local templates, so the read → write loop always works.
- **Speech-to-text:** MiniMax `asr-1.0` for the spoken intent.
- **Triage is not AI.** It is a deterministic, explainable score.
- **Demo video narration** was generated with MiniMax text-to-speech. In the demo, the "spoken" replies are TTS clips played into the simulator's microphone input, so the voice → STT → draft path in the video is real, not mocked.
- Parts of this codebase were written with the help of AI coding assistants.

## What existed before Nov 23, 2026

Everything in this repository was written during the hackathon (from Nov 23, 2026). Pre-existing open-source pieces used: the Even Hub SDK (`@evenrealities/even_hub_sdk`, MIT), `@evenrealities/pretext` (MIT), the Even Hub simulator and CLI, Vite and TypeScript. The tap/double-tap event-envelope handling follows the pattern documented in [even-realities/evenhub-templates](https://github.com/even-realities/evenhub-templates) (MIT).

## Feature requests for the APIs we used

1. **Even Hub SDK:** a text container with *per-line* brightness or bold, so the "why" and "TODO" lines could be dimmer than the content without needing a separate container.
2. **Even Hub SDK:** a built-in confirm primitive (system-styled "Send? tap / double-tap") so every app's write actions feel the same and can't be spoofed.
3. **Even Hub SDK:** on-device or host-provided speech-to-text, so every app doesn't need its own STT backend.
4. **Gmail API:** a cheap "importance reason" field (why Gmail marked a message important) to feed explainable triage.
5. **Google Calendar API:** a single call that returns an event plus the recent threads with its attendees (today that takes N Gmail searches).

## License

MIT © 2026 Qin HEYI

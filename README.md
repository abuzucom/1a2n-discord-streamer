# Traktor to Discord Bot

A Discord bot that streams DJ audio from **Traktor Pro 4** directly into one configured Discord server. Built with [discord.js](https://discord.js.org), [`@discordjs/voice`](https://discord.js.org/docs/packages/voice), and [FFmpeg](https://ffmpeg.org).

See [CHANGELOG.md](CHANGELOG.md) for release history and breaking changes.

## How It Works

```text
Traktor Pro 4 -> Virtual Audio Cable -> FFmpeg (48 kHz PCM) -> Discord Voice Channel
```

The bot captures audio routed through a virtual device, converts it to Discord's required 48 kHz, 16-bit, stereo PCM format, encodes it as Opus, and streams it through Discord Voice. FFmpeg must produce real PCM before `/startstream` reports success.

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 22.12+** | [Download](https://nodejs.org) |
| **FFmpeg 8** | Downloaded by `npm install` and SHA-256 verified before execution |
| **Virtual audio device** | VB-Audio Virtual Cable (Windows) or BlackHole (macOS) |
| **Discord bot token** | Create one at the [Discord Developer Portal](https://discord.com/developers/applications) |

## Virtual Audio Device Setup

### Windows: VB-Audio Virtual Cable

1. Download and install [VB-Audio Virtual Cable](https://vb-audio.com/Cable/).
2. Open Traktor Pro 4 and go to **Settings > Audio Setup**.
3. Set output to **CABLE Input (VB-Audio Virtual Cable)**. To hear the audio locally too, use VoiceMeeter Banana to split it between your speakers and the virtual cable.
4. List DirectShow devices:

```bash
npm run audio-devices
```

Look for `CABLE Output (VB-Audio Virtual Cable)` under the DirectShow audio devices, then configure:

```env
AUDIO_INPUT=audio=CABLE Output (VB-Audio Virtual Cable)
```

### macOS: BlackHole

1. Install [BlackHole 2ch](https://existential.audio/blackhole/).
2. Open **Audio MIDI Setup**, click `+`, and select **Create Multi-Output Device**.
3. Add both **BlackHole 2ch** and your speakers or interface.
4. Set Traktor's output to the multi-output device.
5. Configure:

```env
AUDIO_INPUT=:BlackHole 2ch
```

List the detected AVFoundation devices with `npm run audio-devices` if the configured name does not work.

## Discord Bot Setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Open **Bot**, reset the token, and copy it.
3. Under **OAuth2 > URL Generator**, select the `bot` and `applications.commands` scopes.
4. Grant **Connect**, **Speak**, and **View Channels** permissions.
5. Open the generated URL to invite the bot to your server.

Slash commands require the Discord **Manage Server** permission and are accepted only from the server identified by `GUILD_ID`. Stage channels are not supported because bots join them as suppressed audience members by default.

## Installation

```bash
npm ci
cp .env.example .env
```

Fill in `.env`:

```env
DISCORD_BOT_TOKEN=your_bot_token
GUILD_ID=your_server_id
AUDIO_INPUT=audio=CABLE Output (VB-Audio Virtual Cable)
```

## Usage

Development with hot reloading:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

Build before pruning development dependencies or deploying `dist/`; `npm start` runs only the compiled application.

Run every automated check without logging in to Discord:

```bash
npm run check
```

`npm run check` builds TypeScript, runs ESLint, verifies FFmpeg/DAVE/Opus dependencies, validates command definitions, and executes the simulated lifecycle suite.

Run individual diagnostics with:

| Command | Purpose |
|---|---|
| `npm run audio-devices` | List supported local capture devices |
| `npm run smoke` | Verify FFmpeg integrity, Discord Voice dependencies, Opus, and commands |
| `npm run test:e2e` | Simulate authorization, join, stream, volume, restart, stop, and leave |

The E2E suite uses real command handlers and session management with deterministic Discord and FFmpeg adapters. It does not connect to a live guild.

### Slash Commands

| Command | Description |
|---|---|
| `/join <channel>` | Join a voice channel |
| `/startstream` | Begin streaming audio from Traktor |
| `/stopstream` | Stop streaming but stay in the channel |
| `/leave` | Leave the voice channel and clean up |
| `/volume <0-100>` | Set the stream volume |

For better music quality, increase the voice channel bitrate in Discord's channel settings. The configured virtual audio device must be installed on the same machine where the bot runs.

The default Opus encoder is `opusscript`, which installs without native build tools. For lower CPU usage, advanced users can replace it with `@discordjs/opus` when a prebuilt binary is available for their Node version.

## Architecture

| File | Responsibility |
|---|---|
| `src/index.ts` | Bot startup, command registration, and event handling |
| `src/interaction-handler.ts` | Guild and permission enforcement, command dispatch |
| `src/commands.ts` | Slash command definitions and handlers |
| `src/voice-manager.ts` | Serialized voice lifecycle, bounded restarts, stream control |
| `src/audio-capture.ts` | FFmpeg process, PCM readiness, watchdog, and cleanup |
| `src/ffmpeg.ts` | Platform allowlist and FFmpeg SHA-256 verification |
| `src/types.ts` | Shared TypeScript interfaces |
| `scripts/smoke.mjs` | Runtime dependency and command validation |
| `scripts/e2e-simulated.mjs` | Simulated command and voice lifecycle coverage |

Commands register immediately in the configured guild. Join and leave operations are serialized so concurrent requests cannot orphan connections. A stalled stream is stopped after ten seconds without PCM, and unexpected player idles are restarted at most three times with exponential backoff. Another `/startstream` explicitly resets that retry budget.

## Security

- Interactions must come from `GUILD_ID` and a member with **Manage Server**.
- FFmpeg is spawned with an argument array, never through a shell.
- The downloaded FFmpeg executable is checked against a platform-specific SHA-256 allowlist before execution.
- FFmpeg output is sanitized, truncated, deduplicated, and rate-limited before logging.
- Internal process and filesystem errors are logged locally but not returned in Discord responses.
- Shutdown rejects new voice operations, drains queued operations, and cleans active sessions.
- `.env`, dependencies, and generated output are excluded from Git.

## Troubleshooting

**FFmpeg failed to start or failed integrity verification:** Remove `node_modules`, run `npm ci`, then run `npm run smoke`. Do not bypass the integrity check.

**Could not find audio device:** Run the device listing command for your platform and make sure `AUDIO_INPUT` matches exactly.

**No audio in Discord:** Confirm Traktor is outputting to the virtual cable and that the bot has **Speak** permission.

**High latency:** Discord adds some inherent latency. Run the bot on the same machine as Traktor for the lowest practical latency.

**Voice connection timeout:** Check the network connection, then use `/leave` followed by `/join`.

**Stream stopped after repeated failures:** Automatic restart is limited to three attempts per manual start. Correct the device problem, then use `/startstream` again.

## License

The bot source is licensed under the [MIT License](LICENSE).

The bundled FFmpeg 8 executable is supplied by [`ffmpeg-for-homebridge` v2.2.2](https://github.com/homebridge/ffmpeg-for-homebridge/releases/tag/v2.2.2), and its SHA-256 is verified before execution. This upstream build enables GPLv3 and nonfree components and is designated non-redistributable: do not redistribute the downloaded binary with this project. Exact build scripts and third-party source references are available from the tagged [upstream source](https://github.com/homebridge/ffmpeg-for-homebridge/tree/v2.2.2). The bot's own source remains MIT-licensed.

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-07-24

### Added

- Vendored FFmpeg 8 installation with platform-specific SHA-256 verification before execution.
- Local audio-device discovery through `npm run audio-devices`.
- PCM readiness checks and a no-audio watchdog for stalled capture devices.
- Simulated end-to-end coverage for authorization, voice lifecycle, volume, cleanup, and bounded restarts.
- Runtime smoke checks for FFmpeg, Discord DAVE support, Opus, and slash-command definitions.
- Per-guild operation serialization and shutdown draining.
- MIT license file.

### Changed

- **Breaking:** Raised the minimum Node.js version from 18 to 22.12 for DAVE-capable Discord Voice support.
- **Breaking:** Restricted command execution to the configured `GUILD_ID`.
- **Breaking:** Required the Discord **Manage Server** permission for every slash command.
- **Breaking:** Restricted `/join` to regular voice channels; Stage channels are no longer accepted.
- Upgraded `@discordjs/voice` to the DAVE-capable 0.19 release line.
- Made production startup run compiled output only; deployments must build before `npm start`.
- Limited automatic capture recovery to three attempts per manual start with exponential backoff.
- Updated architecture, setup, testing, troubleshooting, security, and FFmpeg licensing documentation.

### Fixed

- Prevented cross-guild audio capture and unbounded multi-guild FFmpeg sessions.
- Prevented concurrent joins, stale callbacks, and external connection destruction from orphaning resources.
- Made stream setup and teardown exception-safe with bounded process termination.
- Prevented false-positive stream startup before FFmpeg emits PCM.
- Prevented unlimited restart churn and FFmpeg log growth.
- Prevented internal filesystem and process details from being returned to Discord users.
- Corrected audio-device discovery for current FFmpeg output.

### Security

- Added authorization tests for wrong-guild and insufficient-permission interactions.
- Added FFmpeg executable integrity verification and platform allowlisting.
- Sanitized, truncated, deduplicated, and rate-limited FFmpeg diagnostic logs.
- Removed the unused `libsodium-wrappers` production dependency.
- Replaced obsolete FFmpeg 4.1 and 6.1.1 builds with an FFmpeg 8 build.

## [1.0.0] - 2026-07-24

### Added

- Initial Discord bot with `/join`, `/leave`, `/startstream`, `/stopstream`, and `/volume` commands.
- Traktor audio capture through DirectShow on Windows and AVFoundation on macOS.
- Guild-scoped slash-command registration and basic voice reconnection.

[Unreleased]: https://github.com/abuzucom/1a2n-discord-streamer/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/abuzucom/1a2n-discord-streamer/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/abuzucom/1a2n-discord-streamer/releases/tag/v1.0.0

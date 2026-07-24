import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { Transform } from 'stream';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { getVerifiedFFmpegPath } from './ffmpeg.js';

const PLATFORM_WINDOWS = process.platform === 'win32';
const PLATFORM_MACOS = process.platform === 'darwin';
const STARTUP_TIMEOUT_MS = 5_000;
const NO_AUDIO_TIMEOUT_MS = 10_000;
const FORCE_KILL_AFTER_MS = 3_000;
const CLEANUP_DEADLINE_MS = 4_000;
const MAX_LOG_LENGTH = 2_000;
const REPEATED_LOG_INTERVAL_MS = 10_000;
const LOG_WINDOW_MS = 60_000;
const MAX_LOGS_PER_WINDOW = 10;
const stoppingProcesses = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();

interface CaptureOptions {
  input: string;
  sampleRate: number;
  channels: number;
}

export interface CaptureResult {
  ffmpegProcess: ChildProcessWithoutNullStreams;
  resource: ReturnType<typeof createAudioResource>;
}

function buildFFmpegArgs({ input, sampleRate, channels }: CaptureOptions): string[] {
  const args: string[] = ['-hide_banner', '-nostats', '-loglevel', 'warning'];

  if (PLATFORM_WINDOWS) {
    args.push('-f', 'dshow');
  } else if (PLATFORM_MACOS) {
    args.push('-f', 'avfoundation');
  } else {
    throw new Error(`Unsupported platform: ${process.platform}. Use Windows or macOS.`);
  }

  args.push(
    '-probesize',
    '32',
    '-analyzeduration',
    '0',
    '-i',
    input,
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
    '-f',
    's16le',
    'pipe:1',
  );

  return args;
}

export async function startAudioCapture(opts: CaptureOptions): Promise<CaptureResult> {
  const ffmpegPath = await getVerifiedFFmpegPath();

  console.log('[audio-capture] Starting FFmpeg capture.');
  const ffmpegProcess = spawn(ffmpegPath, buildFFmpegArgs(opts), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let lastLog = '';
  let lastLogAt = 0;
  let logWindowStartedAt = Date.now();
  let logsInWindow = 0;
  let suppressionLogged = false;
  ffmpegProcess.stderr.on('data', (data: Buffer) => {
    const message = sanitizeLogMessage(data.toString()).slice(0, MAX_LOG_LENGTH);
    const now = Date.now();
    if (now - logWindowStartedAt >= LOG_WINDOW_MS) {
      logWindowStartedAt = now;
      logsInWindow = 0;
      suppressionLogged = false;
    }
    if (logsInWindow >= MAX_LOGS_PER_WINDOW) {
      if (!suppressionLogged) {
        console.warn('[ffmpeg] Additional messages suppressed for this minute.');
        suppressionLogged = true;
      }
      return;
    }
    if (message && (message !== lastLog || now - lastLogAt >= REPEATED_LOG_INTERVAL_MS)) {
      console.warn('[ffmpeg]', message);
      lastLog = message;
      lastLogAt = now;
      logsInWindow += 1;
    }
  });

  ffmpegProcess.on('error', (error) => {
    console.error('[audio-capture] FFmpeg process error:', error.message);
  });
  ffmpegProcess.on('exit', (code, signal) => {
    console.log(`[audio-capture] FFmpeg exited (code=${code}, signal=${signal}).`);
  });

  let lastAudioAt = Date.now();
  const monitoredPcm = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      lastAudioAt = Date.now();
      callback(null, chunk);
    },
  });
  ffmpegProcess.stdout.pipe(monitoredPcm);

  let watchdogTriggered = false;
  const watchdog = setInterval(() => {
    if (!watchdogTriggered && Date.now() - lastAudioAt >= NO_AUDIO_TIMEOUT_MS) {
      watchdogTriggered = true;
      console.error('[audio-capture] No PCM audio received; stopping stalled capture.');
      void stopAudioCapture(ffmpegProcess);
    }
  }, 1_000);
  watchdog.unref();
  ffmpegProcess.once('close', () => {
    clearInterval(watchdog);
    monitoredPcm.destroy();
  });

  let resource: ReturnType<typeof createAudioResource>;
  try {
    resource = createAudioResource(monitoredPcm, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    await waitForPcm(ffmpegProcess, monitoredPcm);
  } catch (error) {
    await stopAudioCapture(ffmpegProcess);
    throw error;
  }

  return { ffmpegProcess, resource };
}

function sanitizeLogMessage(message: string): string {
  let sanitized = '';
  for (const character of message) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint < 32 || codePoint === 127 ? ' ' : character;
  }
  return sanitized.trim();
}

async function waitForPcm(
  process: ChildProcessWithoutNullStreams,
  pcmStream: Transform,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pcmStream.off('readable', onReadable);
      process.off('error', onError);
      process.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onReadable = () => {
      if (pcmStream.readableLength > 0) finish();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`FFmpeg exited before producing audio (code=${code}, signal=${signal}).`));
    };

    const timer = setTimeout(() => {
      finish(new Error(`FFmpeg produced no audio within ${STARTUP_TIMEOUT_MS / 1000} seconds.`));
    }, STARTUP_TIMEOUT_MS);
    timer.unref();
    pcmStream.once('readable', onReadable);
    process.once('error', onError);
    process.once('exit', onExit);

    if (pcmStream.readableLength > 0) finish();
  });
}

export function stopAudioCapture(
  process: ChildProcessWithoutNullStreams | null,
): Promise<void> {
  if (!process || process.exitCode !== null || process.signalCode !== null) {
    return Promise.resolve();
  }

  const existingStop = stoppingProcesses.get(process);
  if (existingStop) return existingStop;

  const stopPromise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(cleanupDeadline);
      process.off('close', finish);
      resolve();
    };

    const forceKillTimer = setTimeout(() => {
      if (process.exitCode === null && process.signalCode === null) {
        process.kill('SIGKILL');
      }
    }, FORCE_KILL_AFTER_MS);
    forceKillTimer.unref();

    const cleanupDeadline = setTimeout(() => {
      process.stdin.destroy();
      process.stdout.destroy();
      process.stderr.destroy();
      finish();
    }, CLEANUP_DEADLINE_MS);
    cleanupDeadline.unref();

    process.once('close', finish);
    process.stdin.on('error', () => undefined);
    process.stdin.end();
    process.kill('SIGTERM');
  }).finally(() => {
    stoppingProcesses.delete(process);
  });

  stoppingProcesses.set(process, stopPromise);
  return stopPromise;
}

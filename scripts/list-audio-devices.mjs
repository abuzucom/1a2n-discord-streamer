import { spawnSync } from 'node:child_process';
import process, { platform, stderr, stdout } from 'node:process';
import { getVerifiedFFmpegPath } from '../dist/ffmpeg.js';

let ffmpegPath;
try {
  ffmpegPath = await getVerifiedFFmpegPath();
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

if (!ffmpegPath) {
  stderr.write(`No vendored FFmpeg binary is available for ${platform}.\n`);
  process.exitCode = 1;
} else if (platform === 'win32' || platform === 'darwin') {
  const args = platform === 'win32'
    ? ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']
    : ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''];
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  stdout.write(result.stdout ?? '');
  stderr.write(result.stderr ?? '');

  if (result.error) {
    stderr.write(`Failed to list audio devices: ${result.error.message}\n`);
    process.exitCode = 1;
  } else {
    const expectedMarker = platform === 'win32' ? '(audio)' : 'AVFoundation audio devices';
    if (!result.stderr?.includes(expectedMarker)) {
      stderr.write('FFmpeg did not return an audio device list.\n');
      process.exitCode = 1;
    }
  }
} else {
  stderr.write(`Audio device discovery is unsupported on ${platform}.\n`);
  process.exitCode = 1;
}

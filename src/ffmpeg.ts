import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import ffmpegPath from 'ffmpeg-for-homebridge';

// SHA-256 values for the v2.2.2 release assets after extraction.
const EXPECTED_HASHES: Record<string, string> = {
  'darwin-arm64': '07734c04cb2e30c64deb3a3816f2c5430cee7ec23c1838ce7eb0bae8995b2dcb',
  'darwin-x64': 'e86e2c1e65a646575441acd52f64876556bf00042d7bb3a4d853b9b19bf245c0',
  'win32-x64': 'd1dff2cb03eeb721c125266b07fbb323ee6d2fd23eae46a6cc3144efd4a79659',
};

let verification: Promise<string> | undefined;

export function getVerifiedFFmpegPath(): Promise<string> {
  verification ??= verifyFFmpeg();
  return verification;
}

async function verifyFFmpeg(): Promise<string> {
  if (!ffmpegPath) {
    throw new Error(`No vendored FFmpeg binary is available for ${process.platform}.`);
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const expectedHash = EXPECTED_HASHES[platformKey];
  if (!expectedHash) {
    throw new Error(`Vendored FFmpeg is not approved for ${platformKey}.`);
  }

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(ffmpegPath)) {
    hash.update(chunk);
  }

  if (hash.digest('hex') !== expectedHash) {
    throw new Error('Vendored FFmpeg failed integrity verification. Reinstall dependencies.');
  }

  return ffmpegPath;
}

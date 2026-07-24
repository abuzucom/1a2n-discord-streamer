import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { stdout } from 'node:process';
import { Readable } from 'node:stream';
import {
  createAudioResource,
  generateDependencyReport,
  StreamType,
} from '@discordjs/voice';
import { commands } from '../dist/commands.js';
import { getVerifiedFFmpegPath } from '../dist/ffmpeg.js';

const report = generateDependencyReport();
assert.match(report, /@discordjs\/voice: 0\.19\./, 'DAVE-capable voice library is required');
assert.match(report, /opusscript: (?!not found)/, 'An Opus encoder is required');
assert.match(report, /@snazzah\/davey: (?!not found)/, 'Discord DAVE support is required');

const ffmpegPath = await getVerifiedFFmpegPath();
const ffmpegVersion = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8' });
assert.equal(ffmpegVersion.status, 0, ffmpegVersion.error?.message ?? ffmpegVersion.stderr);
assert.match(ffmpegVersion.stdout, /^ffmpeg version /);
assert.match(ffmpegVersion.stdout, /^ffmpeg version 8\./);

const resource = createAudioResource(Readable.from([Buffer.alloc(3_840)]), {
  inputType: StreamType.Raw,
  inlineVolume: true,
});
resource.volume?.setVolume(0.5);
assert.equal(resource.volume?.volume, 0.5);

const commandData = commands.map((command) => command.data.toJSON());
assert.equal(commandData.length, 5);
assert.equal(new Set(commandData.map((command) => command.name)).size, commandData.length);
assert.ok(commandData.every((command) => command.default_member_permissions === '32'));

stdout.write('FFmpeg, voice dependencies, Opus, and slash command definitions are valid.\n');

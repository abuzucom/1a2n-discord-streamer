import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stdout } from 'node:process';
import { setImmediate } from 'node:timers';
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { commands } from '../dist/commands.js';
import { handleInteraction } from '../dist/interaction-handler.js';
import { VoiceManager } from '../dist/voice-manager.js';

class FakeConnection extends EventEmitter {
  state = { status: VoiceConnectionStatus.Ready };
  destroyed = false;
  subscription = null;

  subscribe(player) {
    this.subscription = player;
  }

  destroy() {
    this.destroyed = true;
    this.state = { status: VoiceConnectionStatus.Destroyed };
    this.emit(VoiceConnectionStatus.Destroyed);
  }
}

class FakePlayer extends EventEmitter {
  resource = null;
  stopCount = 0;

  play(resource) {
    this.resource = resource;
  }

  stop() {
    this.stopCount += 1;
    this.resource = null;
    return true;
  }
}

function createInteraction({ channel, guildId = 'guild-1', level }) {
  const replies = [];
  return {
    guildId,
    replies,
    deferred: false,
    replied: false,
    commandName: 'join',
    memberPermissions: {
      has: () => true,
    },
    isChatInputCommand: () => true,
    options: {
      getChannel: () => channel,
      getInteger: () => level,
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(reply) {
      replies.push(reply);
    },
    async reply(reply) {
      this.replied = true;
      replies.push(reply);
    },
  };
}

function command(name) {
  const result = commands.find((candidate) => candidate.data.name === name);
  assert.ok(result, `Expected /${name} command`);
  return result;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for simulated lifecycle operation');
}

const connection = new FakeConnection();
const player = new FakePlayer();
const captures = [];
const stoppedProcesses = [];
const volumeChanges = [];

const manager = new VoiceManager('audio=simulated', {
  createAudioPlayer: () => player,
  entersState: async (target, status) => {
    target.state = { status };
    return target;
  },
  joinVoiceChannel: () => connection,
  sleep: async () => undefined,
  startAudioCapture: async () => {
    const ffmpegProcess = { id: captures.length + 1 };
    const resource = {
      volume: {
        setVolume(value) {
          volumeChanges.push(value);
        },
      },
    };
    captures.push({ ffmpegProcess, resource });
    return { ffmpegProcess, resource };
  },
  stopAudioCapture: async (process) => {
    if (process) stoppedProcesses.push(process);
  },
});

const channel = {
  id: 'voice-1',
  name: 'DJ Booth',
  guild: {
    id: 'guild-1',
    voiceAdapterCreator: {},
  },
};

const wrongGuildInteraction = createInteraction({ channel, guildId: 'guild-2' });
await handleInteraction(wrongGuildInteraction, manager, 'guild-1');
assert.deepEqual(wrongGuildInteraction.replies, [{
  content: 'This bot is not configured for this server.',
  ephemeral: true,
}]);
assert.equal(manager.getSession('guild-1'), undefined);

const unauthorizedInteraction = createInteraction({ channel });
unauthorizedInteraction.memberPermissions.has = () => false;
await handleInteraction(unauthorizedInteraction, manager, 'guild-1');
assert.deepEqual(unauthorizedInteraction.replies, [{
  content: 'You need the Manage Server permission to control this bot.',
  ephemeral: true,
}]);
assert.equal(manager.getSession('guild-1'), undefined);

const joinInteraction = createInteraction({ channel });
await command('join').execute(joinInteraction, manager);
assert.deepEqual(joinInteraction.replies, [
  'Joined **DJ Booth**. Use `/startstream` to begin broadcasting.',
]);
assert.equal(connection.subscription, player);
assert.ok(manager.getSession('guild-1'));

const startInteraction = createInteraction({ channel });
await command('startstream').execute(startInteraction, manager);
assert.deepEqual(startInteraction.replies, ['Stream started. Your DJ audio is now live.']);
assert.equal(manager.getSession('guild-1')?.isStreaming, true);
assert.equal(captures.length, 1);
assert.equal(player.listenerCount(AudioPlayerStatus.Idle), 1);
assert.equal(player.listenerCount('error'), 1);

const volumeInteraction = createInteraction({ channel, level: 42 });
await command('volume').execute(volumeInteraction, manager);
assert.deepEqual(volumeInteraction.replies, ['Volume set to **42%**.']);
assert.equal(manager.getSession('guild-1')?.volume, 0.42);
assert.equal(volumeChanges.at(-1), 0.42);

const stopInteraction = createInteraction({ channel });
await command('stopstream').execute(stopInteraction, manager);
assert.deepEqual(stopInteraction.replies, ['Stream stopped. Use `/startstream` to resume.']);
assert.equal(manager.getSession('guild-1')?.isStreaming, false);
assert.deepEqual(stoppedProcesses, [captures[0].ffmpegProcess]);

const resumeInteraction = createInteraction({ channel });
await command('startstream').execute(resumeInteraction, manager);
assert.equal(captures.length, 2);
assert.equal(player.listenerCount(AudioPlayerStatus.Idle), 1);
assert.equal(player.listenerCount('error'), 1);

for (let expectedCaptures = 3; expectedCaptures <= 5; expectedCaptures += 1) {
  player.emit(AudioPlayerStatus.Idle);
  await waitFor(() => !manager.getSession('guild-1')?.isRestarting);
  assert.equal(captures.length, expectedCaptures);
}

player.emit(AudioPlayerStatus.Idle);
await waitFor(() => manager.getSession('guild-1')?.isStreaming === false);
assert.equal(captures.length, 5);
assert.equal(stoppedProcesses.length, 5);

await command('startstream').execute(createInteraction({ channel }), manager);
assert.equal(captures.length, 6);

const leaveInteraction = createInteraction({ channel });
await command('leave').execute(leaveInteraction, manager);
assert.deepEqual(leaveInteraction.replies, ['Left the voice channel.']);
assert.equal(manager.getSession('guild-1'), undefined);
assert.equal(connection.destroyed, true);
assert.deepEqual(stoppedProcesses, [
  captures[0].ffmpegProcess,
  captures[1].ffmpegProcess,
  captures[2].ffmpegProcess,
  captures[3].ffmpegProcess,
  captures[4].ffmpegProcess,
  captures[5].ffmpegProcess,
]);

const failingConnection = new FakeConnection();
const failingPlayer = new FakePlayer();
const failureCaptures = [];
const stoppedFailureCaptures = [];
let failVolumeSetup = true;
const failingManager = new VoiceManager('audio=simulated', {
  createAudioPlayer: () => failingPlayer,
  entersState: async (target, status) => {
    target.state = { status };
    return target;
  },
  joinVoiceChannel: () => failingConnection,
  sleep: async () => undefined,
  startAudioCapture: async () => {
    const ffmpegProcess = { id: `failure-capture-${failureCaptures.length + 1}` };
    failureCaptures.push(ffmpegProcess);
    return {
      ffmpegProcess,
      resource: {
        volume: {
          setVolume() {
            if (failVolumeSetup) {
              failVolumeSetup = false;
              throw new Error('sensitive C:\\host\\path');
            }
          },
        },
      },
    };
  },
  stopAudioCapture: async (process) => {
    if (process) stoppedFailureCaptures.push(process);
  },
});

await failingManager.join(channel);
const failedStartInteraction = createInteraction({ channel });
await command('startstream').execute(failedStartInteraction, failingManager);
assert.deepEqual(failedStartInteraction.replies, [
  'Failed to start the stream. Check the bot logs.',
]);
assert.equal(failedStartInteraction.replies[0].includes('C:\\host'), false);
assert.deepEqual(stoppedFailureCaptures, [failureCaptures[0]]);
assert.equal(failingManager.getSession('guild-1')?.isStreaming, false);

await failingManager.startStream('guild-1');
assert.equal(failingManager.getSession('guild-1')?.isStreaming, true);
failingConnection.destroy();
await waitFor(() => failingManager.getSession('guild-1') === undefined);
assert.deepEqual(stoppedFailureCaptures, failureCaptures);

stdout.write(
  'Simulated authorization, join, stream, volume, stop, bounded restart, failure, and leave flow passed.\n',
);

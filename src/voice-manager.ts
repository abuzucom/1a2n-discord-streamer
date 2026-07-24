import {
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { VoiceChannel } from 'discord.js';
import { startAudioCapture, stopAudioCapture } from './audio-capture.js';
import type { StreamSession } from './types.js';

export interface VoiceManagerDependencies {
  createAudioPlayer: typeof createAudioPlayer;
  entersState: typeof entersState;
  joinVoiceChannel: typeof joinVoiceChannel;
  sleep: (milliseconds: number) => Promise<void>;
  startAudioCapture: typeof startAudioCapture;
  stopAudioCapture: typeof stopAudioCapture;
}

const defaultDependencies: VoiceManagerDependencies = {
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  startAudioCapture,
  stopAudioCapture,
};

const MAX_RESTART_ATTEMPTS = 3;
const BASE_RESTART_DELAY_MS = 1_000;

export class VoiceManager {
  private readonly sessions = new Map<string, StreamSession>();
  private readonly guildOperations = new Map<string, Promise<void>>();
  private acceptingOperations = true;

  constructor(
    private readonly audioInput: string,
    private readonly dependencies: VoiceManagerDependencies = defaultDependencies,
  ) {}

  async join(channel: VoiceChannel): Promise<void> {
    const guildId = channel.guild.id;
    await this.runGuildOperation(guildId, async () => {
      await this.leaveCurrentSession(guildId);
      await this.joinCurrentSession(channel);
    });
  }

  private async joinCurrentSession(channel: VoiceChannel): Promise<void> {
    const guildId = channel.guild.id;
    const connection = this.dependencies.joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    let player: ReturnType<typeof createAudioPlayer>;
    try {
      player = this.dependencies.createAudioPlayer();
    } catch (error) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      throw error;
    }
    const session: StreamSession = {
      connection,
      player,
      resource: null,
      ffmpegProcess: null,
      isStreaming: false,
      isStarting: false,
      isRestarting: false,
      generation: 0,
      restartAttempts: 0,
      volume: 1,
      guildId,
    };

    // Track pending joins immediately so a concurrent join or leave can cancel them.
    this.sessions.set(guildId, session);

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      void this.recoverConnection(session);
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (this.sessions.get(guildId) === session) {
        void this.destroySession(session).catch((error: unknown) => {
          console.error('[voice-manager] Failed to clean up destroyed connection:', error);
        });
      }
      console.log(`[voice-manager] Connection destroyed in guild ${guildId}.`);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      if (session.isStreaming && !session.isRestarting) {
        void this.restartStream(session);
      }
    });
    player.on('error', (error) => {
      console.error('[voice-manager] Audio player error:', error.message);
    });

    try {
      await this.dependencies.entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {
      await this.destroySession(session);
      throw new Error('Failed to connect to voice channel within timeout (10s).');
    }

    if (this.sessions.get(guildId) !== session) {
      await this.destroySession(session);
      throw new Error('Voice channel join was superseded by another operation.');
    }

    try {
      connection.subscribe(player);
    } catch (error) {
      await this.destroySession(session);
      throw new Error('Failed to subscribe the audio player to the voice connection.', {
        cause: error,
      });
    }
    console.log(`[voice-manager] Joined voice channel ${channel.name} in guild ${guildId}.`);
  }

  private async recoverConnection(session: StreamSession): Promise<void> {
    if (this.sessions.get(session.guildId) !== session) return;

    console.warn(
      `[voice-manager] Connection lost in guild ${session.guildId}. Attempting reconnect...`,
    );
    try {
      await Promise.race([
        this.dependencies.entersState(
          session.connection,
          VoiceConnectionStatus.Signalling,
          5_000,
        ),
        this.dependencies.entersState(
          session.connection,
          VoiceConnectionStatus.Connecting,
          5_000,
        ),
      ]);
      await this.dependencies.entersState(
        session.connection,
        VoiceConnectionStatus.Ready,
        10_000,
      );
      console.log(`[voice-manager] Reconnected to guild ${session.guildId}.`);
    } catch {
      if (this.sessions.get(session.guildId) === session) {
        console.error(
          `[voice-manager] Reconnect failed for guild ${session.guildId}. Cleaning up.`,
        );
        await this.destroySession(session);
      }
    }
  }

  async startStream(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) {
      throw new Error('Bot is not connected to a voice channel. Use /join first.');
    }
    if (session.connection.state.status !== VoiceConnectionStatus.Ready) {
      throw new Error('Voice connection is not ready. Try again in a moment.');
    }
    if (session.isStreaming || session.isStarting) {
      throw new Error('Stream is already running or starting. Use /stopstream first.');
    }

    const generation = ++session.generation;
    session.isStarting = true;

    let capture: Awaited<ReturnType<typeof startAudioCapture>> | null = null;
    try {
      capture = await this.dependencies.startAudioCapture({
        input: this.audioInput,
        sampleRate: 48_000,
        channels: 2,
      });

      if (this.sessions.get(guildId) !== session || session.generation !== generation) {
        await this.dependencies.stopAudioCapture(capture.ffmpegProcess);
        throw new Error('Stream start was cancelled by another operation.');
      }

      session.ffmpegProcess = capture.ffmpegProcess;
      session.resource = capture.resource;
      capture.resource.volume?.setVolume(session.volume);
      session.player.play(capture.resource);
      session.isStreaming = true;
      session.restartAttempts = 0;

      console.log(`[voice-manager] Stream started in guild ${guildId}.`);
    } catch (error) {
      if (capture) {
        if (session.ffmpegProcess === capture.ffmpegProcess) {
          session.ffmpegProcess = null;
          session.resource = null;
          session.isStreaming = false;
        }
        await this.dependencies.stopAudioCapture(capture.ffmpegProcess);
      }
      console.error('[voice-manager] Failed to start stream:', error);
      throw new Error('Audio capture could not start. Check the bot logs for details.');
    } finally {
      session.isStarting = false;
    }
  }

  async stopStream(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session || (!session.isStreaming && !session.isStarting)) {
      throw new Error('No active stream to stop.');
    }

    session.generation += 1;
    session.isStarting = false;
    session.isStreaming = false;
    session.isRestarting = false;
    session.player.stop();
    const process = session.ffmpegProcess;
    session.ffmpegProcess = null;
    session.resource = null;
    await this.dependencies.stopAudioCapture(process);

    console.log(`[voice-manager] Stream stopped in guild ${guildId}.`);
  }

  private async restartStream(session: StreamSession): Promise<void> {
    if (this.sessions.get(session.guildId) !== session || session.isRestarting) return;

    if (session.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      session.isStreaming = false;
      const failedProcess = session.ffmpegProcess;
      session.ffmpegProcess = null;
      session.resource = null;
      await this.dependencies.stopAudioCapture(failedProcess);
      console.error('[voice-manager] Restart limit reached; use /startstream to try again.');
      return;
    }

    session.restartAttempts += 1;
    const generation = ++session.generation;
    session.isRestarting = true;
    const restartDelay = BASE_RESTART_DELAY_MS * 2 ** (session.restartAttempts - 1);
    console.warn(
      `[voice-manager] Player idle; restart ${session.restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${restartDelay}ms.`,
    );

    try {
      const oldProcess = session.ffmpegProcess;
      session.ffmpegProcess = null;
      session.resource = null;
      await this.dependencies.stopAudioCapture(oldProcess);
      await this.dependencies.sleep(restartDelay);

      if (
        !session.isStreaming ||
        this.sessions.get(session.guildId) !== session ||
        session.generation !== generation
      ) {
        return;
      }

      const capture = await this.dependencies.startAudioCapture({
        input: this.audioInput,
        sampleRate: 48_000,
        channels: 2,
      });

      if (
        !session.isStreaming ||
        this.sessions.get(session.guildId) !== session ||
        session.generation !== generation
      ) {
        await this.dependencies.stopAudioCapture(capture.ffmpegProcess);
        return;
      }

      session.ffmpegProcess = capture.ffmpegProcess;
      session.resource = capture.resource;
      capture.resource.volume?.setVolume(session.volume);
      session.player.play(capture.resource);
      console.log(`[voice-manager] Stream restarted in guild ${session.guildId}.`);
    } catch (error) {
      const failedProcess = session.ffmpegProcess;
      session.ffmpegProcess = null;
      session.resource = null;
      session.isStreaming = false;
      await this.dependencies.stopAudioCapture(failedProcess);
      console.error('[voice-manager] Auto-restart failed; stream stopped:', error);
    } finally {
      session.isRestarting = false;
    }
  }

  setVolume(guildId: string, volume: number): void {
    const session = this.sessions.get(guildId);
    if (!session) {
      throw new Error('Bot is not connected to a voice channel.');
    }

    const clamped = Math.max(0, Math.min(1, volume));
    session.volume = clamped;
    session.resource?.volume?.setVolume(clamped);
    console.log(`[voice-manager] Volume set to ${(clamped * 100).toFixed(0)}% in guild ${guildId}.`);
  }

  getSession(guildId: string): StreamSession | undefined {
    return this.sessions.get(guildId);
  }

  async leave(guildId: string): Promise<void> {
    await this.runGuildOperation(guildId, () => this.leaveCurrentSession(guildId));
  }

  private async leaveCurrentSession(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) return;

    await this.destroySession(session);
    console.log(`[voice-manager] Left voice channel in guild ${guildId}.`);
  }

  async leaveAll(): Promise<void> {
    this.acceptingOperations = false;
    await Promise.all([...this.guildOperations.values()]);
    await Promise.all([...this.sessions.values()].map((session) => this.destroySession(session)));
  }

  private async destroySession(session: StreamSession): Promise<void> {
    session.generation += 1;
    session.isStarting = false;
    session.isStreaming = false;
    session.isRestarting = false;

    if (this.sessions.get(session.guildId) === session) {
      this.sessions.delete(session.guildId);
    }

    try {
      session.player.stop();
    } catch (error) {
      console.error('[voice-manager] Failed to stop audio player during cleanup:', error);
    }
    const process = session.ffmpegProcess;
    session.ffmpegProcess = null;
    session.resource = null;
    try {
      await this.dependencies.stopAudioCapture(process);
    } catch (error) {
      console.error('[voice-manager] Failed to stop FFmpeg during cleanup:', error);
    }

    try {
      if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        session.connection.destroy();
      }
    } catch (error) {
      console.error('[voice-manager] Failed to destroy voice connection:', error);
    }
  }

  private async runGuildOperation<T>(
    guildId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.acceptingOperations) {
      throw new Error('Voice manager is shutting down.');
    }

    const previousOperation = this.guildOperations.get(guildId) ?? Promise.resolve();
    let releaseOperation: () => void = () => undefined;
    const currentOperation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    this.guildOperations.set(guildId, currentOperation);

    await previousOperation;
    try {
      if (!this.acceptingOperations) {
        throw new Error('Voice manager is shutting down.');
      }
      return await operation();
    } finally {
      releaseOperation();
      if (this.guildOperations.get(guildId) === currentOperation) {
        this.guildOperations.delete(guildId);
      }
    }
  }
}

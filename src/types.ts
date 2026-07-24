import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { AudioPlayer, AudioResource, VoiceConnection } from '@discordjs/voice';

export interface StreamSession {
  connection: VoiceConnection;
  player: AudioPlayer;
  resource: AudioResource | null;
  ffmpegProcess: ChildProcessWithoutNullStreams | null;
  isStreaming: boolean;
  isStarting: boolean;
  isRestarting: boolean;
  generation: number;
  restartAttempts: number;
  volume: number;
  guildId: string;
}

export interface AudioConfig {
  input: string;
  sampleRate: number;
  channels: number;
  format: string;
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  input: '',
  sampleRate: 48000,
  channels: 2,
  format: 's16le',
};

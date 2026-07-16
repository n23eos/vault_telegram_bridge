import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import { errNetwork, errRateLimited, errTranscriptionFailed } from './errors';

export interface TranscriptionFile {
  fileName: string;
  data: ArrayBuffer;
}

export interface TranscriptionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Transcriber {
  transcribe(file: TranscriptionFile, config: TranscriptionConfig): Promise<string>;
}

type Request = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

export class OpenAITranscriber implements Transcriber {
  constructor(
    private readonly request: Request = async (params) => requestUrl(params),
    private readonly boundary: () => string = () => `----vault-telegram-${crypto.randomUUID()}`,
  ) {}

  async transcribe(file: TranscriptionFile, config: TranscriptionConfig): Promise<string> {
    const boundary = this.boundary();
    let response: RequestUrlResponse;
    try {
      response = await this.request({
        url: `${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: buildMultipart({ ...file, fileName: sttFileName(file.fileName) }, config.model, boundary),
        throw: false,
      });
    } catch (error) {
      // Transport-level failure: retryable, same as any other network error.
      throw errNetwork(error);
    }

    // 429 and 5xx are the provider's "try again later" — surface them as the
    // retryable errors the engine already knows how to retry.
    if (response.status === 429) throw errRateLimited(30);
    if (response.status >= 500) throw errNetwork();
    if (response.status < 200 || response.status >= 300) {
      throw errTranscriptionFailed(`HTTP ${response.status}`);
    }

    let body: { text?: unknown } | undefined;
    try {
      // `json` is a lazy parse in Obsidian's RequestUrlResponse; a 2xx with an
      // HTML body (reverse-proxy landing page) throws right here.
      body = response.json as { text?: unknown } | undefined;
    } catch (error) {
      throw errTranscriptionFailed('invalid response', error);
    }
    // Empty text on a 2xx is a silent recording, not a failure.
    return typeof body?.text === 'string' ? body.text.trim() : '';
  }
}

/**
 * Telegram serves voice notes as `.oga` — the audio-only Ogg alias. Whisper
 * hosts (Groq, OpenAI) accept `.ogg` but reject `.oga` by extension, so the
 * upload is renamed; the file in the vault keeps its real name.
 */
export function sttFileName(name: string): string {
  return name.replace(/\.oga$/i, '.ogg');
}

/**
 * 200 ms of 8 kHz mono 16-bit silence — the cheapest valid payload for the
 * settings tab's "Test" button to exercise URL, key and model end to end.
 */
export function silentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const samples = sampleRate / 5;
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  return buffer;
}

export function buildMultipart(file: TranscriptionFile, model: string, boundary: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const safeName = file.fileName.replace(/"/g, '_').replace(/[\r\n]+/g, '_');
  const prefix = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n${model}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const output = new Uint8Array(prefix.byteLength + file.data.byteLength + suffix.byteLength);
  output.set(prefix, 0);
  output.set(new Uint8Array(file.data), prefix.byteLength);
  output.set(suffix, prefix.byteLength + file.data.byteLength);
  return output.buffer;
}

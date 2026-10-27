import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  type VideoSample,
} from 'mediabunny';
import type { Template } from '@override-studio/shared';
import { sampleAt, type Activity } from './telemetry.js';
import { drawOverlay } from './overlay.js';
import type { Units } from './format.js';

export interface RenderOptions {
  file: Blob;
  activity: Activity;
  offsetSec: number;
  template: Template;
  units: Units;
  includeAudio: boolean;
  /** Trim range in seconds of the source timeline. Defaults to the full video. */
  trimStart?: number;
  trimEnd?: number | null;
  /** Optional visible canvas: doubles as live render preview. */
  canvas?: HTMLCanvasElement;
  onProgress?: (renderedSec: number, totalSec: number) => void;
}

function drawSample(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sample: VideoSample,
): void {
  // sample.draw() already applies rotation, flip and aspect adjustments, and
  // the canvas is sized to displayWidth/displayHeight, so a plain fill is
  // exact. A manual transform here would rotate the frame twice.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  sample.draw(ctx, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ponytail: passthrough only for AAC/MP3; other input codecs lose their audio track
// silently — upgrade by decoding/re-encoding via AudioBufferSource.
const PASSTHROUGH_AUDIO = new Set(['aac', 'mp3']);

/**
 * Full-frame render: decode → paint frame + telemetry overlay → encode → mux.
 * Audio is copied packet-by-packet (no re-encode) when the codec allows it.
 */
export async function renderVideo(options: RenderOptions): Promise<Blob> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(options.file) });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('El video no tiene pista de imagen legible.');
    const duration = await input.computeDuration([videoTrack]);
    const start = Math.min(Math.max(options.trimStart ?? 0, 0), duration);
    const end = Math.min(Math.max(options.trimEnd ?? duration, 0), duration);
    if (!(end > start)) throw new Error('Rango de recorte inválido.');
    const outDuration = end - start;

    const sink = new VideoSampleSink(videoTrack);
    const firstTimestamp = await input.getFirstTimestamp([videoTrack]);
    const probe = await sink.getSample(firstTimestamp);
    if (!probe) throw new Error('No se pudo decodificar el primer frame.');
    const frameW = probe.displayWidth;
    const frameH = probe.displayHeight;
    probe.close();

    const canvas = options.canvas ?? document.createElement('canvas');
    canvas.width = frameW;
    canvas.height = frameH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear el lienzo de render.');

    const target = new BufferTarget();
    const output = new Output({
      // ponytail: 'in-memory' fast-start holds the whole file in RAM (ceiling: long
      // high-res clips); upgrade to StreamTarget + fastStart 'fragmented' if needed.
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    const canvasSource = new CanvasSource(canvas, {
      codec: 'avc',
      // ponytail: fixed 'high' quality, no size/quality control; upgrade by exposing a quality option.
      quality: new Quality('high'),
    });
    output.addVideoTrack(canvasSource);

    let audioSource: EncodedAudioPacketSource | null = null;
    const audioTrack = options.includeAudio ? await input.getPrimaryAudioTrack() : null;
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
    if (audioTrack && audioCodec && PASSTHROUGH_AUDIO.has(audioCodec)) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
    }
    await output.start();

    if (audioSource && audioTrack) {
      const decoderConfig = await audioTrack.getDecoderConfig();
      const packetSink = new EncodedPacketSink(audioTrack);
      let first = true;
      for await (const packet of packetSink.packets()) {
        const packetEnd = packet.timestamp + packet.duration;
        if (packetEnd <= start || packet.timestamp >= end) continue;
        const shifted = new EncodedPacket(
          packet.data,
          packet.type,
          packet.timestamp - start,
          packet.duration,
          packet.sequenceNumber,
          packet.byteLength,
          packet.sideData,
        );
        await audioSource.add(shifted, first && decoderConfig ? { decoderConfig } : undefined);
        first = false;
      }
    }

    let frames = 0;
    for await (const sample of sink.samples(start, end)) {
      try {
        drawSample(ctx, canvas, sample);
        const tt = sample.timestamp + options.offsetSec;
        const telemetry = sampleAt(options.activity, tt);
        drawOverlay(ctx, options.template, telemetry, canvas.width, canvas.height, options.units, {
          activity: options.activity,
          t: tt,
        });
        await canvasSource.add(sample.timestamp - start, sample.duration);
        frames += 1;
        options.onProgress?.(sample.timestamp - start, outDuration);
      } finally {
        sample.close();
      }
    }
    if (frames === 0) throw new Error('El video no produjo ningún frame.');

    await output.finalize();
    if (!target.buffer) throw new Error('El render no produjo salida.');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}

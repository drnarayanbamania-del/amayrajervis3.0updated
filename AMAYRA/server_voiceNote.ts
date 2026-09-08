/**
 * AMAYRA — Telegram voice-note pipeline.
 *
 * Renders reply text with AMAYRA's own voice (Gemini TTS, the same Aoede
 * voice as her Live calls) and packages it as an OGG/Opus voice note that
 * Telegram plays inline.
 *
 * Pipeline: text → Gemini TTS (24 kHz 16-bit PCM) → 20 ms Opus frames
 * (opusscript, VOIP mode) → OggS container → Telegram sendVoice.
 *
 * Voice notes are limited to ~60s by Telegram's player UX; the TTS prompt
 * and input length are capped accordingly. Everything is best-effort: any
 * failure returns null and the caller falls back to a text reply.
 */

import { GoogleGenAI } from "@google/genai";
import OpusScript from "opusscript";

/** Sampling rates the Opus encoder accepts. */
const OPUS_RATES = [8000, 12000, 16000, 24000, 48000] as const;
type OpusRate = (typeof OPUS_RATES)[number];

function nearestOpusRate(rate: number): OpusRate {
  return OPUS_RATES.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best,
  );
}

/** Telegram voice notes should stay short — cap the spoken characters. */
const MAX_SPEECH_CHARS = 420;

/** Telegram accepts OGG/Opus; the muxer always emits little-endian CRCs. */
const CRC32_TABLE = (() => {
  // Ogg uses a non-reflected CRC-32 (poly 0x04c11db7, MSB-first, init 0).
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i << 24;
    for (let k = 0; k < 8; k += 1) c = (c << 1) ^ (c & 0x80000000 ? 0x04c11db7 : 0);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = ((crc << 8) ^ CRC32_TABLE[((crc >>> 24) ^ bytes[i]) & 0xFF]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * Minimal OggS muxer: wraps Opus packets into a valid Ogg physical stream
 * (OpusHead BOS page + one page per packet + OpusTags EOS page).
 *
 * Ogg page header layout (RFC 3533 / RFC 7845):
 *   0-3 magic · 4 version · 5 header type · 6-13 granule (u64)
 *   14-17 bitstream serial · 18-21 page sequence · 22-25 CRC · 26 segment count
 */
export function muxOpusToOgg(opusPackets: Buffer[], pcmSampleRate: number): Buffer {
  const chunks: Buffer[] = [];
  const serial = 0x414D5952; // "AMAYR" — arbitrary fixed bitstream serial
  let sequence = 0;
  let granule = 0;
  const SAMPLES_PER_PACKET = 960; // 20 ms at Opus's 48 kHz output timebase

  const page = (payload: Buffer, headerType: number, granulePos: number): Buffer => {
    // Lacing: 255-byte segments followed by the remainder (RFC 3533 §4).
    const fullSegments = Math.floor(payload.length / 255);
    const remainder = payload.length % 255;
    const segCount = fullSegments + (remainder > 0 || payload.length === 0 ? 1 : 0);
    const lacing = Buffer.alloc(segCount);
    lacing.fill(255, 0, fullSegments);
    if (remainder > 0 || payload.length === 0) lacing[fullSegments] = remainder;
    const header = Buffer.alloc(27);
    header.write("OggS", 0, "ascii");
    header.writeUInt8(0, 4); // stream structure version
    header.writeUInt8(headerType, 5);
    header.writeBigUInt64LE(BigInt(granulePos), 6);
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(sequence, 18);
    header.writeUInt32LE(0, 22); // CRC placeholder (must be zero while hashing)
    header.writeUInt8(segCount, 26);
    const body = Buffer.concat([lacing, payload]);
    header.writeUInt32LE(crc32(Buffer.concat([header, body])), 22);
    sequence += 1;
    return Buffer.concat([header, body]);
  };

  // Opus identification header ("OpusHead", 19 bytes, RFC 7845 §4.2).
  const idHeader = Buffer.alloc(19);
  idHeader.write("OpusHead", 0, "ascii");
  idHeader.writeUInt8(1, 8); // version
  idHeader.writeUInt8(1, 9); // channel count
  idHeader.writeUInt16LE(0, 10); // pre-skip
  idHeader.writeUInt32LE(pcmSampleRate, 12); // original input sample rate
  idHeader.writeUInt16LE(0, 16); // output gain
  idHeader.writeUInt8(0, 18); // channel mapping family
  chunks.push(page(idHeader, 0x02, 0)); // BOS page, granule 0

  for (const packet of opusPackets) {
    granule += SAMPLES_PER_PACKET;
    chunks.push(page(packet, 0x00, granule));
  }

  // Comment header ("OpusTags" with an empty vendor string).
  const comment = Buffer.alloc(12);
  comment.write("OpusTags", 0, "ascii");
  comment.writeUInt32LE(0, 8); // vendor string length = 0
  chunks.push(page(comment, 0x04, granule)); // EOS flag on the final page

  return Buffer.concat(chunks);
}

/**
 * Duration of an Ogg/Opus stream in whole seconds, read from the highest Opus
 * granule position (48 kHz timebase). Telegram's player shows 0:00 unless the
 * duration is provided, so callers pass this to sendVoice.
 */
export function readOpusDurationSeconds(ogg: Buffer): number {
  let maxGranule = 0;
  for (let off = 0; off + 27 <= ogg.length; ) {
    if (ogg.subarray(off, off + 4).toString("ascii") !== "OggS") break;
    const segCount = ogg[off + 26];
    let bodyLen = 0;
    for (let i = 0; i < segCount; i += 1) bodyLen += ogg[off + 27 + i];
    const granule = Number(ogg.readBigUInt64LE(off + 6));
    if (granule > maxGranule) maxGranule = granule;
    off += 27 + segCount + bodyLen;
  }
  return Math.round(maxGranule / 48000);
}

/**
 * Synthesize `text` with AMAYRA's Live voice and encode it as an OGG/Opus
 * voice note. Returns null when TTS or encoding is unavailable (caller
 * falls back to a plain text reply).
 */
export async function synthesizeVoiceNote(
  apiKey: string,
  text: string,
  voiceName = "Aoede",
): Promise<Buffer | null> {
  const spoken = text.replace(/\p{Extended_Pictographic}/gu, "").trim().slice(0, MAX_SPEECH_CHARS);
  if (!spoken) return null;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: spoken }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    });
    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const mime = part?.inlineData?.mimeType ?? "audio/L16;rate=24000";
    const base64 = part?.inlineData?.data;
    if (!base64) return null;

    const rateMatch = /rate=(\d+)/.exec(mime);
    const rawRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const sampleRate = nearestOpusRate(Math.max(8000, Math.min(48000, rawRate)));
    const pcm = Buffer.from(base64, "base64");
    if (pcm.length < 480 * 2) return null;

    // Frame 20 ms chunks of s16le mono PCM and encode each with Opus.
    const bytesPerFrame = Math.round(sampleRate * 0.02) * 2;
    const encoder = new OpusScript(sampleRate, 1, OpusScript.Application.VOIP);
    const packets: Buffer[] = [];
    for (let offset = 0; offset + bytesPerFrame <= pcm.length; offset += bytesPerFrame) {
      const samples = bytesPerFrame / 2;
      packets.push(encoder.encode(pcm.subarray(offset, offset + bytesPerFrame), samples));
    }
    if (!packets.length) return null;
    return muxOpusToOgg(packets, sampleRate);
  } catch {
    return null;
  }
}

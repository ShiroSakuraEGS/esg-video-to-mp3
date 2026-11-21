/** Encode an AudioBuffer (optionally trimmed) to an MP3 Blob with lamejs. */
const BLOCK = 1152;

function floatToInt16(input, start, end) {
  const len = end - start;
  const out = new Int16Array(len);
  for (let i = 0; i < len; i += 1) {
    const s = Math.max(-1, Math.min(1, input[start + i] || 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downmix(buffer, start, end) {
  const len = end - start;
  const left = new Float32Array(len);
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i += 1) left[i] += data[start + i] || 0;
  }
  if (ch > 0) {
    for (let i = 0; i < len; i += 1) left[i] /= ch;
  }
  return left;
}

export function encodeAudioBufferToMp3(buffer, { bitrate = 192, startSec = 0, endSec = null, onProgress } = {}) {
  if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
    throw new Error('lamejs is not loaded');
  }
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.floor((startSec || 0) * rate));
  const rawEnd = endSec == null || endSec === '' ? buffer.length : Math.floor(Number(endSec) * rate);
  const end = Math.max(start + 1, Math.min(buffer.length, rawEnd));
  const channels = buffer.numberOfChannels >= 2 ? 2 : 1;
  const encoder = new lamejs.Mp3Encoder(channels, rate, bitrate);
  const parts = [];

  let left;
  let right = null;
  if (channels === 2) {
    left = floatToInt16(buffer.getChannelData(0), start, end);
    right = floatToInt16(buffer.getChannelData(1), start, end);
  } else if (buffer.numberOfChannels > 1) {
    left = floatToInt16(downmix(buffer, start, end), 0, end - start);
  } else {
    left = floatToInt16(buffer.getChannelData(0), start, end);
  }

  const total = left.length;
  for (let i = 0; i < total; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK);
    let buf;
    if (channels === 2) {
      buf = encoder.encodeBuffer(l, right.subarray(i, i + BLOCK));
    } else {
      buf = encoder.encodeBuffer(l);
    }
    if (buf && buf.length) parts.push(buf);
    if (onProgress) onProgress(Math.min(1, (i + BLOCK) / total));
  }
  const flush = encoder.flush();
  if (flush && flush.length) parts.push(flush);
  if (onProgress) onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

export function isMemoryError(err) {
  const msg = String(err && (err.message || err) || '');
  return /memory|out of memory|Array buffer allocation failed|OOM|Maximum call stack/i.test(msg);
}

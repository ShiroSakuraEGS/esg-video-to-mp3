import { FFmpeg } from '../vendor/ffmpeg/esm/index.js';
import { toBlobURL, fetchFile } from '../vendor/ffmpeg-util/esm/index.js';
import { encodeAudioBufferToMp3, isMemoryError } from './mp3-encoder.js';

/** Soft warning / hard reject. Hard cap protects typical tab memory. */
export const SOFT_LIMIT = 80 * 1024 * 1024;
export const HARD_LIMIT = 256 * 1024 * 1024;

const AUDIO_EXTS = new Set(['wav', 'wave', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aiff', 'aif', 'wma']);
const KNOWN_EXTS = new Set([
  ...AUDIO_EXTS,
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', 'm4v', '3gp', '3gpp', 'ts', 'mts',
]);

let ffmpeg = null;
let ffmpegLoading = null;

const coreBase = new URL('../vendor/ffmpeg-core/', import.meta.url);

export function extensionOf(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function mp3NameFor(name) {
  const base = String(name || 'audio').split(/[\\/]/).pop() || 'audio';
  const i = base.lastIndexOf('.');
  return (i >= 0 ? base.slice(0, i) : base) + '.mp3';
}

export function formatBytes(n, bytesLabel = 'B') {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} ${bytesLabel}`;
  const units = ['KB', 'MB', 'GB'];
  let v = n;
  let u = -1;
  do { v /= 1024; u += 1; } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v >= 10 || u === 0 ? 1 : 2)} ${units[u]}`;
}

export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec * 10) / 10;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(s % 1 ? 1 : 0);
  return m > 0 ? `${m}:${String(r).padStart(4, '0')}` : `${s.toFixed(s % 1 ? 1 : 0)}s`;
}

export function looksLikeKnownMedia(file) {
  const ext = extensionOf(file.name);
  if (KNOWN_EXTS.has(ext)) return true;
  const t = file.type || '';
  return t.startsWith('audio/') || t.startsWith('video/');
}

function preferBrowserDecode(file) {
  const ext = extensionOf(file.name);
  const t = file.type || '';
  if (AUDIO_EXTS.has(ext)) return true;
  if (t.startsWith('audio/') && !t.includes('matroska')) return true;
  return false;
}

export function readMediaDuration(file, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const ext = extensionOf(file.name);
    const el = document.createElement(
      (file.type || '').startsWith('audio/') || AUDIO_EXTS.has(ext) ? 'audio' : 'video',
    );
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const d = el.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    el.onerror = () => finish(null);
    setTimeout(() => finish(null), timeoutMs);
    el.src = url;
  });
}

export async function loadFfmpeg(onStatus) {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async () => {
    if (onStatus) onStatus('loadingEngine');
    const inst = new FFmpeg();
    const coreURL = await toBlobURL(new URL('ffmpeg-core.js', coreBase).href, 'text/javascript');
    const wasmURL = await toBlobURL(new URL('ffmpeg-core.wasm', coreBase).href, 'application/wasm');
    await inst.load({ coreURL, wasmURL });
    ffmpeg = inst;
    return inst;
  })();
  try {
    return await ffmpegLoading;
  } catch (err) {
    ffmpegLoading = null;
    throw err;
  }
}

async function decodeWithWebAudio(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const data = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data.slice(0));
    return buffer;
  } finally {
    if (ctx.state !== 'closed' && ctx.close) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  }
}

function safeId() {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ffmpegToMp3(file, { bitrate, startSec, endSec, onProgress, onLog }) {
  const inst = await loadFfmpeg();
  const inName = `in_${safeId()}.${extensionOf(file.name) || 'bin'}`;
  const outName = `out_${safeId()}.mp3`;
  const wavName = `out_${safeId()}.wav`;
  const progressHandler = ({ progress }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress || 0)));
  };
  const logHandler = ({ message }) => { if (onLog) onLog(message); };
  inst.on('progress', progressHandler);
  inst.on('log', logHandler);
  try {
    await inst.writeFile(inName, await fetchFile(file));
    const args = ['-i', inName];
    if (startSec && startSec > 0) args.push('-ss', String(startSec));
    if (endSec != null && endSec !== '' && Number(endSec) > 0) args.push('-to', String(endSec));
    args.push('-vn', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, outName);
    let code = await inst.exec(args);
    let data = null;
    if (code === 0) {
      try { data = await inst.readFile(outName); } catch { data = null; }
    }
    if (!data || !data.length) {
      // libmp3lame may be missing in some builds — decode to WAV, encode with lamejs
      const wavArgs = ['-i', inName];
      if (startSec && startSec > 0) wavArgs.push('-ss', String(startSec));
      if (endSec != null && endSec !== '' && Number(endSec) > 0) wavArgs.push('-to', String(endSec));
      wavArgs.push('-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', wavName);
      code = await inst.exec(wavArgs);
      if (code !== 0) throw new Error('ffmpeg-failed');
      const wav = await inst.readFile(wavName);
      const wavBlob = new Blob([wav], { type: 'audio/wav' });
      const buffer = await decodeWithWebAudio(wavBlob);
      data = null;
      const blob = encodeAudioBufferToMp3(buffer, { bitrate, onProgress });
      return blob;
    }
    if (onProgress) onProgress(1);
    return new Blob([data], { type: 'audio/mpeg' });
  } finally {
    inst.off('progress', progressHandler);
    inst.off('log', logHandler);
    for (const n of [inName, outName, wavName]) {
      try { await inst.deleteFile(n); } catch { /* missing is fine */ }
    }
  }
}

export function validateTrim(startSec, endSec, duration) {
  const hasStart = startSec !== '' && startSec != null;
  const hasEnd = endSec !== '' && endSec != null;
  const s = hasStart ? Number(startSec) : 0;
  const e = hasEnd ? Number(endSec) : (duration != null ? Number(duration) : null);
  if (hasStart && (!Number.isFinite(s) || s < 0)) return false;
  if (hasEnd && (!Number.isFinite(e) || e <= s)) return false;
  if (duration != null && Number.isFinite(duration)) {
    if (s >= duration) return false;
    if (hasEnd && e > duration + 0.05) return false;
  }
  return true;
}

export async function convertToMp3(file, options) {
  const {
    bitrate = 192,
    startSec = 0,
    endSec = null,
    onProgress,
    onStatus,
    onEngine,
  } = options || {};

  if (file.size > HARD_LIMIT) {
    const err = new Error('too-large');
    err.code = 'too-large';
    throw err;
  }

  const tryBrowser = preferBrowserDecode(file);
  if (tryBrowser) {
    try {
      if (onStatus) onStatus('decoding');
      if (onEngine) onEngine('browser');
      const buffer = await decodeWithWebAudio(file);
      if (onStatus) onStatus('encoding');
      const blob = encodeAudioBufferToMp3(buffer, {
        bitrate,
        startSec: startSec || 0,
        endSec,
        onProgress,
      });
      if (!blob.size) throw new Error('empty-output');
      return { blob, engine: 'browser' };
    } catch (err) {
      if (err.code === 'too-large') throw err;
      if (isMemoryError(err)) {
        const m = new Error('memory');
        m.code = 'memory';
        throw m;
      }
      // fall through to ffmpeg
    }
  }

  try {
    if (onStatus) onStatus('loadingEngine');
    if (onEngine) onEngine('ffmpeg');
    await loadFfmpeg(onStatus);
    if (onStatus) onStatus('encoding');
    const blob = await ffmpegToMp3(file, {
      bitrate,
      startSec: startSec || 0,
      endSec,
      onProgress,
    });
    if (!blob.size) throw new Error('empty-output');
    return { blob, engine: 'ffmpeg' };
  } catch (err) {
    if (err.code === 'too-large' || err.code === 'memory') throw err;
    if (isMemoryError(err)) {
      const m = new Error('memory');
      m.code = 'memory';
      throw m;
    }
    const msg = String(err && (err.message || err) || '');
    if (/load|fetch|Import|ENGINE|wasm/i.test(msg) && !/ffmpeg-failed|empty/.test(msg)) {
      const e = new Error('engine');
      e.code = 'engine';
      throw e;
    }
    const e = new Error('unsupported');
    e.code = 'unsupported';
    e.cause = err;
    throw e;
  }
}

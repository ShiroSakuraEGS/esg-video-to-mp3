import { STR } from './i18n.js';
import {
  SOFT_LIMIT, HARD_LIMIT,
  mp3NameFor, formatBytes, formatDuration, looksLikeKnownMedia,
  readMediaDuration, convertToMp3, validateTrim,
} from './converter.js';

const ACCEPT = '.mp4,.mov,.webm,.mkv,.m4a,.wav,.mp3,.aac,.ogg,.oga,.opus,.flac,.avi,.mpeg,.mpg,.m4v,.3gp,.aiff,.aif';

const state = {
  lang: localStorage.getItem('ci002-lang') === 'en' ? 'en' : 'zh',
  items: [],
  busy: false,
  idSeq: 1,
};

const $ = (sel, root = document) => root.querySelector(sel);

function t(key) {
  return (STR[state.lang] && STR[state.lang][key]) || STR.zh[key] || key;
}

function applyStaticText() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hant';
  document.title = t('docTitle');
  $('[data-i18n="title"]').textContent = t('title');
  $('[data-i18n="tagline"]').textContent = t('tagline');
  $('[data-i18n="privacyTitle"]').textContent = t('privacyTitle');
  $('[data-i18n="privacy"]').textContent = t('privacy');
  $('[data-i18n="copyrightTitle"]').textContent = t('copyrightTitle');
  $('[data-i18n="copyright"]').textContent = t('copyright');
  $('[data-i18n="drop"]').textContent = t('drop');
  $('[data-i18n="pick"]').textContent = t('pick');
  $('[data-i18n="bitrate"]').textContent = t('bitrate');
  $('[data-i18n="queue"]').textContent = t('queue');
  $('[data-i18n="convertAll"]').textContent = t('convertAll');
  $('[data-i18n="clearDone"]').textContent = t('clearDone');
  $('[data-i18n="clearAll"]').textContent = t('clearAll');
  $('[data-i18n="formats"]').textContent = t('formats');
  $('[data-i18n="footerLic"]').textContent = t('footerLic');
  $('[data-i18n="trimHint"]').textContent = t('trimHint');
  for (const btn of document.querySelectorAll('[data-lang]')) {
    btn.setAttribute('aria-pressed', btn.dataset.lang === state.lang ? 'true' : 'false');
  }
}

function bitrate() {
  return Number($('#bitrate').value) || 192;
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    const item = {
      id: state.idSeq++,
      file,
      name: file.name,
      size: file.size,
      duration: null,
      start: '',
      end: '',
      status: 'waiting',
      progress: 0,
      error: null,
      blob: null,
      engine: null,
      warning: file.size > SOFT_LIMIT && file.size <= HARD_LIMIT,
    };
    if (file.size > HARD_LIMIT) {
      item.status = 'error';
      item.error = 'errTooLarge';
    } else if (!looksLikeKnownMedia(file)) {
      // still allow attempt, but flag; duration read may fail
      item.unknownType = true;
    }
    state.items.push(item);
    readMediaDuration(file).then((d) => {
      item.duration = d;
      renderQueue();
    });
  }
  renderQueue();
}

function itemById(id) {
  return state.items.find((x) => x.id === Number(id));
}

function statusText(item) {
  if (item.status === 'error') return t(item.error || 'errConvert');
  if (item.status === 'done') {
    const via = item.engine === 'ffmpeg' ? t('viaFfmpeg') : t('viaBrowser');
    return `${t('done')} · ${t('engineVia')}：${via}`;
  }
  if (item.status === 'converting') return t(item.phase || 'encoding');
  return t('waiting');
}

function renderQueue() {
  const list = $('#queue-list');
  if (!state.items.length) {
    list.innerHTML = `<p class="hint" data-testid="empty-queue">${t('emptyQueue')}</p>`;
    return;
  }
  list.innerHTML = state.items.map((item) => {
    const dur = item.duration == null ? t('unknownDur') : formatDuration(item.duration);
    const warn = item.warning ? `<div class="status info">${t('warnLarge')}</div>` : '';
    const canDl = item.status === 'done' && item.blob;
    const canRun = !state.busy && (item.status === 'waiting' || (item.status === 'error' && item.error !== 'errTooLarge'));
    const retry = item.status === 'error' && item.error !== 'errTooLarge';
    return `
      <article class="item" data-testid="queue-item" data-id="${item.id}" data-status="${item.status}">
        <div class="item-top">
          <div>
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="meta">${t('size')}：${formatBytes(item.size)} · ${t('duration')}：<span data-testid="duration">${escapeHtml(dur)}</span></div>
          </div>
        </div>
        ${warn}
        <div class="trim-row">
          <label class="field">${t('trimStart')}
            <input type="number" min="0" step="0.1" inputmode="decimal" data-field="start" value="${item.start}" ${state.busy ? 'disabled' : ''} aria-label="${t('trimStart')}">
          </label>
          <label class="field">${t('trimEnd')}
            <input type="number" min="0" step="0.1" inputmode="decimal" data-field="end" value="${item.end}" ${state.busy ? 'disabled' : ''} aria-label="${t('trimEnd')}">
          </label>
        </div>
        <div class="progress" aria-hidden="true"><span style="width:${Math.round((item.progress || 0) * 100)}%"></span></div>
        <div class="status ${item.status === 'error' ? 'err' : item.status === 'done' ? 'ok' : 'info'}" data-testid="status">${escapeHtml(statusText(item))}${item.status === 'converting' ? ` ${Math.round((item.progress || 0) * 100)}%` : ''}</div>
        <div class="item-actions">
          <button class="btn btn-primary" data-action="convert" ${canRun && !state.busy ? '' : 'disabled'}>${retry ? t('convert') : t('convert')}</button>
          <button class="btn btn-ok" data-action="download" ${canDl ? '' : 'disabled'} data-testid="download">${t('download')}</button>
          <button class="btn btn-ghost" data-action="remove" ${state.busy && item.status === 'converting' ? 'disabled' : ''}>${t('remove')}</button>
        </div>
      </article>`;
  }).join('');
  $('#convert-all').disabled = state.busy || !state.items.some((i) => i.status === 'waiting' || (i.status === 'error' && i.error !== 'errTooLarge'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function runOne(item) {
  if (item.size > HARD_LIMIT) {
    item.status = 'error';
    item.error = 'errTooLarge';
    renderQueue();
    return;
  }
  if (!validateTrim(item.start, item.end, item.duration)) {
    item.status = 'error';
    item.error = 'errTrim';
    renderQueue();
    return;
  }
  item.status = 'converting';
  item.progress = 0;
  item.error = null;
  item.blob = null;
  item.phase = 'decoding';
  renderQueue();
  try {
    const startSec = item.start === '' ? 0 : Number(item.start);
    const endSec = item.end === '' ? null : Number(item.end);
    const result = await convertToMp3(item.file, {
      bitrate: bitrate(),
      startSec,
      endSec,
      onProgress: (p) => { item.progress = p; renderQueue(); },
      onStatus: (phase) => { item.phase = phase; renderQueue(); },
      onEngine: (engine) => { item.engine = engine; },
    });
    item.blob = result.blob;
    item.engine = result.engine;
    item.status = 'done';
    item.progress = 1;
  } catch (err) {
    item.status = 'error';
    item.progress = 0;
    const map = {
      'too-large': 'errTooLarge',
      memory: 'errMemory',
      engine: 'errEngine',
      unsupported: 'errUnsupported',
    };
    item.error = map[err.code] || 'errConvert';
    console.warn('convert failed', item.name, err);
  }
  renderQueue();
}

async function runQueue(which) {
  if (state.busy) return;
  const targets = which
    ? [which]
    : state.items.filter((i) => i.status === 'waiting' || (i.status === 'error' && i.error !== 'errTooLarge' && i.error !== 'errTrim'));
  // If convert all, also include waiting only; trim errors stay until user fixes
  state.busy = true;
  renderQueue();
  for (const item of targets) {
    if (!state.items.includes(item)) continue;
    await runOne(item);
  }
  state.busy = false;
  renderQueue();
}

function downloadItem(item) {
  if (!item.blob) return;
  const url = URL.createObjectURL(item.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = mp3NameFor(item.name);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function bind() {
  const drop = $('#drop');
  const input = $('#file-input');
  drop.addEventListener('dragenter', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', (e) => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('dragover');
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });
  $('#pick-btn').addEventListener('click', () => input.click());
  $('#convert-all').addEventListener('click', () => runQueue());
  $('#clear-done').addEventListener('click', () => {
    state.items = state.items.filter((i) => i.status !== 'done');
    renderQueue();
  });
  $('#clear-all').addEventListener('click', () => {
    if (state.busy) return;
    state.items = [];
    renderQueue();
  });
  $('#queue-list').addEventListener('input', (e) => {
    const article = e.target.closest('[data-id]');
    if (!article) return;
    const item = itemById(article.dataset.id);
    if (!item) return;
    if (e.target.dataset.field === 'start') item.start = e.target.value;
    if (e.target.dataset.field === 'end') item.end = e.target.value;
  });
  $('#queue-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const article = btn.closest('[data-id]');
    const item = itemById(article.dataset.id);
    if (!item) return;
    if (btn.dataset.action === 'convert') runQueue(item);
    if (btn.dataset.action === 'download') downloadItem(item);
    if (btn.dataset.action === 'remove') {
      if (state.busy && item.status === 'converting') return;
      state.items = state.items.filter((x) => x !== item);
      renderQueue();
    }
  });
  document.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      localStorage.setItem('ci002-lang', state.lang);
      applyStaticText();
      renderQueue();
    });
  });
}

applyStaticText();
bind();
renderQueue();

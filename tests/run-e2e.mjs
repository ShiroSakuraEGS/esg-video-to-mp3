/**
 * CI-2026-002 e2e: serve site/ without COOP/COEP, convert fixtures in Chromium,
 * verify MP3 with ffprobe, capture screenshots.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const FIX = path.join(ROOT, 'fixtures');
const SHOTS = path.join(ROOT, 'screenshots');
const OUT = path.join(ROOT, 'tests', 'output');

const results = [];
const consoleErrors = [];
const pageErrors = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
}

function probe(file) {
  const raw = execFileSync('ffprobe', [
    '-hide_banner', '-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type:format=duration,bit_rate',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  const j = JSON.parse(raw);
  const audio = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
  return {
    codec: audio.codec_name,
    duration: Number(j.format?.duration),
    bitRate: Number(j.format?.bit_rate),
  };
}

function startStaticServer(dir, port) {
  return new Promise((resolve, reject) => {
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.wasm': 'application/wasm',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
    };
    const server = createServer(async (req, res) => {
      // Intentionally no COOP/COEP — simulate GitHub Pages.
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let rel = urlPath === '/' ? '/index.html' : urlPath;
        const file = path.normalize(path.join(dir, rel));
        if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
        const data = await fs.readFile(file);
        const ext = path.extname(file);
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function waitDone(page, index = 0, timeout = 180000) {
  const item = page.locator('[data-testid="queue-item"]').nth(index);
  await item.waitFor({ state: 'visible', timeout: 15000 });
  await item.waitFor(async () => {
    // custom not available this way
  }).catch(() => {});
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const status = await item.getAttribute('data-status');
    if (status === 'done') return;
    if (status === 'error') {
      const text = await item.getByTestId('status').innerText();
      throw new Error(`item ${index} error: ${text}`);
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`timeout waiting for item ${index} to finish`);
}

async function downloadItem(page, index, dest) {
  const item = page.locator('[data-testid="queue-item"]').nth(index);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    item.getByTestId('download').click(),
  ]);
  await download.saveAs(dest);
  return download.suggestedFilename();
}

async function convertFiles(page, files) {
  const input = page.getByTestId('file-input');
  await input.setInputFiles(files);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });
  const port = 8765;
  const server = await startStaticServer(SITE, port);
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    locale: 'zh-Hant',
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  try {
    const resp = await page.goto(base, { waitUntil: 'networkidle' });
    const headers = resp.headers();
    const coop = headers['cross-origin-opener-policy'] || headers['Cross-Origin-Opener-Policy'];
    const coep = headers['cross-origin-embedder-policy'] || headers['Cross-Origin-Embedder-Policy'];
    record('AC-01a', !coop && !coep, `COOP=${coop || '(none)'} COEP=${coep || '(none)'}`);
    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    record('AC-01b', isolated === false, `crossOriginIsolated=${isolated}`);
    const privacy = await page.locator('[data-i18n="privacy"]').innerText();
    const hasNotice = /不會離開|never leave/i.test(privacy);
    record('AC-07a', hasNotice, `privacy text present: ${privacy.slice(0, 40)}…`);
    const hasUrlField = await page.locator('input[type="url"], input[name*="url" i]').count();
    record('AC-07b', hasUrlField === 0, `url inputs=${hasUrlField}`);
    await page.screenshot({ path: path.join(SHOTS, '01-desktop-home.png'), fullPage: true });

    // WAV via Web Audio path
    await convertFiles(page, [path.join(FIX, 'sample.wav')]);
    await page.getByTestId('bitrate').selectOption('192');
    await page.locator('[data-testid="queue-item"] button[data-action="convert"]').click();
    await waitDone(page, 0);
    const wavOut = path.join(OUT, 'from-wav.mp3');
    const wavName = await downloadItem(page, 0, wavOut);
    const wavProbe = probe(wavOut);
    record('AC-02-wav', wavProbe.codec === 'mp3' && Math.abs(wavProbe.duration - 5) < 0.35,
      `name=${wavName} codec=${wavProbe.codec} dur=${wavProbe.duration} br=${wavProbe.bitRate}`);
    record('AC-03', wavProbe.codec === 'mp3' && Math.abs(wavProbe.bitRate - 192000) / 192000 < 0.25,
      `bitrate ${wavProbe.bitRate} vs 192000`);
    await page.screenshot({ path: path.join(SHOTS, '02-wav-done.png'), fullPage: true });

    // Video containers (ffmpeg path). Clear queue first.
    await page.locator('#clear-all').click();
    const videos = ['sample.mp4', 'sample.webm', 'sample.mov', 'sample.mkv'];
    for (const name of videos) {
      await convertFiles(page, [path.join(FIX, name)]);
    }
    await page.getByTestId('convert-all').click();
    for (let i = 0; i < videos.length; i += 1) await waitDone(page, i, 240000);
    await page.screenshot({ path: path.join(SHOTS, '03-videos-done.png'), fullPage: true });
    for (let i = 0; i < videos.length; i += 1) {
      const dest = path.join(OUT, videos[i].replace(/\.[^.]+$/, '.mp3'));
      const suggested = await downloadItem(page, i, dest);
      const p = probe(dest);
      const ok = p.codec === 'mp3' && Math.abs(p.duration - 5) < 0.5;
      record(`AC-02-${videos[i]}`, ok, `suggested=${suggested} codec=${p.codec} dur=${p.duration} br=${p.bitRate}`);
    }

    // Trim 1–3 on a fresh mp4
    await page.locator('#clear-all').click();
    await convertFiles(page, [path.join(FIX, 'sample.mp4')]);
    const row = page.locator('[data-testid="queue-item"]').first();
    await row.locator('[data-field="start"]').fill('1');
    await row.locator('[data-field="end"]').fill('3');
    await row.locator('button[data-action="convert"]').click();
    await waitDone(page, 0);
    const trimOut = path.join(OUT, 'trimmed.mp3');
    await downloadItem(page, 0, trimOut);
    const tr = probe(trimOut);
    record('AC-04', tr.codec === 'mp3' && Math.abs(tr.duration - 2) < 0.4,
      `codec=${tr.codec} dur=${tr.duration} (expect ~2s)`);
    await page.screenshot({ path: path.join(SHOTS, '04-trim-done.png'), fullPage: true });

    // Multi-file queue already covered by 4 videos; also wav+m4a together
    await page.locator('#clear-all').click();
    await convertFiles(page, [path.join(FIX, 'sample.wav'), path.join(FIX, 'sample.m4a')]);
    const count = await page.locator('[data-testid="queue-item"]').count();
    await page.getByTestId('convert-all').click();
    await waitDone(page, 0);
    await waitDone(page, 1);
    const multiA = path.join(OUT, 'multi-a.mp3');
    const multiB = path.join(OUT, 'multi-b.mp3');
    const nameA = await downloadItem(page, 0, multiA);
    const nameB = await downloadItem(page, 1, multiB);
    const pa = probe(multiA);
    const pb = probe(multiB);
    record('AC-05', count === 2 && pa.codec === 'mp3' && pb.codec === 'mp3' && nameA.endsWith('.mp3') && nameB.endsWith('.mp3'),
      `count=${count} names=${nameA},${nameB} dur=${pa.duration},${pb.duration}`);
    await page.screenshot({ path: path.join(SHOTS, '05-multi-done.png'), fullPage: true });

    // Unsupported
    await page.locator('#clear-all').click();
    await convertFiles(page, [path.join(FIX, 'not-media.txt')]);
    await page.locator('[data-testid="queue-item"] button[data-action="convert"]').click();
    const start = Date.now();
    let unsupportedOk = false;
    let unsupportedText = '';
    while (Date.now() - start < 120000) {
      const st = await page.locator('[data-testid="queue-item"]').first().getAttribute('data-status');
      if (st === 'error') {
        unsupportedText = await page.getByTestId('status').innerText();
        unsupportedOk = /不支援|Unsupported|無法解碼/i.test(unsupportedText);
        break;
      }
      if (st === 'done') {
        unsupportedText = 'unexpected success';
        break;
      }
      await page.waitForTimeout(300);
    }
    record('AC-err-unsupported', unsupportedOk, unsupportedText);
    await page.screenshot({ path: path.join(SHOTS, '06-unsupported-error.png'), fullPage: true });

    // Mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#clear-all').click();
    await convertFiles(page, [path.join(FIX, 'sample.wav')]);
    await page.screenshot({ path: path.join(SHOTS, '07-mobile-queue.png'), fullPage: true });
    const pickVisible = await page.locator('#pick-btn').isVisible();
    const convertVisible = await page.getByTestId('convert-all').isVisible();
    record('AC-06-mobile-ui', pickVisible && convertVisible, `pick=${pickVisible} convertAll=${convertVisible}`);

    const serious = consoleErrors.filter((t) => !/favicon|Download the React DevTools/i.test(t));
    record('AC-06-console', serious.length === 0 && pageErrors.length === 0,
      `consoleErrors=${JSON.stringify(serious)} pageErrors=${JSON.stringify(pageErrors)}`);
  } finally {
    await browser.close();
    server.close();
  }

  const reportPath = path.join(ROOT, 'docs', 'test-results.json');
  await fs.writeFile(reportPath, JSON.stringify({
    when: new Date().toISOString(),
    isolatedExpected: false,
    results,
    consoleErrors,
    pageErrors,
  }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

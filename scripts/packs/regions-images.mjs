// Converts the cached Commons thumbnails queued by build-regions.mjs into small WebP files
// (max 140px wide) using a headless browser's canvas — the build host has no image tools.
// Usage: node scripts/packs/regions-images.mjs   (needs agent-browser + the playwright headless shell)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const jobs = JSON.parse(fs.readFileSync('scripts/.cache/packs-regions/image-jobs.json', 'utf8'));
const todo = jobs.filter((j) => !fs.existsSync(j.dest) && fs.existsSync(j.src));
console.log(`${jobs.length} images, ${todo.length} to convert`);
if (todo.length) await convertAll();
pruneMissing();

/** Drop flag/arms references whose image could not be produced, and re-check the ≥70% mode rule. */
function pruneMissing() {
  const indexFile = 'public/data/packs/index-regions.json';
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  for (const meta of index) {
    const file = `public/data/packs/${meta.id}.json`;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const it of data.items) for (const k of ['flag', 'arms']) if (it[k] && !fs.existsSync('public' + it[k])) delete it[k];
    for (const k of ['flag', 'arms']) {
      const ok = data.items.filter((it) => it[k]).length / data.items.length >= 0.7;
      meta.modes = meta.modes.filter((m) => m !== k);
      if (ok) meta.modes.push(k);
    }
    data.meta = meta;
    fs.writeFileSync(file, JSON.stringify(data));
  }
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
}

async function convertAll() {
  const PORT = 8767;
  const page = 'scripts/.cache/packs-regions/convert.html';
  fs.writeFileSync(page, `<html><body><script>
  async function convert(srcs, mimes, maxW) {
    const out = [];
    for (let i = 0; i < srcs.length; i++) {
      try {
        const blob = new Blob([await (await fetch(srcs[i])).arrayBuffer()], { type: mimes[i] });
        const bmp = await createImageBitmap(blob);
        const s = Math.min(1, maxW / bmp.width);
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        x.drawImage(bmp, 0, 0, c.width, c.height);
        out.push(c.toDataURL('image/webp', 0.86));
      } catch (e) { out.push(null); }
    }
    return JSON.stringify(out);
  }
  </script></body></html>`);

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const env = { ...process.env, PATH: `${process.env.HOME}/.local/npm/bin:${process.env.PATH}`, AGENT_BROWSER_SESSION: 'regions-images' };
  const shell = fs.readdirSync(`${process.env.HOME}/.cache/ms-playwright`).find((d) => d.startsWith('chromium_headless_shell'));
  const exe = `${process.env.HOME}/.cache/ms-playwright/${shell}/chrome-linux/headless_shell`;
  const ab = (...args) => execFileSync('agent-browser', args, { env, maxBuffer: 64 * 1024 * 1024 }).toString();
  try {
    ab('--executable-path', exe, '--args', '--no-sandbox', 'open', `http://127.0.0.1:${PORT}/${page}`);
    let done = 0, failed = 0;
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      const srcs = JSON.stringify(batch.map((j) => '/' + j.src));
      const mimes = JSON.stringify(batch.map((j) => j.mime));
      const raw = ab('eval', `convert(${srcs}, ${mimes}, 140)`).trim();
      const urls = JSON.parse(JSON.parse(raw));
      urls.forEach((u, k) => {
        if (!u?.startsWith('data:image/webp;base64,')) { failed++; return; }
        fs.mkdirSync(path.dirname(batch[k].dest), { recursive: true });
        fs.writeFileSync(batch[k].dest, Buffer.from(u.slice(23), 'base64'));
        done++;
      });
    }
    console.log(`converted ${done}, failed ${failed}`);
  } finally {
    try { ab('close'); } catch { /* ignore */ }
    server.kill();
  }
}

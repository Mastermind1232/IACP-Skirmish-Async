/**
 * Tiny local dev server for the dice audit dashboard.
 * - Serves tools/dice-audit.html at http://localhost:3030/
 * - Serves vassal_extracted/images/dice/* under /dice-img/*
 * - POST /save { dice: <full json object> } writes to data/dice.json
 *
 * Run: node tools/dice-audit-server.js  (then open http://localhost:3030/)
 */
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 3030;

const HTML_PATH = join(ROOT, 'tools', 'dice-audit.html');
const DICE_PATH = join(ROOT, 'data', 'dice.json');
const DICE_IMG_DIR = join(ROOT, 'vassal_extracted', 'images', 'dice');

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = readFileSync(HTML_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && req.url === '/dice.json') {
      const json = readFileSync(DICE_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(json);
    }

    if (req.method === 'GET' && req.url.startsWith('/dice-img/')) {
      const fileName = decodeURIComponent(req.url.slice('/dice-img/'.length));
      try {
        const buf = readFileSync(join(DICE_IMG_DIR, fileName));
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
        return res.end(buf);
      } catch {
        res.writeHead(404); return res.end('not found');
      }
    }

    if (req.method === 'POST' && req.url === '/save') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'invalid json' })); }
      if (!payload?.dice?.attack || !payload?.dice?.defense) {
        res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'missing attack/defense' }));
      }
      const out = JSON.stringify(payload.dice, null, 2) + '\n';
      writeFileSync(DICE_PATH, out, 'utf8');
      console.log(`[dice-audit] Saved ${out.length} bytes to ${DICE_PATH}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
    }

    res.writeHead(404); res.end('not found');
  } catch (err) {
    console.error('[dice-audit] error:', err);
    res.writeHead(500); res.end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`[dice-audit] http://localhost:${PORT}/`);
  console.log(`[dice-audit] writing to ${DICE_PATH} on POST /save`);
});

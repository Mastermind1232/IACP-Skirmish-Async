/**
 * Serves the CC review tool with a Save endpoint.
 * Run: npm run cc-review
 * Open: http://localhost:3456/scripts/cc-review-tool.html
 * Save button writes directly to data/cc-effects.json.
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = 3456;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost`);
  const pathname = url.pathname === '/' ? '/scripts/cc-review-tool.html' : url.pathname;

  if (req.method === 'POST' && pathname === '/api/save-cc-effects') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const outPath = join(root, 'data', 'cc-effects.json');
      const toWrite = {
        source: data.source || 'CC Review Tool',
        cards: data.cards || {},
      };
      writeFileSync(outPath, JSON.stringify(toWrite, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  const filePath = join(root, pathname.replace(/^\//, ''));
  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`CC Review server: http://localhost:${PORT}/scripts/cc-review-tool.html`);
});

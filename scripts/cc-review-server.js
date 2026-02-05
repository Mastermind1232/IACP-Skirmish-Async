/**
 * Serves the CC review tool with a Save endpoint.
 * Run: npm run cc-review
 * Open: http://localhost:3456/scripts/cc-review-tool.html
 * Save button writes directly to data/cc-effects.json.
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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
  const requestPath = (req.url || '/').split('?')[0];
  const pathname = requestPath === '/' ? '/scripts/cc-review-tool.html' : requestPath;

  if (req.method === 'GET' && pathname === '/api/cc-review-server') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, server: 'cc-review-server' }));
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/cc-image/')) {
    const cardName = decodeURIComponent(pathname.replace('/api/cc-image/', ''));
    const imagesDir = join(root, 'vassal_extracted', 'images');
    const ccDir = join(imagesDir, 'cc');
    // Also check root for backward compatibility
    const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
    const candidates = [];
    if (cardName.trim().toLowerCase() === 'smoke grenade') {
      candidates.push('Smoke Grenade Final.png', '003 Smoke Grenade Final.png');
    }
    // Vassal filenames sometimes drop apostrophes (e.g. "All in a Days Work" vs "All in a Day's Work")
    const noApostrophe = cardName.replace(/'/g, '');
    candidates.push(
      `C card--${cardName}.jpg`,
      `C card--${cardName}.png`,
      `C card--${noApostrophe}.jpg`,
      `C card--${noApostrophe}.png`,
      `C card--${titleCase(cardName.toLowerCase())}.jpg`,
      `C card--${titleCase(cardName.toLowerCase())}.png`,
      `IACP_C card--${cardName}.png`,
      `IACP_C card--${cardName}.jpg`,
      `IACP_C card--${noApostrophe}.png`,
      `IACP_C card--${noApostrophe}.jpg`,
      `IACP9_C card--${cardName}.png`,
      `IACP9_C card--${cardName}.jpg`,
      `IACP9_C card--${noApostrophe}.png`,
      `IACP9_C card--${noApostrophe}.jpg`,
      `IACP10_C card--${cardName}.png`,
      `IACP10_C card--${cardName}.jpg`,
      `IACP11_C card--${cardName}.png`,
      `IACP11_C card--${cardName}.jpg`
    );
    let found = null;
    for (const c of candidates) {
      const inCc = join(ccDir, c);
      if (existsSync(inCc)) {
        found = inCc;
        break;
      }
      const inRoot = join(imagesDir, c);
      if (existsSync(inRoot)) {
        found = inRoot;
        break;
      }
    }
    if (found) {
      try {
        const buf = readFileSync(found);
        const ext = extname(found).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(buf);
      } catch {
        res.writeHead(500);
        res.end('Error reading image');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }
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

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname.replace(/^\//, ''));
  } catch {
    decodedPath = pathname.replace(/^\//, '');
  }
  let filePath = join(root, decodedPath);
  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  // If path is vassal_extracted/images/<name> and file missing, try cc/ subfolder (all CCs nested under cc/)
  if (!existsSync(filePath) && decodedPath.startsWith('vassal_extracted/images/') && !decodedPath.includes('/cc/')) {
    const baseName = decodedPath.replace('vassal_extracted/images/', '');
    const ccPath = join(root, 'vassal_extracted', 'images', 'cc', baseName);
    if (existsSync(ccPath)) filePath = ccPath;
  }

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
  console.log(`CC Effect Editor:  http://localhost:${PORT}/scripts/cc-effect-editor.html`);
  console.log('Save writes to data/cc-effects.json');
});

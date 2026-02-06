/**
 * Serves the CC Effect Editor and Save endpoint.
 * Run: npm run cc-review
 * Open: http://localhost:3456/scripts/cc-effect-editor.html
 * Save writes to data/cc-effects.json.
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
  const pathname = requestPath === '/' ? '/scripts/cc-effect-editor.html' : requestPath;

  if (req.method === 'GET' && pathname === '/api/cc-review-server') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, server: 'cc-review-server' }));
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/cc-image/')) {
    const cardName = decodeURIComponent(pathname.replace('/api/cc-image/', '')).trim();
    const imagesDir = join(root, 'vassal_extracted', 'images');
    const ccDir = join(imagesDir, 'cc');
    const safeFilename = (s) => (s || '').replace(/[/\\?*:|"]/g, '_');
    const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
    const base = safeFilename(cardName);
    const baseIacp = `${base} (IACP)`;
    const noApostrophe = safeFilename(cardName.replace(/'/g, ''));
    const noApostropheIacp = `${noApostrophe} (IACP)`;
    const withoutParen = cardName.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const baseNoParen = withoutParen !== cardName ? safeFilename(withoutParen) : null;
    const exts = ['.png', '.jpg', '.gif'];
    const candidates = [];
    // Preferred: clean names only — "CardName.ext" and "Card Name (IACP).ext". No "C card--" / "IACP*_C card--" except as fallback for old files.
    for (const ext of exts) {
      candidates.push(`${baseIacp}${ext}`, `${noApostropheIacp}${ext}`);
    }
    for (const ext of exts) {
      candidates.push(`${base}${ext}`, `${noApostrophe}${ext}`);
      if (baseNoParen) candidates.push(`${baseNoParen}${ext}`);
    }
    if (cardName.trim().toLowerCase() === 'smoke grenade') {
      candidates.push('Smoke Grenade Final.png', '003 Smoke Grenade Final.png');
    }
    if (cardName.trim().toLowerCase() === 'overcharged weapons') {
      candidates.unshift('Overcharged Weapons.png', 'Overcharged Weapons.jpg', 'Overcharged Wapons.jpg');
    }
    const defLoveNorm = cardName.trim().toLowerCase().replace(/['':]/g, '').replace(/\s+/g, ' ');
    if (defLoveNorm === 'definition love') {
      candidates.unshift('Definition Love.png');
    }
    // Fallback only: legacy Vassal "C card--" / "IACP*_C card--" names (prefer renaming to CardName.png)
    candidates.push(
      `IACP_C card--${cardName}.png`,
      `IACP_C card--${cardName}.jpg`,
      `IACP_C card--${cardName.replace(/'/g, '')}.png`,
      `IACP_C card--${cardName.replace(/'/g, '')}.jpg`,
      `IACP9_C card--${cardName}.png`,
      `IACP9_C card--${cardName}.jpg`,
      `IACP10_C card--${cardName}.png`,
      `IACP10_C card--${cardName}.jpg`,
      `IACP11_C card--${cardName}.png`,
      `IACP11_C card--${cardName}.jpg`,
      `C card--${cardName}.jpg`,
      `C card--${cardName}.png`,
      `C card--${cardName.replace(/'/g, '')}.jpg`,
      `C card--${cardName.replace(/'/g, '')}.png`,
      `C card--${titleCase(cardName.toLowerCase())}.jpg`,
      `C card--${titleCase(cardName.toLowerCase())}.png`
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
        const mime = MIME[ext] || (ext === '.png' ? 'image/png' : 'image/jpeg');
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
  if (req.method === 'POST' && pathname === '/api/save-cc-verified') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const outPath = join(root, 'data', 'cc-verified.json');
      const toWrite = {
        source: 'CC Effect Editor',
        verified: data.verified || [],
        updatedAt: new Date().toISOString(),
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

  if (req.method === 'GET' && pathname.startsWith('/api/dc-image/')) {
    const dcName = decodeURIComponent(pathname.replace('/api/dc-image/', '')).trim();
    let dcImages = {};
    try {
      const dcData = JSON.parse(readFileSync(join(root, 'data', 'dc-images.json'), 'utf8'));
      dcImages = dcData.dcImages || {};
    } catch (_) {}
    const relPath = dcImages[dcName] || dcImages[dcName.replace(/\s*\([^)]*\)\s*$/, '').trim()];
    if (!relPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const filePath = join(root, relPath);
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const buf = readFileSync(filePath);
      const ext = extname(filePath).toLowerCase();
      const mime = MIME[ext] || (ext === '.png' ? 'image/png' : 'image/jpeg');
      res.writeHead(200, { 'Content-Type': mime });
      res.end(buf);
    } catch {
      res.writeHead(500);
      res.end('Error reading image');
    }
    return;
  }
  if (req.method === 'POST' && pathname === '/api/save-dc-effects') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const outPath = join(root, 'data', 'dc-effects.json');
      const toWrite = {
        source: data.source || 'DC Effect Editor',
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
  if (req.method === 'POST' && pathname === '/api/save-dc-verified') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const outPath = join(root, 'data', 'dc-verified.json');
      const toWrite = {
        source: 'DC Effect Editor',
        verified: data.verified || [],
        updatedAt: new Date().toISOString(),
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
  console.log(`CC Effect Editor: http://localhost:${PORT}/scripts/cc-effect-editor.html`);
  console.log(`DC Effect Editor: http://localhost:${PORT}/scripts/dc-effect-editor.html`);
  console.log('CC save → data/cc-effects.json | DC save → data/dc-effects.json');
});

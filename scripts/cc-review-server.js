/**
 * Serves the CC Effect Editor and Save endpoint.
 * Run: npm run cc-review
 * Open: http://localhost:3456/scripts/cc-effect-editor.html
 * Save writes to data/cc-effects.json.
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
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
    const raw = pathname.replace(/^\/api\/dc-image\/?/, '').replace(/\/$/, '');
    const dcName = decodeURIComponent(raw).trim();
    let dcImages = {};
    try {
      const dcData = JSON.parse(readFileSync(join(root, 'data', 'dc-images.json'), 'utf8'));
      dcImages = dcData.dcImages || {};
    } catch (_) {}
    let companionImages = {};
    try {
      const ci = JSON.parse(readFileSync(join(root, 'data', 'companion-images.json'), 'utf8'));
      companionImages = ci.companionImages || {};
    } catch (_) {}
    const innerName = dcName.replace(/^\[|\]$/g, '').trim();
    let relPath = dcImages[dcName] || companionImages[dcName] || dcImages[innerName] || companionImages[innerName] || dcImages[dcName.replace(/\s*\([^)]*\)\s*$/, '').trim()];
    if (!relPath && innerName) {
      for (const [k, v] of Object.entries(dcImages)) {
        if (v && (k.replace(/^\[|\]$/g, '').trim() === innerName)) {
          relPath = v;
          break;
        }
      }
    }
    if (!relPath) {
      for (const [k, v] of Object.entries(companionImages)) {
        if (v && (k === dcName || k.replace(/\s+/g, ' ').trim() === dcName || k === innerName)) {
          relPath = v;
          break;
        }
      }
    }
    if (!relPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    // Prefer IACP variant image when it exists in the same folder (e.g. "Boba Fett (IACP).jpg")
    const relParts = relPath.split('/');
    const dirRel = relParts.slice(0, -1).join('/');
    const baseWithExt = relParts[relParts.length - 1];
    const baseName = baseWithExt.replace(/\.[^.]+$/, '');
    for (const ext of ['.jpg', '.png', '.gif']) {
      const iacpRel = dirRel + '/' + baseName + ' (IACP)' + ext;
      if (existsSync(join(root, ...iacpRel.split('/')))) {
        relPath = iacpRel;
        break;
      }
    }
    const filePath = join(root, ...relPath.split('/'));
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('Not found');
      return;
    }
    try {
      const buf = readFileSync(filePath);
      const ext = extname(filePath).toLowerCase();
      const mime = MIME[ext] || (ext === '.png' ? 'image/png' : 'image/jpeg');
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store, no-cache, must-revalidate' });
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

  if (req.method === 'POST' && pathname === '/api/save-image-upgrades') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const outPath = join(root, 'data', 'dc-image-upgrades.json');
      writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/symbol-asset-list') {
    try {
      const imagesRoot = join(root, 'vassal_extracted', 'images');
      const suggest = (folder, name) => {
        const n = name.toLowerCase();
        if (folder === 'dice') {
          if (n.includes('dice icon-red')) return { label: 'red', category: 'attack-die' };
          if (n.includes('dice icon-blue')) return { label: 'blue', category: 'attack-die' };
          if (n.includes('dice icon-green')) return { label: 'green', category: 'attack-die' };
          if (n.includes('dice icon-yellow')) return { label: 'yellow', category: 'attack-die' };
          if (n.includes('dice icon-white')) return { label: 'white', category: 'defense-die' };
          if (n.includes('dice icon-black')) return { label: 'black', category: 'defense-die' };
          if (n.includes('diceicon--damage')) return { label: '+1 Hit', category: 'surge' };
          if (n.includes('diceicon--block')) return { label: '+1 Block', category: 'surge' };
          if (n.includes('diceicon--evade')) return { label: '+1 Evade', category: 'surge' };
          if (n.includes('diceicon--surge')) return { label: '+1 Surge', category: 'surge' };
        }
        if (folder === 'tokens') {
          if (n.includes('melee attack')) return { label: 'Melee', category: 'other' };
          if (n.includes('ranged attack')) return { label: 'Range', category: 'other' };
        }
        if (folder === 'conditions') {
          if (n.includes('bleeding')) return { label: 'Bleed', category: 'keyword' };
          if (n.includes('focused')) return { label: 'Focus', category: 'keyword' };
          if (n.includes('stunned')) return { label: 'Stun', category: 'keyword' };
          if (n.includes('weakened')) return { label: 'Weaken', category: 'keyword' };
          if (n.includes('hidden')) return { label: 'Hidden', category: 'keyword' };
        }
        return { label: '', category: 'other' };
      };
      const list = (subdir) => {
        const dir = join(imagesRoot, subdir);
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
          .filter((f) => /\.(png|jpg|jpeg|gif)$/i.test(f))
          .map((f) => {
            const rel = `vassal_extracted/images/${subdir}/${f}`;
            const s = suggest(subdir, f);
            return { path: rel, suggestedLabel: s.label, suggestedCategory: s.category };
          });
      };
      const dice = list('dice').filter((e) => /Dice Icon-|DiceIcon--/.test(e.path));
      const tokens = list('tokens').filter((e) => /Icon--(Melee|Ranged) Attack|Power Token--(Block|Evade|Hit|Surge)/i.test(e.path));
      const conditions = list('conditions').filter((e) => /Condition (card|Marker)--(Bleeding|Focused|Hidden|Stunned|Weakened)/i.test(e.path));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dice, tokens, conditions }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/dice-face-outcomes') {
    try {
      const outPath = join(root, 'data', 'dice-face-outcomes.json');
      const data = existsSync(outPath)
        ? JSON.parse(readFileSync(outPath, 'utf8'))
        : { source: 'Symbol Labeling Tool', outcomes: {} };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ outcomes: {}, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-dice-face-outcomes') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const outcomes = data.outcomes && typeof data.outcomes === 'object' ? data.outcomes : {};
      const toWrite = {
        source: data.source || 'Symbol Labeling Tool',
        outcomes,
        updatedAt: new Date().toISOString(),
      };
      const dataDir = join(root, 'data');
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'dice-face-outcomes.json'), JSON.stringify(toWrite, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/symbol-glossary') {
    try {
      const outPath = join(root, 'data', 'symbol-glossary.json');
      const data = existsSync(outPath)
        ? JSON.parse(readFileSync(outPath, 'utf8'))
        : { source: 'Symbol Labeling Tool', symbols: [] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ symbols: [], error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-symbol-glossary') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body);
      const symbols = Array.isArray(data.symbols) ? data.symbols : [];
      const imagesDir = join(root, 'data', 'symbol-images');
      if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });
      const safeId = (id) => String(id || '').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'symbol';
      const outSymbols = symbols.map((s) => {
        const id = safeId(s.id || s.label);
        const base64 = typeof s.imageBase64 === 'string' && s.imageBase64.length > 0 ? s.imageBase64 : null;
        const sourcePath = typeof s.sourcePath === 'string' && s.sourcePath.length > 0 ? s.sourcePath : null;
        let imagePath = s.imagePath;
        if (base64 && base64.length > 0) {
          const base = base64.replace(/^data:image\/\w+;base64,/, '');
          const buf = Buffer.from(base, 'base64');
          const fname = `${id}.png`;
          writeFileSync(join(imagesDir, fname), buf);
          imagePath = `symbol-images/${fname}`;
        } else if (sourcePath) {
          imagePath = sourcePath;
        }
        return {
          id: id || s.id,
          label: s.label || '',
          category: s.category || 'other',
          imagePath: imagePath || (s.imagePath ? s.imagePath : null),
          notes: s.notes || '',
        };
      });
      const toWrite = {
        source: data.source || 'Symbol Labeling Tool',
        symbols: outSymbols,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(join(root, 'data', 'symbol-glossary.json'), JSON.stringify(toWrite, null, 2), 'utf8');
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
  console.log(`Symbol Labeling Tool: http://localhost:${PORT}/scripts/symbol-labeling-tool.html`);
  console.log('CC save → data/cc-effects.json | DC save → data/dc-effects.json | Symbols → data/symbol-glossary.json + data/symbol-images/');
});

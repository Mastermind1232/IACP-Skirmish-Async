/**
 * Serves the map spaces tool with data/map-spaces.json injected so the dropdown shows map + grid immediately.
 * Run: npm run map-tool
 * Open: http://localhost:3457/vassal_extracted/images/extract-map-spaces.html
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = 3457;

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
};

const MAP_SPACES_HTML = 'vassal_extracted/images/extract-map-spaces.html';
const MAP_SPACES_JSON = join(root, 'data', 'map-spaces.json');
const MAP_REGISTRY_JSON = join(root, 'data', 'map-registry.json');
const TOURNAMENT_ROTATION_JSON = join(root, 'data', 'tournament-rotation.json');
const PLACEHOLDER = '<!-- INJECT_MAP_SPACES -->';
const PLACEHOLDER_IMAGE_PATHS = '<!-- INJECT_MAP_IMAGE_PATHS -->';
const PLACEHOLDER_TOURNAMENT_ROTATION = '<!-- INJECT_TOURNAMENT_ROTATION -->';
const MAPS_SUBFOLDER = 'vassal_extracted/images/maps/';

const SAVE_PATH = '/save-map-spaces';

createServer((req, res) => {
  const requestPath = (req.url || '/').split('?')[0];
  const pathname = requestPath === '/' ? '/' + MAP_SPACES_HTML : requestPath;
  const pathForSave = requestPath.replace(/\/$/, '');
  let decodedPath = (pathname.startsWith('/') ? pathname.slice(1) : pathname).replace(/\.\./g, '');
  try { decodedPath = decodeURIComponent(decodedPath); } catch (_) {}
  decodedPath = decodedPath.replace(/\.\./g, '');
  const filePath = join(root, decodedPath);

  if (req.method === 'POST' && (pathForSave === SAVE_PATH || decodedPath === 'save-map-spaces')) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const data = JSON.parse(body);
        if (!data || typeof data !== 'object' || !data.maps || typeof data.maps !== 'object') {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON: expected { "maps": { ... } }');
          return;
        }
        writeFileSync(MAP_SPACES_JSON, JSON.stringify(data, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error: ' + (err.message || 'failed to save'));
      }
    });
    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: request failed');
    });
    return;
  }

  if (req.method === 'GET' && decodedPath.replace(/\\/g, '/') === MAP_SPACES_HTML) {
    try {
      let html = readFileSync(filePath, 'utf8');
      if (existsSync(MAP_SPACES_JSON)) {
        let json = readFileSync(MAP_SPACES_JSON, 'utf8');
        json = json.replace(/<\/script>/gi, '<\\/script>');
        const inject = `<script type="application/json" id="map-spaces-data">${json}</script>`;
        html = html.replace(PLACEHOLDER, inject);
      }
      if (existsSync(MAP_REGISTRY_JSON)) {
        const registry = JSON.parse(readFileSync(MAP_REGISTRY_JSON, 'utf8'));
        const imagePaths = {};
        for (const m of registry.maps || []) {
          if (!m.id) continue;
          const filename = (m.imagePath || '').split(/[/\\]/).pop() || m.vassalImage || '';
          if (filename) imagePaths[m.id] = MAPS_SUBFOLDER + filename;
        }
        const pathsJson = JSON.stringify(imagePaths).replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_IMAGE_PATHS, `<script type="application/json" id="map-image-paths">${pathsJson}</script>`);
      }
      if (existsSync(TOURNAMENT_ROTATION_JSON)) {
        const rot = JSON.parse(readFileSync(TOURNAMENT_ROTATION_JSON, 'utf8'));
        const missionIds = Array.isArray(rot?.missionIds) ? rot.missionIds : [];
        const rotJson = JSON.stringify(missionIds).replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_TOURNAMENT_ROTATION, `<script type="application/json" id="tournament-rotation">${rotJson}</script>`);
      } else {
        html = html.replace(PLACEHOLDER_TOURNAMENT_ROTATION, '<script type="application/json" id="tournament-rotation">[]</script>');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + (err.message || 'failed to serve page'));
    }
    return;
  }

  if (!existsSync(filePath) || !filePath.startsWith(root)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
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
}).listen(PORT, () => {
  console.log(`Map spaces tool: http://localhost:${PORT}/vassal_extracted/images/extract-map-spaces.html`);
  console.log('Select a map in the dropdown to see map + grid (data is injected on load).');
});

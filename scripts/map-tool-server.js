/**
 * Serves the map spaces tool with data/map-spaces.json injected so the dropdown shows map + grid immediately.
 * Run: npm run map-tool
 * Open: http://localhost:3457/vassal_extracted/images/extract-map-spaces.html
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

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
const DEPLOYMENT_ZONES_JSON = join(root, 'data', 'deployment-zones.json');
const MAP_TOKENS_JSON = join(root, 'data', 'map-tokens.json');
const TOKEN_IMAGES_JSON = join(root, 'data', 'token-images.json');
const MISSION_CARDS_JSON = join(root, 'data', 'mission-cards.json');
const PLACEHOLDER = '<!-- INJECT_MAP_SPACES -->';
const PLACEHOLDER_IMAGE_PATHS = '<!-- INJECT_MAP_IMAGE_PATHS -->';
const PLACEHOLDER_TOURNAMENT_ROTATION = '<!-- INJECT_TOURNAMENT_ROTATION -->';
const PLACEHOLDER_DEPLOYMENT_ZONES = '<!-- INJECT_DEPLOYMENT_ZONES -->';
const PLACEHOLDER_MAP_TOKENS = '<!-- INJECT_MAP_TOKENS -->';
const TOKEN_IMAGE_BASE_PATH = '/vassal_extracted/images/';
const PLACEHOLDER_TOKEN_IMAGE_BASE = '<!-- INJECT_TOKEN_IMAGE_BASE -->';
const PLACEHOLDER_TOKEN_IMAGES = '<!-- INJECT_TOKEN_IMAGES --><script type="application/json" id="token-images-data">{"terminals":"Counter--Terminal GRAY.gif","missionA":"Mission Token--Neutral GRAY.gif","missionB":"Counter--Crate Blue.gif","doors":"Token--Door.png"}</script>';
const PLACEHOLDER_MISSION_CARDS = '<!-- INJECT_MISSION_CARDS --><script type="application/json" id="mission-cards-data">{"source":"extract-map-spaces.html","maps":{}}</script>';
const MAPS_SUBFOLDER = 'vassal_extracted/images/maps/';

const SAVE_SUFFIX = 'map-tool-save';

function pathMatches(req, suffix) {
  const raw = (req.url || '').split('?')[0];
  try {
    const p = decodeURIComponent(raw).replace(/\/+$/, '').toLowerCase();
    return p === suffix.toLowerCase() || p === '/' + suffix.toLowerCase() || p.endsWith('/' + suffix.toLowerCase());
  } catch (_) {
    return raw.replace(/\/+$/, '').toLowerCase().endsWith(suffix.toLowerCase());
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

createServer((req, res) => {
  const requestPath = (req.url || '/').split('?')[0];
  const pathname = requestPath === '/' ? '/' + MAP_SPACES_HTML : requestPath;
  let decodedPath = (pathname.startsWith('/') ? pathname.slice(1) : pathname).replace(/\.\./g, '');
  try { decodedPath = decodeURIComponent(decodedPath); } catch (_) {}
  decodedPath = decodedPath.replace(/\.\./g, '');
  const filePath = join(root, decodedPath);

  if (req.method === 'GET' && pathMatches(req, 'map-tool-ping')) {
    setCors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'map-tool server is running' }));
    return;
  }

  if (req.method === 'OPTIONS' && pathMatches(req, SAVE_SUFFIX)) {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && pathMatches(req, SAVE_SUFFIX)) {
    setCors(res);
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const payload = JSON.parse(body);
        const errors = [];
        if (payload.mapSpaces != null) {
          const data = payload.mapSpaces;
          if (!data || typeof data !== 'object' || !data.maps || typeof data.maps !== 'object') {
            errors.push('mapSpaces: expected { "maps": { ... } }');
          } else {
            writeFileSync(MAP_SPACES_JSON, JSON.stringify(data, null, 2), 'utf8');
          }
        }
        if (payload.tournamentRotation != null) {
          const data = payload.tournamentRotation;
          if (!data || typeof data !== 'object' || !Array.isArray(data.missionIds)) {
            errors.push('tournamentRotation: expected { "missionIds": [ ... ] }');
          } else {
            writeFileSync(TOURNAMENT_ROTATION_JSON, JSON.stringify(data, null, 2), 'utf8');
          }
        }
        if (payload.deploymentZones != null) {
          const data = payload.deploymentZones;
          if (!data || typeof data !== 'object' || !data.maps || typeof data.maps !== 'object') {
            errors.push('deploymentZones: expected { "maps": { ... } }');
          } else {
            writeFileSync(DEPLOYMENT_ZONES_JSON, JSON.stringify(data, null, 2), 'utf8');
          }
        }
        if (payload.mapTokens != null) {
          const data = payload.mapTokens;
          if (!data || typeof data !== 'object' || !data.maps || typeof data.maps !== 'object') {
            errors.push('mapTokens: expected { "maps": { ... } }');
          } else {
            writeFileSync(MAP_TOKENS_JSON, JSON.stringify(data, null, 2), 'utf8');
          }
        }
        if (payload.missionCards != null) {
          const data = payload.missionCards;
          if (!data || typeof data !== 'object' || !data.maps || typeof data.maps !== 'object') {
            errors.push('missionCards: expected { "maps": { ... } }');
          } else {
            writeFileSync(MISSION_CARDS_JSON, JSON.stringify(data, null, 2), 'utf8');
          }
        }
        if (errors.length) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(errors.join('; '));
          return;
        }
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
        const rotRaw = readFileSync(TOURNAMENT_ROTATION_JSON, 'utf8').replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_TOURNAMENT_ROTATION, `<script type="application/json" id="tournament-rotation">${rotRaw}</script>`);
      } else {
        html = html.replace(PLACEHOLDER_TOURNAMENT_ROTATION, '<script type="application/json" id="tournament-rotation">{"source":"extract-map-spaces.html","missionIds":[]}</script>');
      }
      if (existsSync(DEPLOYMENT_ZONES_JSON)) {
        const dzJson = readFileSync(DEPLOYMENT_ZONES_JSON, 'utf8').replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_DEPLOYMENT_ZONES, `<script type="application/json" id="deployment-zones-data">${dzJson}</script>`);
      } else {
        html = html.replace(PLACEHOLDER_DEPLOYMENT_ZONES, '<script type="application/json" id="deployment-zones-data">{"maps":{}}</script>');
      }
      if (existsSync(MAP_TOKENS_JSON)) {
        const tokJson = readFileSync(MAP_TOKENS_JSON, 'utf8').replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_MAP_TOKENS, `<script type="application/json" id="map-tokens-data">${tokJson}</script>`);
      } else {
        html = html.replace(PLACEHOLDER_MAP_TOKENS, '<script type="application/json" id="map-tokens-data">{"source":"extract-map-spaces.html","maps":{}}</script>');
      }
      html = html.replace(PLACEHOLDER_TOKEN_IMAGE_BASE, `<script>window.MAP_TOOL_TOKEN_IMAGE_BASE=${JSON.stringify(TOKEN_IMAGE_BASE_PATH)};</script>`);
      if (existsSync(TOKEN_IMAGES_JSON)) {
        const tokenImgRaw = readFileSync(TOKEN_IMAGES_JSON, 'utf8').replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_TOKEN_IMAGES, `<script type="application/json" id="token-images-data">${tokenImgRaw}</script>`);
      } else {
        html = html.replace(PLACEHOLDER_TOKEN_IMAGES, '<script type="application/json" id="token-images-data">{"terminals":"Counter--Terminal GRAY.gif","missionA":"Mission Token--Neutral GRAY.gif","missionB":"Counter--Crate Blue.gif","doors":"Token--Door.png"}</script>');
      }
      if (existsSync(MISSION_CARDS_JSON)) {
        const mcJson = readFileSync(MISSION_CARDS_JSON, 'utf8').replace(/<\/script>/gi, '<\\/script>');
        html = html.replace(PLACEHOLDER_MISSION_CARDS, `<script type="application/json" id="mission-cards-data">${mcJson}</script>`);
      } else {
        html = html.replace(PLACEHOLDER_MISSION_CARDS, '<script type="application/json" id="mission-cards-data">{"source":"extract-map-spaces.html","maps":{}}</script>');
      }
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache'
      });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + (err.message || 'failed to serve page'));
    }
    return;
  }

  let pathToServe = filePath;
  let servedFromTokenBase = false;
  if (!existsSync(pathToServe) && decodedPath.replace(/\\/g, '/').startsWith('vassal_extracted/images/tokens/')) {
    const filename = decodedPath.replace(/^.*[/\\]/, '');
    const fallbackMaps = join(root, 'vassal_extracted', 'images', 'maps', filename);
    if (existsSync(fallbackMaps)) {
      pathToServe = fallbackMaps;
    } else {
      try {
        const tokenConfig = JSON.parse(readFileSync(TOKEN_IMAGES_JSON, 'utf8'));
        const basePath = tokenConfig && tokenConfig.tokenImageBasePath;
        if (basePath && typeof basePath === 'string') {
          const customPath = join(basePath.trim(), filename);
          if (existsSync(customPath)) {
            pathToServe = customPath;
            servedFromTokenBase = true;
          }
        }
      } catch (_) {}
    }
  }
  if (!existsSync(pathToServe)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const realServe = resolve(pathToServe);
  const realRoot = resolve(root);
  const pathWithin = (a, b) => a.toLowerCase().startsWith(b.toLowerCase());
  if (!servedFromTokenBase && !pathWithin(realServe, realRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (servedFromTokenBase) {
    const tokenConfig = JSON.parse(readFileSync(TOKEN_IMAGES_JSON, 'utf8'));
    const basePath = (tokenConfig && tokenConfig.tokenImageBasePath || '').trim();
    if (basePath && !pathWithin(realServe, resolve(basePath))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
  }
  const ext = extname(pathToServe);
  const mime = MIME[ext] || 'application/octet-stream';
  const isTokenImage = decodedPath.replace(/\\/g, '/').includes('/tokens/');
  const headers = { 'Content-Type': mime };
  if (isTokenImage) headers['Cache-Control'] = 'no-store, no-cache';
  try {
    const content = readFileSync(pathToServe);
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log('Map tool: ' + url);
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
});

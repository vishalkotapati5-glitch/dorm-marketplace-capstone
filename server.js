const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_CLAIM_TTL_MS = 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const CATEGORIES = new Set([
  'Books',
  'Furniture',
  'Electronics',
  'Bikes',
  'Home',
  'Other',
]);
const PUBLIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const SEED_ITEMS = [
  {
    id: 'seed-calculus-book',
    title: 'Calculus: Early Transcendentals',
    category: 'Books',
    description: 'Good condition, a few notes in the margins.',
    sellerName: 'Maya Chen',
    state: 'available',
    claim: null,
    soldReason: null,
    createdAt: '2026-10-25T10:00:00.000Z',
  },
  {
    id: 'seed-desk-lamp',
    title: 'Adjustable desk lamp',
    category: 'Home',
    description: 'Works great and includes the LED bulb.',
    sellerName: 'Jordan Lee',
    state: 'available',
    claim: null,
    soldReason: null,
    createdAt: '2026-10-26T14:30:00.000Z',
  },
  {
    id: 'seed-bike-lock',
    title: 'U-lock for a commuter bike',
    category: 'Bikes',
    description: 'Still sturdy; includes both keys.',
    sellerName: 'Sam Patel',
    state: 'available',
    claim: null,
    soldReason: null,
    createdAt: '2026-10-27T09:15:00.000Z',
  },
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function requireRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Send a JSON object.');
  }
  return value;
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} is required.`);
  }

  const text = value.trim();
  if (text.length < 2 || text.length > maxLength) {
    throw new HttpError(400, `${label} must be 2–${maxLength} characters.`);
  }
  return text;
}

async function readJson(request) {
  const chunks = [];
  let byteLength = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > MAX_BODY_BYTES) {
      tooLarge = true;
    } else {
      chunks.push(chunk);
    }
  }

  if (tooLarge) {
    throw new HttpError(413, 'Request body is too large.');
  }
  if (byteLength === 0) {
    throw new HttpError(400, 'A JSON request body is required.');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must contain valid JSON.');
  }
}

function createMarketplaceServer(options = {}) {
  const dataFile = options.dataFile || path.join(__dirname, '.data', 'items.json');
  const claimTtlMs = options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  if (!Number.isFinite(claimTtlMs) || claimTtlMs <= 0) {
    throw new RangeError('claimTtlMs must be a positive number.');
  }

  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  let items;
  if (fs.existsSync(dataFile)) {
    items = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!Array.isArray(items)) {
      throw new Error(`Marketplace data at ${dataFile} must be an array.`);
    }
  } else {
    items = SEED_ITEMS.map((item) => ({ ...item }));
    saveItems(items);
  }

  function saveItems(nextItems) {
    const temporaryFile = `${dataFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(nextItems, null, 2), 'utf8');
    try {
      fs.renameSync(temporaryFile, dataFile);
    } finally {
      if (fs.existsSync(temporaryFile)) {
        fs.unlinkSync(temporaryFile);
      }
    }
  }

  function commit(nextItems) {
    saveItems(nextItems);
    items = nextItems;
  }

  function reconcileExpiredClaims() {
    const now = Date.now();
    let changed = false;
    const nextItems = items.map((item) => {
      if (item.state === 'claimed' && item.claim.expiresAt <= now) {
        changed = true;
        return { ...item, state: 'available', claim: null };
      }
      return item;
    });

    if (changed) {
      commit(nextItems);
    }
  }

  function findItem(itemId) {
    const itemIndex = items.findIndex((item) => item.id === itemId);
    if (itemIndex === -1) {
      throw new HttpError(404, 'Listing not found.');
    }
    return itemIndex;
  }

  async function handleRequest(request, response) {
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'GET' && PUBLIC_FILES.has(url.pathname)) {
      const [fileName, contentType] = PUBLIC_FILES.get(url.pathname);
      response.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(fs.readFileSync(path.join(__dirname, 'public', fileName)));
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
      return;
    }

    reconcileExpiredClaims();

    if (request.method === 'GET' && url.pathname === '/api/items') {
      jsonResponse(response, 200, { items });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/items') {
      const body = requireRecord(await readJson(request));
      const title = requireText(body.title, 'Title', 80);
      const sellerName = requireText(body.sellerName, 'Your name', 40);
      const category = requireText(body.category, 'Category', 20);
      if (!CATEGORIES.has(category)) {
        throw new HttpError(400, 'Choose a valid category.');
      }
      const description = typeof body.description === 'string'
        ? body.description.trim()
        : '';
      if (description.length > 500) {
        throw new HttpError(400, 'Description must be 500 characters or fewer.');
      }

      const item = {
        id: crypto.randomUUID(),
        title,
        category,
        description,
        sellerName,
        state: 'available',
        claim: null,
        soldReason: null,
        createdAt: new Date().toISOString(),
      };
      commit([item, ...items]);
      jsonResponse(response, 201, { item });
      return;
    }

    const itemAction = url.pathname.match(/^\/api\/items\/([a-zA-Z0-9-]+)\/(claim|confirm|sold)$/);
    if (request.method !== 'POST' || !itemAction) {
      throw new HttpError(404, 'Marketplace route not found.');
    }

    const [, itemId, action] = itemAction;
    const body = requireRecord(await readJson(request));
    const itemIndex = findItem(itemId);
    const item = items[itemIndex];
    let updatedItem;

    if (action === 'claim') {
      const buyerName = requireText(body.buyerName, 'Your name', 40);
      if (item.state !== 'available') {
        throw new HttpError(409, 'This item is no longer available.');
      }
      if (buyerName.toLowerCase() === item.sellerName.toLowerCase()) {
        throw new HttpError(409, 'You cannot claim your own listing.');
      }
      updatedItem = {
        ...item,
        state: 'claimed',
        claim: { buyerName, expiresAt: Date.now() + claimTtlMs },
      };
    } else if (action === 'confirm') {
      const buyerName = requireText(body.buyerName, 'Your name', 40);
      if (item.state !== 'claimed') {
        throw new HttpError(409, 'This item does not have an active claim.');
      }
      if (buyerName.toLowerCase() !== item.claim.buyerName.toLowerCase()) {
        throw new HttpError(403, 'Only the student who claimed this item can confirm pickup.');
      }
      updatedItem = { ...item, state: 'sold', claim: null, soldReason: 'handoff' };
    } else {
      const sellerName = requireText(body.sellerName, 'Your name', 40);
      if (sellerName.toLowerCase() !== item.sellerName.toLowerCase()) {
        throw new HttpError(403, 'Only this listing’s seller can mark it sold.');
      }
      if (item.state === 'sold') {
        throw new HttpError(409, 'This listing has already been completed.');
      }
      updatedItem = { ...item, state: 'sold', claim: null, soldReason: 'seller_override' };
    }

    const nextItems = [...items];
    nextItems[itemIndex] = updatedItem;
    commit(nextItems);
    jsonResponse(response, 200, { item: updatedItem });
  }

  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) {
        jsonResponse(response, error.status, { error: error.message });
        return;
      }
      console.error('Marketplace request failed:', error);
      jsonResponse(response, 500, { error: 'The marketplace could not complete that request.' });
    });
  });
}

if (require.main === module) {
  const server = createMarketplaceServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Dorm Marketplace is running at http://localhost:${port}`);
  });
}

module.exports = { createMarketplaceServer };

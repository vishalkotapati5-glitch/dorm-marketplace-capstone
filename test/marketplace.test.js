const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createMarketplaceServer } = require('../server');

let server;
let dataDirectory;
let baseUrl;

before(async () => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dorm-marketplace-test-'));
  server = createMarketplaceServer({
    dataFile: path.join(dataDirectory, 'items.json'),
    claimTtlMs: 1_000,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

async function postJson(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getItems() {
  const response = await fetch(`${baseUrl}/api/items`);
  assert.equal(response.status, 200);
  return (await response.json()).items;
}

async function createListing(title) {
  const result = await postJson('/api/items', {
    title,
    category: 'Books',
    description: '',
    sellerName: 'Alex Rivera',
  });
  assert.equal(result.status, 201);
  return result.body.item;
}

test('only one of two simultaneous claims succeeds', async () => {
  const item = await createListing('One copy of a book');
  const results = await Promise.all([
    postJson(`/api/items/${item.id}/claim`, { buyerName: 'Jamie Park' }),
    postJson(`/api/items/${item.id}/claim`, { buyerName: 'Taylor Brooks' }),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200);
  assert.ok(winner);
  assert.equal(winner.body.item.state, 'claimed');
  assert.ok(['Jamie Park', 'Taylor Brooks'].includes(winner.body.item.claim.buyerName));
  assert.equal(winner.body.item.claim.expiresAt > Date.now(), true);
});

test('an unconfirmed claim expires and makes the listing available again', async () => {
  const item = await createListing('A claim that will expire');
  const claim = await postJson(`/api/items/${item.id}/claim`, { buyerName: 'Jamie Park' });
  assert.equal(claim.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 1_050));
  const refreshed = (await getItems()).find((listing) => listing.id === item.id);
  assert.equal(refreshed.state, 'available');
  assert.equal(refreshed.claim, null);
});

test('the claimant can confirm pickup and the item becomes complete', async () => {
  const item = await createListing('A completed handoff');
  await postJson(`/api/items/${item.id}/claim`, { buyerName: 'Jamie Park' });

  const otherStudent = await postJson(`/api/items/${item.id}/confirm`, { buyerName: 'Taylor Brooks' });
  assert.equal(otherStudent.status, 403);

  const confirmation = await postJson(`/api/items/${item.id}/confirm`, { buyerName: 'Jamie Park' });
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.body.item.state, 'sold');
  assert.equal(confirmation.body.item.soldReason, 'handoff');
  assert.equal(confirmation.body.item.claim, null);
});

test('only the seller can override a listing, including an active claim', async () => {
  const item = await createListing('Sold in the hallway');
  await postJson(`/api/items/${item.id}/claim`, { buyerName: 'Jamie Park' });

  const otherStudent = await postJson(`/api/items/${item.id}/sold`, { sellerName: 'Taylor Brooks' });
  assert.equal(otherStudent.status, 403);

  const sellerOverride = await postJson(`/api/items/${item.id}/sold`, { sellerName: 'Alex Rivera' });
  assert.equal(sellerOverride.status, 200);
  assert.equal(sellerOverride.body.item.state, 'sold');
  assert.equal(sellerOverride.body.item.soldReason, 'seller_override');
  assert.equal(sellerOverride.body.item.claim, null);

  const oldClaimant = await postJson(`/api/items/${item.id}/confirm`, { buyerName: 'Jamie Park' });
  assert.equal(oldClaimant.status, 409);
});

test('rejects invalid listings and self-claims', async () => {
  const invalid = await postJson('/api/items', {
    title: 'A valid title',
    category: 'Money',
    sellerName: 'Alex Rivera',
  });
  assert.equal(invalid.status, 400);

  const item = await createListing('Seller cannot take own listing');
  const selfClaim = await postJson(`/api/items/${item.id}/claim`, { buyerName: 'alex rivera' });
  assert.equal(selfClaim.status, 409);
  assert.match(selfClaim.body.error, /own listing/);
});

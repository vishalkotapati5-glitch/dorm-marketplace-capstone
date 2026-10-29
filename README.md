# Dorm Marketplace

A no-dependency Node.js prototype for listing used campus items, reserving one for an in-person handoff, and resolving the listing when the handoff or a real-world sale happens.

## Run locally

Requires Node.js 18 or newer.

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use another port. Listing data is saved in `.data/items.json`; this file is created on first launch and is intentionally ignored by Git.

Run the automated workflow and collision tests with:

```powershell
npm test
```

## Product and behavior

The [PRD](./PRD.md) defines the three MVP features, three explicit scope cuts, and the claim-flow acceptance criteria. A successful claim reserves an item for 60 seconds. The browser refreshes the board regularly, while the server also reconciles expired claims before handling marketplace requests. The claimant can confirm pickup to complete the listing; its seller can mark it sold at any point, including while it is reserved.

Claim requests are handled synchronously against one server process, with state persisted before success is returned. That makes competing requests to this prototype serialize to one winner. This is intentionally a single-process demo: it does not provide sign-in, verified identities, or coordination across multiple server instances. Names are used to demonstrate buyer/seller roles, not as authentication.

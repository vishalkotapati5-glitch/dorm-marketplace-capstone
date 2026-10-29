# Dorm Marketplace — Day 1 PRD

## 1. Scope Cut

1. **Payments:** Handling money adds financial and compliance complexity that a handoff prototype does not need.
2. **Live chat:** Students can coordinate in person without building and moderating a messaging system.
3. **Email verification:** Account infrastructure is outside the scope of validating the marketplace workflow.

## 2. MVP Features

1. **Create and browse listings:** Students can post an item with a title, category, description, and seller name, then see its current status.
2. **Claim and complete a handoff:** A student can reserve an available item, and the claimant can confirm pickup to mark it complete.
3. **Resolve real-world changes:** Reservations expire after 60 seconds without pickup, and the seller can mark an item sold outside the app.

## 3. Acceptance Criteria

1. **Given** an item is available and the student is not its seller, **when** the student claims it, **then** the item becomes reserved for that student and is no longer claimable by others.
2. **Given** two students try to claim the same available item at nearly the same time, **when** both requests are processed, **then** exactly one succeeds and the other is told that the item is no longer available.
3. **Given** a student has reserved an item, **when** they confirm pickup before the reservation expires, **then** the item is marked complete and cannot be claimed again.

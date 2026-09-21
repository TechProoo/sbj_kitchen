# SBJ Kitchen Display

The board the kitchen works off. React + Vite, port **5174**.

```bash
cp .env.example .env    # VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Sign in with a staff account (see the root README for creating the first one).
An account without a `staff_profiles` row is signed straight back out — a
customer login cannot open the board.

## How it works

Four columns, oldest ticket first, because the oldest ticket is always the most
urgent:

**New** → **Accepted** → **Cooking** → **Ready**

- The big button on each card bumps it to the next stage. `Ready` hands over and
  the ticket leaves the board.
- Tapping a **line item** ticks it off, so a large ticket can be plated in
  pieces. Marking the whole ticket ready ticks off everything.
- The left edge and timer go **amber at 10 minutes** and **red at 20**. The
  timer measures time in the *current* stage, so a ticket that sat waiting to be
  accepted does not read as a slow cook.
- New orders arrive over the websocket with a chime and a brief highlight — no
  refreshing.
- **Sold out** (top right) lists everything the kitchen has 86'd and puts items
  back with one tap. To 86 something, use the menu availability endpoint.
- The header shows waiting / cooking / ready counts, today's average prep time
  and today's takings.

If the connection drops, the indicator reads **Reconnecting** and the board
refetches everything once it is back, since anything could have changed while
the screen was offline.

## Why it looks like this

It is dark and single-theme on purpose: this runs on a screen mounted over a hot
line, often glare-lit, read from two metres away by someone holding a pan. Type
is large, targets are finger-sized, and colour carries urgency rather than
decoration. Every token lives in `src/styles/kitchen.css`.

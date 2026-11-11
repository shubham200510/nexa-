# NEXPLAY

NEXPLAY is a social gaming MVP: discover the product, create a private room, invite a friend with a six-character code, and play Tic-Tac-Toe. It is built with React, TypeScript, Vite and Supabase.

## Current scope

- Responsive dark gaming dashboard.
- Email/password authentication when Supabase is configured.
- Guest demo mode when no backend credentials are present.
- Private room creation and room-code joining.
- Server-validated Tic-Tac-Toe turns through Postgres RPC.
- Realtime room updates through Supabase Realtime.
- Local demo rooms are stored in the current browser only.

Reaction Duel, Word Battle, friends, voice/video and public matchmaking are not implemented in this version.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:5173.

## Enable real cross-device multiplayer

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/migrations/001_init.sql`.
3. Copy the project URL and anon/public key into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Restart the Vite dev server.
5. Create two accounts in separate browsers/devices. One player creates a room; the other joins using the room code.

The SQL migration enables RLS and exposes only participant rooms. Game actions are validated by database functions; never put a Supabase service-role key in the browser.

## Build

```bash
npm run typecheck
npm run build
npm run preview
```

## Mobile packaging

This first milestone is a responsive web app. Android/iOS packaging with Capacitor and store signing is a follow-up release step; it is not included or claimed as completed in v0.1.

## Repository

Project implementation branch: `nexplay-v1`.

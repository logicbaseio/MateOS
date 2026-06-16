# MateOS Workspace

## Overview

MateOS Platform - An open-source web application for managing AI-powered reception, scheduling, and operations workflows:
1. **Scheduling and Reception Assistant** - Manages appointments, bookings, availability, and customer communication
2. **Operations Inbox** - Routes alerts and team workflows across connected channels

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── bot-manager/        # React frontend (MateOS dashboard)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI + AuthUser type
│   ├── replit-auth-web/    # useAuth() hook for browser auth (OIDC via Replit)
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Database Schema

- **sessions** - Replit Auth session store (sid, sess JSON, expire)
- **users** - Authenticated Replit users (id, email, firstName, lastName, profileImageUrl)
- **preferences** - Boss scheduling preferences (mood, timezone, city, meeting prefs)
- **meeting_requests** - Meeting requests from team members with status tracking
- **bot_conversations** - Bot conversation logs for both scheduler and amazon bots (table: `botConversationsTable`)
- **team_channels** - Amazon account to Microsoft Teams channel mappings
- **amazon_alerts** - Incoming Amazon alerts with priority, routing, and status
- **conversations** - OpenAI chat conversations (title, timestamps)
- **messages** - OpenAI chat messages (role, content, linked to conversations)

## AI Integration

- Uses Replit AI Integrations for OpenAI (env vars: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`)
- Server: `@workspace/integrations-openai-ai-server` - OpenAI client, voice chat stream, speech-to-text, text-to-speech
- React: `@workspace/integrations-openai-ai-react` - Voice recorder hook, audio playback hook
- Text chat uses `gpt-5.2` model with SSE streaming
- Voice chat uses `gpt-audio` model with PCM16 audio streaming
- Audio playback worklet at `artifacts/bot-manager/public/audio-playback-worklet.js`

## API Endpoints

### Dashboard
- `GET /api/dashboard/stats` - Dashboard statistics

### Smart Scheduler
- `GET /api/preferences` - Get scheduling preferences
- `PUT /api/preferences` - Update preferences
- `GET /api/meeting-requests` - List meeting requests (filter by status)
- `POST /api/meeting-requests` - Create new meeting request
- `GET /api/meeting-requests/:id` - Get specific request
- `PATCH /api/meeting-requests/:id` - Update request status
- `POST /api/meeting-requests/:id/suggest` - AI-powered time suggestion
- `GET /api/conversations` - List bot conversations

### OpenAI Chat (SSE streaming - do NOT use generated hooks for streaming endpoints)
- `GET /api/openai/conversations` - List chat conversations
- `POST /api/openai/conversations` - Create new conversation
- `GET /api/openai/conversations/:id` - Get conversation with messages
- `DELETE /api/openai/conversations/:id` - Delete conversation
- `POST /api/openai/conversations/:id/messages` - Send text message (SSE stream response)
- `POST /api/openai/conversations/:id/voice-messages` - Send voice audio (SSE stream with transcript + audio)

### Amazon Monitor
- `GET /api/amazon-alerts` - List alerts (filter by status/priority)
- `PATCH /api/amazon-alerts/:id` - Update alert status
- `POST /api/amazon-alerts/process` - Process incoming email
- `GET /api/team-channels` - List team channel mappings
- `POST /api/team-channels` - Create mapping
- `PATCH /api/team-channels/:id` - Update mapping
- `DELETE /api/team-channels/:id` - Delete mapping

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers
- Depends on: `@workspace/db`, `@workspace/api-zod`

### `artifacts/bot-manager` (`@workspace/bot-manager`)

React + Vite frontend for the MateOS platform. Uses shadcn/ui components, Tailwind CSS, wouter for routing, and React Query for data fetching.

- Pages: Dashboard, Preferences, Meeting Requests, Conversations, Chat (AI text+voice), Amazon Alerts, Team Channels, Email Simulator
- Uses generated React Query hooks from `@workspace/api-client-react`
- Chat page uses raw `fetch` + `ReadableStream` for SSE streaming (not generated hooks)
- Depends on: `@workspace/api-client-react`, `@workspace/integrations-openai-ai-react`

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- Schema files: preferences, meetingRequests, conversations, teamChannels, amazonAlerts
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec. Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`.

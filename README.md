# MateOS

MateOS is an open-source assistant operations platform for teams that manage bookings, appointments, reception workflows, and customer communication.

It currently ships with starter patterns for:

- Restaurants and food
- Dental and doctors
- Coaches and consultants

MateOS includes:

- A React admin dashboard for operators
- An Express API server
- PostgreSQL persistence with Drizzle ORM
- AI-assisted scheduling, conversation relay, and workflow tools
- Optional Microsoft, Twilio, ElevenLabs, Hume, and Telegram integrations

## Short Install Command

The short install command is:

```bash
npx @hamzaashergill/mateos
```

By default, that command will:

- create `./MateOS` if it does not exist
- reuse `./MateOS` if it already exists
- start MateOS on localhost after setup

Or install into a custom directory:

```bash
npx @hamzaashergill/mateos my-mateos
```

## GitHub Install

Today, the GitHub bootstrap command is:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/logicbaseio/MateOS/main/install.sh)
```

Both install paths do the same bootstrap work:

- clones the MateOS repo locally
- creates `.env` from `.env.example`
- installs workspace dependencies with `pnpm`
- starts PostgreSQL with Docker Compose
- applies the database schema
- shows the MateOS terminal logo and next steps

The npm CLI also supports:

- terminal Brain chat
- localhost startup for the full MateOS stack
- Docker-optional setup when `DATABASE_URL` is already configured

After install, MateOS also ships with a local CLI:

```bash
cd MateOS
node ./bin/mateos.mjs doctor
node ./bin/mateos.mjs localhost
node ./bin/mateos.mjs brain
```

## Workspace Layout

```text
MateOS/
├── artifacts/api-server        # Express API
├── artifacts/bot-manager       # React dashboard
├── lib/db                      # Database schema and Drizzle config
├── lib/api-spec                # OpenAPI contract
├── lib/api-client-react        # Generated frontend client
├── lib/api-zod                 # Generated API schemas
├── docs                        # Open-source documentation
└── starter-configs             # Vertical starter templates
```

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start PostgreSQL

```bash
docker compose up -d
```

### 3. Create your local env file

```bash
cp .env.example .env
```

### 4. Push the schema

```bash
pnpm db:push
```

### 5. Start the API

```bash
pnpm dev:api
```

### 6. Start the dashboard

```bash
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173).

### 7. Or start both with the MateOS CLI

```bash
node ./bin/mateos.mjs localhost
```

### 8. Chat with the Brain from your terminal

Start MateOS locally first, then open a second terminal:

```bash
cd MateOS
node ./bin/mateos.mjs brain
```

Useful commands inside terminal Brain mode:

- `/clear` clears Brain history
- `/exit` leaves terminal Brain mode

## Authentication Modes

MateOS now supports an installable default path:

- `MATEOS_AUTH_MODE=local`
  Default. Local single-admin mode for self-hosting and development.
- `MATEOS_AUTH_MODE=oidc`
  Optional generic OIDC mode for teams that want hosted sign-in.

When using OIDC, set:

- `OIDC_CLIENT_ID`
- `OIDC_ISSUER_URL`
- optional provider-specific secrets as needed

## Vertical Starter Configs

Starter templates live in [`starter-configs/`](./starter-configs).

- [restaurant-food.json](./starter-configs/restaurant-food.json)
- [dental-doctors.json](./starter-configs/dental-doctors.json)
- [coaches-consultants.json](./starter-configs/coaches-consultants.json)

Use them as starting points for:

- default assistant naming
- scheduling windows
- intake rules
- customer notes
- workflow tone

## Repository Notes

- The scheduling/reception stack is the primary MateOS surface.
- The alerts/routing module is still present and can be reused as a general operations inbox.
- Some internal concepts still use `boss` naming in code and database fields. That is behavioral debt, not a blocker for open-source release.

## Docs

- [Open Source Audit](./docs/open-source-audit.md)
- [Architecture](./docs/architecture.md)

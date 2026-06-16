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

## Workspace Layout

```text
MateOS-main/
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
PORT=8080 pnpm dev:api
```

### 6. Start the dashboard

```bash
PORT=5173 BASE_PATH=/ pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173).

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

Starter templates live in [starter-configs](/Users/Hamzaa/Documents/MateOS/MateOS-main/starter-configs).

- [restaurant-food.json](/Users/Hamzaa/Documents/MateOS/MateOS-main/starter-configs/restaurant-food.json)
- [dental-doctors.json](/Users/Hamzaa/Documents/MateOS/MateOS-main/starter-configs/dental-doctors.json)
- [coaches-consultants.json](/Users/Hamzaa/Documents/MateOS/MateOS-main/starter-configs/coaches-consultants.json)

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

- [Open Source Audit](/Users/Hamzaa/Documents/MateOS/MateOS-main/docs/open-source-audit.md)
- [Architecture](/Users/Hamzaa/Documents/MateOS/MateOS-main/docs/architecture.md)


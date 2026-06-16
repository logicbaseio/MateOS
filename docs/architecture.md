# MateOS Architecture

## Applications

- `artifacts/api-server`
  Express API for preferences, meeting requests, conversations, channels, voice, integrations, and dashboard stats.
- `artifacts/bot-manager`
  React dashboard for operators and admins.

## Shared Libraries

- `lib/db`
  Drizzle schema and PostgreSQL client.
- `lib/api-spec`
  OpenAPI contract.
- `lib/api-zod`
  Generated request/response validation types.
- `lib/api-client-react`
  Generated frontend API client.
- `lib/integrations-openai-ai-*`
  Shared AI integration clients for server and React.

## Core Data Model

- `preferences`
  Assistant identity, working hours, voice config, integrations, and behavior settings.
- `customers`
  Core CRM-style customer records.
- `meeting_requests`
  Appointment and scheduling requests.
- `conversations` and `messages`
  Chat transcripts and linked assistant interactions.
- `channel_configs` and `channel_sessions`
  Connected communication channels.
- `boss_memory`
  Owner memory and context blocks used by the assistant.
- `amazon_alerts` and `team_channels`
  Reusable alerts and routing workflow tables.

## Product Direction

MateOS should be treated as a platform with:

- a shared scheduling/reception core
- vertical starter templates
- optional channel/integration modules
- optional operations inbox workflows


# MateOS Open Source Audit

## What Exists Today

- Monorepo with shared TypeScript packages
- React dashboard for admin and ops workflows
- Express API with scheduling, conversation, and channel routes
- PostgreSQL schema for customers, meeting requests, preferences, alerts, conversations, sessions, and memory
- Multi-channel integrations for voice, messaging, Microsoft 365, and AI providers

## What Was Blocking Open Source

- Private branding across the UI and prompts
- Replit-specific assumptions in auth and setup
- Missing public `README`, env template, and local bootstrap
- No explicit starter templates for the three supported industries
- Hardcoded private default identities and workflow language

## What This Pass Changes

- Rebrands user-facing BotOS references to MateOS
- Adds local self-hosted auth mode as the default install path
- Adds `.env.example`, `docker-compose.yml`, `README.md`, and MIT `LICENSE`
- Adds workspace scripts for API, dashboard, DB push, and codegen
- Adds starter configs for restaurants/food, dental/doctors, and coaches/consultants
- Makes the dashboard home page explain the three MateOS verticals

## Remaining Cleanup Recommended Before Public Launch

- Rename internal `boss`/`sunny`/legacy variable names across the codebase
- Replace the default soul and voice-agent prompts with fully vertical-aware generic prompts
- Add test coverage around auth mode switching and workspace startup
- Add seed data and a one-command first-run bootstrap
- Decide whether the alerts module stays in core or moves to an optional package


# ADR-010: Migrate n8n to Oracle Cloud Infrastructure Always Free

─────────────────────────────────────────────────────────
**ADR-010:** Migrate n8n hosting from local machine + tunnel to Oracle Cloud Always Free
**Date:** 2026-05-25
**Status:** Proposed
─────────────────────────────────────────────────────────

## CONTEXT

The current deployment requires:
1. The developer's laptop to be running 24/7 with n8n and Ollama active
2. A public tunnel (`npx n8n start --tunnel` or localtunnel) for GitHub Actions to reach the webhook
3. Manual `WEBHOOK_URL` secret rotation every time the tunnel restarts

This creates a **critical single point of failure**: if the laptop sleeps, loses internet,
or the tunnel process crashes — GitHub Actions scraper silently fails (webhook POST times out).
Localtunnel returns 503/504 intermittently even when running. This violates the P6 goal of
"system runs unattended for 30+ days."

Oracle Cloud Infrastructure (OCI) offers an Always Free tier with ARM-based Ampere A1 instances:
4 vCPU, 24 GB RAM, 200 GB storage — permanently free, not a trial.

## DECISION

Migrate n8n, Caddy (reverse proxy), and PostgreSQL (n8n internal DB) to an OCI
Always Free Ampere A1 Flex instance (4 OCPU, 24 GB RAM, 200 GB boot volume).

Deploy as a Docker Compose stack with three services:
- `postgres` — n8n internal state (executions, credentials, workflows)
- `n8n` — workflow engine, configured with `DB_TYPE=postgresdb`
- `caddy` — reverse proxy with automatic Let's Encrypt TLS

Use a free domain (DuckDNS or custom) pointed to the server's public IP.

## RATIONALE

- **Eliminates tunnel dependency**: n8n gets a stable HTTPS URL that never rotates.
  `WEBHOOK_URL` is set once in GitHub Secrets and doesn't change.
- **24/7 uptime without human intervention**: the server runs independently of the laptop.
- **Free forever**: OCI Always Free is not a trial — no credit card charge risk.
- **24 GB RAM**: comfortably runs n8n + Postgres + Caddy with room for future services
  (NestJS backend, etc.)
- **Caddy auto-TLS**: zero-config Let's Encrypt certificates, simpler than Nginx + Certbot.

## CONSEQUENCES

### Positive
- n8n is always reachable — GitHub Actions scraper never silently fails due to tunnel issues
- No more manual WEBHOOK_URL rotation
- Laptop can be off — the pipeline runs autonomously
- PostgreSQL handles concurrent webhook writes safely (SQLite `database is locked` eliminated)
- Future-proofs infrastructure for NestJS/Lovable UI stage

### Negative / Trade-offs
- **ARM (aarch64) architecture**: requires ARM-compatible Docker images
  (n8n and Caddy provide official multi-arch images — verified)
- **OCI A1 availability**: high demand means instances may be hard to create;
  may require retrying over several days or using an availability monitoring script
- **New infrastructure to maintain**: server updates, Docker image updates, firewall rules
- **Oracle may change Always Free terms**: low probability but non-zero risk
- **SSH key management**: need to secure access to the cloud instance

### Follow-up tasks
- `CLOUD-1` through `CLOUD-12` (see roadmap.yaml Phase 7)
- ADR-011: Cloud LLM migration (directly depends on this decision)
- ADR-012: Evaluator observability (independent, but benefits from stable infra)

### Constraints update
- **Supersedes**: "No external databases" constraint (PostgreSQL added, but only for n8n internals)
- **Preserves**: Notion as primary business data store
- **Preserves**: GitHub Actions as scraper runtime
- **Preserves**: $0/month cost requirement

─────────────────────────────────────────────────────────

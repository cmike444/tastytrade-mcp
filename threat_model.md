# Threat Model

## Project Overview

This project is a Node.js/TypeScript MCP server that exposes TastyTrade brokerage and market-data operations over either stdio or an HTTP transport. In production, the relevant surface is the HTTP mode in `src/index.ts`, which serves MCP requests, an embedded OAuth 2.1 authorization flow, public metadata endpoints, and health/status endpoints. The server authenticates to TastyTrade with secrets from environment variables, keeps long-lived brokerage sessions alive, and exposes high-impact tools such as account access, transaction history, and live order placement.

## Assets

- **Brokerage account access** — the server can read balances, positions, transactions, and place, edit, or cancel orders on the linked TastyTrade account. Compromise has direct financial impact.
- **Server access credentials** — `MCP_BEARER_TOKEN`, OAuth authorization codes, OAuth access tokens, and dynamic client secrets control who can use the remote MCP endpoint.
- **TastyTrade credentials and refresh tokens** — `TASTYTRADE_CLIENT_SECRET`, `TASTYTRADE_REFRESH_TOKEN`, and any persisted encrypted refresh token can be used to regain brokerage access.
- **Sensitive financial data** — account numbers, balances, positions, watchlists, orders, and transaction history are private user financial records.
- **Operational telemetry and logs** — `/status` output, metrics, and server logs can expose usage patterns, active sessions, or sensitive authentication material if handled incorrectly.

## Trust Boundaries

- **Remote client to HTTP server** — all `/mcp`, OAuth, and status/health requests originate from untrusted clients and must be validated server-side.
- **Authorization UI to server** — the OAuth approval page accepts a bearer token from a browser and forwards it to the server; this boundary must not leak secrets into logs or unsafe redirects.
- **Server to TastyTrade APIs** — the backend uses privileged credentials and tokens to access brokerage APIs and DXLink streaming; misuse or leakage grants access to real financial operations.
- **Server to local disk** — persisted metrics and the encrypted refresh-token file cross from in-memory secrets into filesystem state.
- **Production vs dev-only automation** — `hooks/` and `scripts/` contain local automation and testing helpers. They should be treated as dev-only unless a production code path invokes them.

## Scan Anchors

- **Production entry points:** `src/index.ts`, `src/oauth-provider.ts`, `src/auth-page.ts`, `src/tastytrade-client.ts`.
- **Highest-risk code areas:** HTTP auth and session handling in `src/index.ts`; OAuth state and token issuance in `src/oauth-provider.ts`; secret persistence in `src/token-store.ts`; high-impact order/backtest tools in `src/tools/order-tools.ts` and `src/tools/backtest-tools.ts`.
- **Public surfaces:** `/.well-known/*`, `/oauth/register`, `/oauth/authorize`, `/oauth/authorize/submit`, `/oauth/token`, `/health`, `/status`.
- **Authenticated surfaces:** `/mcp` GET/POST/DELETE and all registered MCP tools.
- **Dev-only areas to usually ignore:** `hooks/`, `scripts/`, `src/tests/`, `build/`, unless production code is shown to execute them.

## Threat Categories

### Spoofing

The server relies on either `MCP_BEARER_TOKEN` or an internally issued OAuth access token to authenticate HTTP MCP requests. All protected routes must require a valid credential, OAuth code exchange must verify PKCE and client binding correctly, and public endpoints must not make it easier to brute-force or bypass the shared bearer secret.

### Tampering

Authenticated clients can invoke destructive brokerage tools, including order creation, replacement, and cancellation. The server must ensure that only authorized callers can reach those tools and that browser-facing OAuth flows cannot be manipulated to alter authorization state or redirect users in unsafe ways.

### Information Disclosure

This service processes highly sensitive financial and authentication data. Request logs, metrics, status endpoints, and OAuth flows must not expose secrets such as bearer tokens, client secrets, authorization codes, refresh tokens, account identifiers, or other brokerage data beyond what the caller is authorized to see.

### Denial of Service

The HTTP server exposes public endpoints and maintains in-memory session, client, code, and token state. Public routes must resist unbounded memory growth, excessive registration, or other unauthenticated resource-consumption patterns that could degrade brokerage connectivity or make the MCP endpoint unavailable.

### Elevation of Privilege

Any flaw that lets an unauthenticated or lesser-trusted caller obtain MCP access becomes high impact because the server fronts a live brokerage account. OAuth registration, authorization, token issuance, and MCP session handling must not allow callers to gain broader access than intended or reuse another client’s authorization state.

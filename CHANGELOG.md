# Changelog

All notable changes to `@referalli/mcp` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor
bump may include breaking changes; they are called out under **Changed**.

## 0.2.0 - 2026-10-24

- API 2026-11-01 additions: 56 new operations (inbound signup connectors, billing product filters, per-org SSO and partner-portal sign-in, support-tool context cards, data-rights executors, account closure, rewards, integration health, plans, the event feed and bulk webhook replay) and 2 webhook topics (`webhook_endpoint.failing`, `webhook_endpoint.recovered`).
- New error code `reauth_required` (401): sign in again before changing payout details.
- Partner tools: support-context and rewards lookups.

## [Unreleased]

### Added
- First public release: an npx-runnable MCP server (stdio) for the Referalli API, defaulting to https://referalli.com, with confirmed write tools.
- Read-only partner self-service tools `my_referral_link`, `my_balance` and `my_next_payout`, keyed on the partner's `partnerExternalRef` (over `GET /v1/support/context`).

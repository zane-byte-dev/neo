# Security Policy

## Supported Versions

Only the latest commit on the `main` branch receives security updates. Neo is
pre-1.0 software; pin a commit SHA if you depend on it in production.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Instead, report vulnerabilities privately through one of the following:

- GitHub: open a [private security advisory](../../security/advisories/new)
- Email: contact the maintainer (see the GitHub profile of [@ChaoZheng](https://github.com/ChaoZheng))

Please include:

1. A description of the vulnerability and its impact.
2. Steps to reproduce (a minimal proof-of-concept is ideal).
3. Affected commit / version.
4. Any suggested mitigation, if you have one.

We will acknowledge your report within 7 days and aim to provide a fix or
mitigation timeline within 30 days. We will credit you in the release notes
unless you prefer to remain anonymous.

## Scope

In-scope:

- Source code in this repository (`src/`, `web/`, `extension/`).
- Default configuration shipped in `.env.example` and `ecosystem.config.cjs`.

Out of scope:

- Third-party LLM providers (Gemini, DeepSeek, OpenAI, Anthropic, Ollama).
- Vulnerabilities that require physical access to a user's machine.
- Issues that only affect forks with custom modifications.

## Hardening Recommendations for Operators

Neo is designed for personal/single-tenant use. If you self-host, please:

- Always set a long random `SESSION_SECRET` and unique `webToken` per user.
- Put the service behind HTTPS (Caddy / Nginx / Cloudflare).
- Never expose the `/api/webhook/:userId` endpoint without `webhookSecret`.
- Rotate LLM API keys periodically and monitor billing dashboards.

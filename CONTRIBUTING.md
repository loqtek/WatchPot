# Contributing to watchPot

Thank you for your interest in improving watchPot! 

## Code style

- **Python (backend, agent):** Match existing patterns — async SQLAlchemy, typed function signatures, module-level loggers. Keep diffs focused.
- **TypeScript (UI):** ESLint via `npm run lint`; follow existing component and API client conventions.
- **Commits:** Clear, imperative subject lines; one logical change per commit when possible.

## Pull requests

1. Fork and create a feature branch from `main`.
2. Run checks locally (see below).
3. Open a PR with a short summary and test plan.
4. Link related issues when applicable.

## Checks before submitting

```bash
# Frontend
npm run lint
npm run build

# Backend
cd backend
.venv/bin/pytest
.venv/bin/python -m compileall app
```

CI runs the same checks on pull requests.

## Security

See [SECURITY.md](SECURITY.md). Do not include secrets, real tokens, or customer data in PRs.

## Scope

watchPot is a honeypot control plane — changes that expand attack surface should include documentation and secure defaults.

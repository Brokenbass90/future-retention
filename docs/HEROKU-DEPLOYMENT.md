# Heroku deployment

## Runtime

- Node.js 22 and npm 10 are pinned in `package.json`.
- Heroku starts the app through `Procfile`: `web: npm start`.
- `GET /healthz` is the lightweight health endpoint.
- Production UI and APIs should be protected with `APP_AUTH_USER` and
  `APP_AUTH_PASSWORD`.
- `POST /api/figma/import` uses its own `FIGMA_IMPORT_SECRET` and stays
  available to the Figma plugin without browser Basic Auth.

## Required config vars

```text
APP_AUTH_USER
APP_AUTH_PASSWORD
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_MODEL_DISCUSSION
OPENAI_MODEL_TRANSLATIONS
OPENAI_MODEL_DRAFT
OPENAI_MODEL_DESIGN_ANALYSIS
OPENAI_MODEL_CLONE_EDIT
OPENAI_MODEL_FOLLOWUP_EDIT
FIGMA_IMPORT_SECRET
```

Optional:

```text
DEEPL_API_KEY
DEEPL_API_URL
FIGMA_API_TOKEN
```

Never commit `.env` or production credentials.

## Filesystem limitation

Heroku dyno filesystems are ephemeral. The repository content is available
after every deploy, and all read/build/preview features work, but runtime
changes under `data/` or `email-base/` can disappear after a dyno restart or a
new release. This affects uploaded assets, SQLite journal/history, user blocks,
and emails created only through the hosted UI.

Until durable storage is added, Git is the source of truth: make persistent
email-base and block-library changes locally, commit them, push them, and
redeploy. The next infrastructure phase should move structured state to
Postgres and binary assets to S3-compatible object storage.

## Release checks

```bash
npm install
for f in scripts/test-*.mjs; do node "$f"; done
npm start
STUDIO_URL=http://127.0.0.1:3000 npm run smoke
```

After deployment verify:

```text
GET /healthz -> 200
GET / -> 401 without credentials
GET /api/status -> 200 with credentials
```

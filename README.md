# html-upload-view

Lightweight HTML upload + preview website. Upload one or more HTML files and get a hash-based shareable URL. Per-IP daily quota; English/Chinese UI.

## Stack

Node.js (>= 18) + Fastify + better-sqlite3 + Tailwind (CDN) + Lucide. Cross-platform (macOS / Windows).

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

Visit `http://localhost:3000/pageupload`.

## Scripts

| Command            | Purpose                          |
|--------------------|----------------------------------|
| `npm start`        | Run production server            |
| `npm run dev`      | Run with `--watch`               |
| `npm test`         | Run unit tests (`node:test`)     |
| `npm run test:e2e` | Run Playwright end-to-end tests  |

## Configuration (`.env`)

| Var                  | Default                  | Meaning                              |
|----------------------|--------------------------|--------------------------------------|
| `PORT`               | `3000`                   | Listen port                          |
| `PUBLIC_HOST`        | `http://localhost:3000`  | Used to build absolute preview URLs  |
| `DAILY_UPLOAD_LIMIT` | `5`                      | Uploads per IP per UTC day           |
| `MAX_FILE_SIZE_MB`   | `5`                      | Per-file size limit                  |
| `DATA_DIR`           | `./data`                 | HTML files + SQLite storage          |

## URLs

- `GET /pageupload` — upload page
- `GET /view/:hash` — preview page (iframe)
- `GET /raw/:hash` — raw stored HTML
- `POST /api/upload` — multipart upload
- `GET /api/health` — health check

## Layout

See `dev/spec/spec_v1.md` for the full spec.

# Untitled Jam

Untitled Jam is a React whiteboard served by a Python backend built with
FastAPI and Pydantic. Board state remains intentionally local to the browser.
Pasted images can be processed by the FastAPI-only background-removal service;
the original and transparent PNG remain in browser memory for instant restore.

## Project structure

```text
app/
├── index.html
└── src/
    ├── main.tsx
    ├── features/board/     # Whiteboard components, state, types, and utilities
    └── styles/             # Application-wide styles
server/
├── src/untitled_jam/       # FastAPI application and Pydantic models
└── tests/                  # Backend integration tests
public/                     # Static assets copied into the frontend build
```

## Development

Requires Node.js 22.13 or newer and Python 3.11, 3.12, or 3.13.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
npm install
npm run preload:model
npm run dev
```

The Vite frontend runs at `http://127.0.0.1:5173` and proxies `/api` requests
to FastAPI at `http://127.0.0.1:8000`.

### Background-removal model

The backend pins `rembg[cpu]` and reuses one full `birefnet-general` session.
Set `REMBG_HOME` to a durable, writable model-cache directory, then preload the
model during development setup or while building a production image:

```bash
export REMBG_HOME=/var/cache/untitled-jam/rembg
npm run preload:model
```

`UNTITLED_JAM_BACKGROUND_REMOVAL_MODEL` can select a different server-side
model; it defaults to `birefnet-general` and is never supplied by the browser.
Model initialization happens during FastAPI startup, so a missing or unloadable
model prevents the instance from becoming ready. Run exactly one Uvicorn worker
per instance: the process permits one CPU inference at a time and returns `503`
with `Retry-After: 5` instead of queueing concurrent work.

`POST /api/images/remove-background` accepts raw PNG, JPEG, or WebP bytes and
returns an RGBA PNG. Existing source transparency is preserved when the model
mask is applied. Requests are limited to 15 MiB, 12.5 million pixels, and 6,000
pixels on either axis; output is limited to 32 MiB. Images are never written to
disk or included in logs.

## Production

```bash
npm run build
npm start
```

FastAPI serves both the API and compiled React application at
`http://127.0.0.1:8000`. Health status is available at `/api/health`, and the
generated API documentation is available at `/api/docs`.

The OpenAI Sites/Cloudflare build remains available through
`npm run build:site`, but intentionally omits the background-removal menu action
because that runtime does not include the Python inference service.

## Tests

With a supported Python virtual environment active:

```bash
npm test
```

This runs Vitest/React Testing Library followed by the fake-injected FastAPI
suite without downloading model weights. After preloading the model, the
non-default smoke test can be run with:

```bash
RUN_REAL_BACKGROUND_REMOVAL_TEST=1 python -m pytest -m real_model
```

The model and package projects are available under their MIT licenses:
[BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet) and
[`rembg`](https://pypi.org/project/rembg/2.0.84/).

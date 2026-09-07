# Untitled Jam

Untitled Jam is a React whiteboard served by a Python backend built with
FastAPI and Pydantic. Board state remains intentionally local to the browser,
so the backend migration does not change the whiteboard's behavior.

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

Requires Node.js 22.13 or newer and Python 3.9 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
npm install
npm run dev
```

The Vite frontend runs at `http://127.0.0.1:5173` and proxies `/api` requests
to FastAPI at `http://127.0.0.1:8000`.

## Production

```bash
npm run build
npm start
```

FastAPI serves both the API and compiled React application at
`http://127.0.0.1:8000`. Health status is available at `/api/health`, and the
generated API documentation is available at `/api/docs`.

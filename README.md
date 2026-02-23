# Windows Desktop Agent MVP

## Electron Implementation

The requested Electron + React + TypeScript desktop app is implemented in `desktop-agent/`.

Quick start for that app:

```bash
cd desktop-agent
npm install
npm run build
npm run dev
```

Python monorepo MVP for a vision-action desktop agent with:
- `planner-api` (FastAPI): screenshot + context in, one structured action out.
- `executor` (local runner): capture screen, call planner, enforce safety, execute actions.

## Repository Layout

- `apps/planner_api/`: planner web API and session management.
- `apps/executor/`: local loop runner and CLI.
- `packages/contracts/`: shared Pydantic models, action normalization, schema export.
- `packages/perception/`: OCR and UI candidate grounding.
- `packages/policy/`: risk scoring and executor-side policy engine.
- `tests/`: unit, integration, and e2e-style harness tests.

## Quick Start

1. Install:

```bash
pip install -e .[dev]
```

2. Start planner API:

```bash
uvicorn apps.planner_api.main:app --reload --port 8001
```

3. Start a session:

```bash
python -m apps.executor.cli start-session --task "Open browser and go to github.com" --api-url http://localhost:8001
```

4. Run loop (dry-run by default):

```bash
python -m apps.executor.cli run --session-id <SESSION_ID> --api-url http://localhost:8001 --dry-run
```

5. If confirmation is required:

```bash
python -m apps.executor.cli confirm --session-id <SESSION_ID> --confirmation-id <CONFIRMATION_ID> --api-url http://localhost:8001
```

## Notes

- Windows-first MVP.
- `speak` action is intentionally unsupported in v1.
- Scheduled automation is out of scope for this version.

# Semantic Automation Runtime (Windows v1)

This runtime adds a semantic-first execution layer on top of the existing screenshot loop.

## Surfaces

- `uia`: Windows UI Automation through a local Python sidecar (`sidecar/uia_service.py`)
- `chrome_cdp`: Managed Chrome profile over remote debugging/CDP
- `screenshot_fallback`: Existing screenshot + coordinate fallback path

## Execution Order

1. Parse user intent into `IntentSpec`.
2. Planner proposes one action (semantic actions preferred).
3. Runtime tries semantic execution first (`uia` or `chrome_cdp`).
4. If semantic execution fails with retryable reason, retry once.
5. If still failing, switch to screenshot fallback and continue.

## Environment

- `AGENT_SEMANTIC_AUTOMATION_ENABLED=true`
- `AGENT_SEMANTIC_RETRY_COUNT=1`
- `AGENT_BROWSER_BLOCKLIST=example.com,*.internal.local`
- `AGENT_CHROME_DEBUG_PORT=9222`
- `AGENT_CHROME_PROFILE_MODE=system`
- `AGENT_CHROME_PROFILE_DIR=./.agent/chrome-profile`
- `AGENT_CHROME_SYSTEM_USER_DATA_DIR=`
- `AGENT_CHROME_SYSTEM_PROFILE=auto`
- `AGENT_PY_SIDECAR_PYTHON=.venv/Scripts/python.exe`
- `AGENT_PY_SIDECAR_PORT=8765`

## Bootstrap Sidecar

```powershell
.\scripts\bootstrap-sidecar.ps1
```

This creates a project-local Python virtual environment, installs sidecar dependencies, and starts the local UIA service.

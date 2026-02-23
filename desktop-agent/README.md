# Desktop Agent (Electron + React + TypeScript)

Windows-first autonomous desktop agent with:

- Floating chat UI
- Hybrid command intent parser (deterministic + LLM fallback)
- Semantic-first execution:
  - Windows UI Automation (Python sidecar)
  - Chrome native automation (CDP, managed profile)
- Screenshot + coordinate fallback when semantic targeting fails
- Safety controls (blocked terms, domain blocklist, confirmations)
- SQLite task history + scheduled task scaffolding

## Setup

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
```

Set at minimum:

- `OPENAI_API_KEY`
- `OPENAI_PLANNER_MODEL` (default `gpt-4o`)
- `OPENAI_INTENT_MODEL` (default `gpt-4o-mini`)

Optional semantic runtime settings:

- `AGENT_SEMANTIC_AUTOMATION_ENABLED=true`
- `AGENT_SEMANTIC_RETRY_COUNT=1`
- `AGENT_BROWSER_BLOCKLIST=example.com,*.internal.local`
- `AGENT_CHROME_DEBUG_PORT=9222`
- `AGENT_CHROME_PROFILE_MODE=system` (`system` uses your signed-in Chrome profile; `managed` uses isolated agent profile)
- `AGENT_CHROME_PROFILE_DIR=./.agent/chrome-profile`
- `AGENT_CHROME_SYSTEM_USER_DATA_DIR=` (optional override)
- `AGENT_CHROME_SYSTEM_PROFILE=auto` (`auto` uses Chrome `Local State` last-used profile)
- `AGENT_PY_SIDECAR_PYTHON=.venv/Scripts/python.exe`
- `AGENT_PY_SIDECAR_PORT=8765`

3. Bootstrap Windows UIA sidecar (recommended on Windows)

```powershell
.\scripts\bootstrap-sidecar.ps1
```

4. Run in development mode

```bash
npm run dev
```

## Command Terms (Launch Modal)

On first launch, the app shows a command-terms modal. Recommended forms:

- `open <app>`
- `go to <url>`
- `click <element>` or `click 200,300`
- `type "text" in <field>`
- `press ctrl+s`
- `scroll up/down`
- `stop`

## Execution Modes

Chat header shows current mode:

- `chrome_cdp`: semantic browser execution through Chrome devtools
- `uia`: semantic desktop execution through Windows UI Automation
- `screenshot_fallback`: semantic route failed; fallback planning active
- `coordinate`: direct coordinate/mouse-keyboard execution

## Notes

- Semantic runtime is enabled by default on Windows when `AGENT_SEMANTIC_AUTOMATION_ENABLED=true`.
- If UIA sidecar is unavailable, the app stays functional and uses screenshot fallback.
- `speak` remains a schema placeholder and is not executed.

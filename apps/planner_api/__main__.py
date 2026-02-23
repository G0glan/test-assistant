from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run("apps.planner_api.main:app", host="127.0.0.1", port=8001, reload=False)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import logging
from dataclasses import asdict

from apps.executor.client import PlannerApiClient
from apps.executor.logging_utils import configure_logging
from apps.executor.runner import run_session
from apps.executor.state import (
    SessionRuntimeState,
    delete_session_state,
    load_session_state,
    save_session_state,
)
from packages.contracts.models import ConfirmRequest, Constraints, StartSessionRequest

logger = logging.getLogger("executor.cli")


def _cmd_start_session(args: argparse.Namespace) -> None:
    client = PlannerApiClient(args.api_url)
    req = StartSessionRequest(task=args.task, constraints=Constraints(max_steps=args.max_steps))
    session = client.start_session(req)
    state = SessionRuntimeState(session_id=session.session_id, task=args.task)
    save_session_state(state)
    print(session.session_id)


def _cmd_run(args: argparse.Namespace) -> None:
    state = load_session_state(args.session_id)
    if not state:
        raise SystemExit(f"Session {args.session_id} not found in local state.")
    client = PlannerApiClient(args.api_url)
    constraints = Constraints(max_steps=args.max_steps)
    new_state = run_session(
        client=client,
        state=state,
        constraints=constraints,
        dry_run=args.dry_run,
        max_retries=args.max_retries,
    )
    print(asdict(new_state))


def _cmd_confirm(args: argparse.Namespace) -> None:
    state = load_session_state(args.session_id)
    if not state:
        raise SystemExit(f"Session {args.session_id} not found in local state.")
    client = PlannerApiClient(args.api_url)
    result = client.confirm(
        session_id=args.session_id,
        req=ConfirmRequest(confirmation_id=args.confirmation_id, approved=not args.reject),
    )
    if result.status == "approved":
        state.pending_confirmation_id = None
        save_session_state(state)
    print(result.model_dump(mode="json"))


def _cmd_abort(args: argparse.Namespace) -> None:
    deleted = delete_session_state(args.session_id)
    print({"session_id": args.session_id, "deleted": deleted})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Desktop Agent Executor CLI")
    parser.add_argument("--api-url", default="http://localhost:8001")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start-session")
    start.add_argument("--task", required=True)
    start.add_argument("--max-steps", type=int, default=50)
    start.set_defaults(func=_cmd_start_session)

    run = sub.add_parser("run")
    run.add_argument("--session-id", required=True)
    run.add_argument("--max-steps", type=int, default=50)
    run.add_argument("--max-retries", type=int, default=1)
    run.add_argument("--dry-run", action="store_true", default=True)
    run.add_argument("--no-dry-run", action="store_false", dest="dry_run")
    run.set_defaults(func=_cmd_run)

    confirm = sub.add_parser("confirm")
    confirm.add_argument("--session-id", required=True)
    confirm.add_argument("--confirmation-id", required=True)
    confirm.add_argument("--reject", action="store_true")
    confirm.set_defaults(func=_cmd_confirm)

    abort = sub.add_parser("abort")
    abort.add_argument("--session-id", required=True)
    abort.set_defaults(func=_cmd_abort)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    configure_logging(verbose=args.verbose)
    args.func(args)


if __name__ == "__main__":
    main()

"""HTTP + WebSocket API in front of one validator.

REST: POST /tx, GET /book/{market}, GET /account/{trader}, GET /markets, GET /status.
WS:   /ws streams book updates, fills and new blocks.
Serves ui.html at /.

Budget: < 1,000 lines.
"""

from __future__ import annotations

from fastapi import FastAPI


def create_app(node: object) -> FastAPI:
    app = FastAPI(title="tiny")
    raise NotImplementedError
    return app

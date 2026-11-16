"""Fund a trader on a running sim through the bridge, the way a real deposit arrives.

    uv run python -m sim.fund <trader public key hex> [--usdc 1000000] [--api http://127.0.0.1:8000]

The oracle posts a header for a fresh source-chain height, then the relayer proves one deposit
message against it. Both go through POST /tx, so the credit is in a block and survives restarts.
The API does not expose which source heights and message nonces the bridge has seen, so both come
from the clock, which keeps them unique from one run to the next.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

from core.api import TxJson
from core.bridge import merkle_proof, merkle_root, message_leaf, sealed_block_hash
from core.node import public_key, sign, sign_tx
from core.types import (
    USDC_SCALE,
    BlockHeader,
    BridgeMessage,
    Deposit,
    MessageProof,
    PostHeader,
    Tx,
    encode,
)
from sim.bridge import DEPOSIT_SENDER, ORACLE_KEY, RELAYER_KEY, SOURCE_CHAIN

WAIT_S = 30.0


def deposit_txs(
    recipient: str,
    amount: int,
    src_height: int,
    message_nonce: int,
    oracle_nonce: int,
    relayer_nonce: int,
) -> tuple[Tx, Tx]:
    """The PostHeader and the Deposit that credit `amount` to `recipient`, in that order."""
    message = BridgeMessage(
        SOURCE_CHAIN, src_height, message_nonce, DEPOSIT_SENDER, recipient, amount
    )
    leaves = [message_leaf(message)]
    root = merkle_root(leaves)
    header = BlockHeader(
        SOURCE_CHAIN, src_height, sealed_block_hash(SOURCE_CHAIN, src_height, root), root
    )
    post = sign_tx(ORACLE_KEY, PostHeader(header, sign(ORACLE_KEY, encode(header))), oracle_nonce)
    proof = MessageProof(message, 0, merkle_proof(leaves, 0))
    return post, sign_tx(RELAYER_KEY, Deposit(proof), relayer_nonce)


def _get(api: str, path: str) -> dict[str, object] | None:
    try:
        with urllib.request.urlopen(api + path) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise


def _nonce(api: str, key: bytes) -> int:
    account = _get(api, "/account/" + public_key(key).hex())
    return int(account["nonce"]) if account else 0  # type: ignore[call-overload]


def _post(api: str, tx: Tx) -> None:
    req = urllib.request.Request(
        api + "/tx",
        data=TxJson(tx).model_dump_json().encode(),
        # As the UI sends it: with application/json, FastAPI decodes the body before the
        # handler's raw-bytes parameter sees it.
        headers={"content-type": "application/octet-stream"},
    )
    with urllib.request.urlopen(req) as res:
        res.read()


def _committed(api: str, key: bytes, nonce: int) -> None:
    deadline = time.monotonic() + WAIT_S
    while _nonce(api, key) < nonce:
        if time.monotonic() > deadline:
            raise TimeoutError(f"nonce {nonce} for {public_key(key).hex()} did not commit")
        time.sleep(0.2)


def fund(api: str, recipient: str, amount: int) -> int:
    """Credit `amount` to `recipient` and return its collateral afterwards."""
    stamp = time.time_ns()
    oracle_nonce = _nonce(api, ORACLE_KEY) + 1
    relayer_nonce = _nonce(api, RELAYER_KEY) + 1
    post, deposit = deposit_txs(
        recipient, amount, stamp // 1_000_000, stamp, oracle_nonce, relayer_nonce
    )
    _post(api, post)
    _committed(api, ORACLE_KEY, oracle_nonce)
    _post(api, deposit)
    _committed(api, RELAYER_KEY, relayer_nonce)
    account = _get(api, "/account/" + recipient)
    return int(account["collateral"]) if account else 0  # type: ignore[call-overload]


def main() -> None:
    parser = argparse.ArgumentParser(description="Fund a trader on a running sim")
    parser.add_argument("trader", help="the trader's public key, 64 hex characters")
    parser.add_argument("--usdc", type=int, default=1_000_000)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    if len(bytes.fromhex(args.trader)) != 32:
        parser.error("trader must be a 32-byte public key in hex")
    collateral = fund(args.api.rstrip("/"), args.trader.lower(), args.usdc * USDC_SCALE)
    print(f"{args.trader} now has {collateral / USDC_SCALE:,.2f} USDC collateral")


if __name__ == "__main__":
    main()

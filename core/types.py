"""Shared data types. Data only: no logic beyond small helpers like hashing and encoding.

Everything that crosses a file boundary (consensus <-> state, state <-> api, bridge <-> state)
is defined here. All amounts and prices are integers (fixed-point) so the state machine stays
deterministic across validators.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

NodeId = int
View = int
Hash = bytes  # 32-byte SHA-256

PRICE_SCALE = 10**6  # prices are integers in 1e-6 units
SIZE_SCALE = 10**6  # sizes are integers in 1e-6 units
USDC_SCALE = 10**6  # balances are integers in 1e-6 USDC


def sha256(data: bytes) -> Hash:
    return hashlib.sha256(data).digest()


# ---------------------------------------------------------------- consensus


@dataclass(frozen=True)
class QC:
    """Quorum certificate: 2f+1 signatures over one block."""

    view: View
    block_hash: Hash
    sigs: dict[NodeId, bytes]


@dataclass(frozen=True)
class TC:
    """Timeout certificate: 2f+1 timeouts for one view, carrying the highest QC seen."""

    view: View
    high_qc: QC
    sigs: dict[NodeId, bytes]


@dataclass(frozen=True)
class Block:
    parent: Hash
    proposer: NodeId
    view: View
    qc: QC  # justifies the parent
    txs: tuple[Tx, ...]
    timestamp_ms: int

    def to_bytes(self) -> bytes:
        raise NotImplementedError  # canonical encoding, used for hashing and signing

    @property
    def hash(self) -> Hash:
        return sha256(self.to_bytes())


@dataclass(frozen=True)
class Proposal:
    block: Block
    tc: TC | None = None  # set when the previous view timed out


@dataclass(frozen=True)
class Vote:
    view: View
    block_hash: Hash
    voter: NodeId
    sig: bytes


@dataclass(frozen=True)
class Timeout:
    view: View
    high_qc: QC
    sender: NodeId
    sig: bytes


@dataclass(frozen=True)
class NewView:
    view: View
    high_qc: QC
    sender: NodeId


# ---------------------------------------------------------------- exchange


class Side(Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(Enum):
    LIMIT = "limit"
    MARKET = "market"


@dataclass(frozen=True)
class Order:
    id: int
    trader: str
    market: str
    side: Side
    type: OrderType
    price: int  # PRICE_SCALE; ignored for market orders
    size: int  # SIZE_SCALE
    reduce_only: bool = False


@dataclass(frozen=True)
class Fill:
    market: str
    maker_order: int
    taker_order: int
    maker: str
    taker: str
    price: int
    size: int
    taker_side: Side


@dataclass
class Position:
    market: str
    size: int = 0  # signed: >0 long, <0 short
    entry_notional: int = 0
    funding_index: int = 0  # cumulative funding index at last settlement


@dataclass
class Account:
    trader: str
    collateral: int = 0  # USDC_SCALE
    positions: dict[str, Position] = field(default_factory=dict)
    nonce: int = 0


@dataclass(frozen=True)
class Market:
    name: str  # e.g. "BTC-PERP"
    tick_size: int
    lot_size: int
    max_leverage: int
    maintenance_margin_bps: int


@dataclass(frozen=True)
class OraclePrice:
    market: str
    price: int
    timestamp_ms: int
    sigs: dict[NodeId, bytes]


# ---------------------------------------------------------------- bridge


@dataclass(frozen=True)
class BlockHeader:
    """A source-chain header as posted by the bridge oracle (LayerZero v1 style)."""

    chain_id: int
    height: int
    block_hash: Hash
    receipts_root: Hash


@dataclass(frozen=True)
class BridgeMessage:
    src_chain: int
    src_height: int
    nonce: int
    sender: str
    recipient: str
    amount: int  # USDC_SCALE


@dataclass(frozen=True)
class MessageProof:
    """Relayer-supplied Merkle proof that a message is in a posted header's receipts root."""

    message: BridgeMessage
    leaf_index: int
    siblings: tuple[Hash, ...]


# ---------------------------------------------------------------- transactions
# Each body carries a `kind` tag so a TxBody can be decoded from JSON without guessing.


@dataclass(frozen=True)
class PlaceOrder:
    order: Order
    kind: Literal["place_order"] = "place_order"


@dataclass(frozen=True)
class CancelOrder:
    trader: str
    market: str
    order_id: int
    kind: Literal["cancel_order"] = "cancel_order"


@dataclass(frozen=True)
class SetOraclePrice:
    price: OraclePrice
    kind: Literal["set_oracle_price"] = "set_oracle_price"


@dataclass(frozen=True)
class PostHeader:
    header: BlockHeader
    oracle_sig: bytes
    kind: Literal["post_header"] = "post_header"


@dataclass(frozen=True)
class Deposit:
    proof: MessageProof
    kind: Literal["deposit"] = "deposit"


@dataclass(frozen=True)
class Withdraw:
    trader: str
    amount: int
    dest_chain: int
    dest_address: str
    kind: Literal["withdraw"] = "withdraw"


TxBody = PlaceOrder | CancelOrder | SetOraclePrice | PostHeader | Deposit | Withdraw


@dataclass(frozen=True)
class Tx:
    body: TxBody
    signer: str
    nonce: int
    sig: bytes

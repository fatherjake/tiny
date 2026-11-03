export type Scaled = number | string | bigint;

export type MarketInfo = {
  name: string;
  tick_size: Scaled;
  lot_size: Scaled;
  max_leverage: number;
  maintenance_margin_bps: number;
  oracle_price: Scaled | null;
  mark_price: Scaled | null;
  funding_index: Scaled | null;
  funding_ts: number | null;
  funding_base: FundingRow | null;
};

export type Level = [Scaled, Scaled];

export type Depth = {
  best_bid?: Scaled | null;
  best_ask?: Scaled | null;
  oracle_price?: Scaled | null;
  mark_price?: Scaled | null;
  bids?: Level[];
  asks?: Level[];
};

export type Trade = {
  seq: number;
  height: number;
  timestamp_ms: number;
  market: string;
  side: "buy" | "sell";
  price: Scaled;
  size: Scaled;
};

export type BlockTx = {
  kind: string;
  signer: string;
  nonce: number;
};

export type BlockMsg = {
  type: "block";
  height: number;
  hash: string;
  view: number;
  txs?: BlockTx[];
};

export type BookMsg = Depth & { type: "book"; market: string };
export type TradeMsg = Trade & { type: "trade" };
export type WsMessage = BlockMsg | BookMsg | TradeMsg;

export type Status = {
  node?: number;
  height?: number;
  view?: number;
  tip?: string | null;
  mempool?: number;
  state_root?: string;
};

export type Position = {
  market: string;
  size: Scaled;
  entry_notional: Scaled;
};

export type OpenOrder = {
  id: number;
  market: string;
  side: "buy" | "sell";
  price: Scaled;
  size: Scaled;
};

export type AccountView = {
  trader: string;
  collateral: Scaled;
  nonce: number;
  positions?: Record<string, Position>;
  orders?: OpenOrder[];
  account_value?: Scaled;
  maintenance_margin?: Scaled;
};

export type OrderDraft = {
  side: "buy" | "sell";
  type: "limit" | "market";
  usd: string; // order size in dollars
  price: string;
  reduceOnly: boolean;
};

export type LinePoint = { time: number; value: number };
export type Candle = { time: number; open: number; high: number; low: number; close: number };

export type StoredTrade = {
  id: number;
  height: number;
  tx_index: number;
  market: string;
  price: Scaled;
  size: Scaled;
  taker: string;
  maker: string;
  side: "buy" | "sell";
  liquidation: boolean;
  ts: number;
};

export type StoredOrder = {
  order_id: number;
  trader: string;
  market: string;
  side: "buy" | "sell";
  type: string;
  price: Scaled;
  size: Scaled;
  remaining: Scaled;
  status: string;
  reason: string;
  created_height: number;
  updated_height: number;
};

export type StoredCandle = {
  ts: number;
  open: Scaled;
  high: Scaled;
  low: Scaled;
  close: Scaled;
  volume?: Scaled;
};

export type FundingRow = {
  height: number;
  market: string;
  index: Scaled;
  rate: Scaled;
  ts: number;
};

export type Series = {
  ticks?: LinePoint[];
  bars?: Candle[];
};

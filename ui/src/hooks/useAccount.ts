import { useQuery } from "@tanstack/react-query";

import {
  accountQuery,
  fillsQuery,
  openOrdersQuery,
  orderHistoryQuery,
} from "../lib/accountQueries";
import type { AccountView } from "../types";

// The trader is "" until a key is enabled, which leaves every query idle.

const NONE: never[] = [];

export function useAccount(trader: string) {
  return (
    useQuery({ ...accountQuery(trader), enabled: trader !== "" }).data ?? null
  );
}

export function useAccountSelect<T>(
  trader: string,
  select: (account: AccountView | null) => T,
) {
  return useQuery({ ...accountQuery(trader), enabled: trader !== "", select })
    .data;
}

export function useOpenOrders(trader: string) {
  return (
    useQuery({ ...openOrdersQuery(trader), enabled: trader !== "" }).data ??
    NONE
  );
}

export function useOrderHistory(trader: string) {
  return (
    useQuery({ ...orderHistoryQuery(trader), enabled: trader !== "" }).data ??
    NONE
  );
}

export function useFills(trader: string) {
  return (
    useQuery({ ...fillsQuery(trader), enabled: trader !== "" }).data ?? NONE
  );
}

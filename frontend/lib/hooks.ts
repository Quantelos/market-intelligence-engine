"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDashboardData } from "@/lib/api";
import { DashboardData, DashboardQuery, PriceWithSignalPoint } from "@/types/dashboard";

export interface UseDashboardDataResult {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDashboardData(query: DashboardQuery): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  const stableQuery = useMemo(() => query, [query]);

  const refresh = useCallback(() => {
    setRefreshToken((v) => v + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const payload = await fetchDashboardData(stableQuery);
        if (!cancelled) {
          setData(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [stableQuery, refreshToken]);

  return { data, loading, error, refresh };
}

interface CandleUpdateMessage {
  type: "candle_update";
  symbol: string;
  timeframe: string;
  candle: {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}

export function useMarketWebSocket(
  symbol: string,
  timeframe: string,
  initialCandles: PriceWithSignalPoint[],
): { connected: boolean; candles: PriceWithSignalPoint[] } {
  const [connected, setConnected] = useState(false);
  const [candles, setCandles] = useState<PriceWithSignalPoint[]>(initialCandles);

  useEffect(() => {
    setCandles(initialCandles);
  }, [initialCandles]);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";
    const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? `${apiBase.replace(/^http/, "ws")}/ws/market`;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = 1000;
    let isActive = true;

    const connect = () => {
      if (!isActive) return;
      ws = new WebSocket(`${wsBase}?symbol=${symbol}&timeframe=${timeframe}`);

      ws.onopen = () => {
        setConnected(true);
        reconnectDelayMs = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as CandleUpdateMessage;
          if (msg.type !== "candle_update") return;

          const incoming: PriceWithSignalPoint = {
            timestamp: msg.candle.timestamp,
            open: msg.candle.open,
            high: msg.candle.high,
            low: msg.candle.low,
            close: msg.candle.close,
            volume: msg.candle.volume,
            signal: null,
            maFast: null,
            maSlow: null,
          };

          setCandles((prev) => {
            if (prev.length === 0) return [incoming];

            const last = prev[prev.length - 1];
            if (last.timestamp === incoming.timestamp) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...incoming,
                signal: last.signal ?? null,
                maFast: last.maFast ?? null,
                maSlow: last.maSlow ?? null,
              };
              return updated;
            }

            const next = [...prev, incoming];
            if (next.length > 500) {
              next.splice(0, next.length - 500);
            }
            return next;
          });
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!isActive) return;
        reconnectTimer = setTimeout(connect, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000);
      };
    };

    connect();

    return () => {
      isActive = false;
      setConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState <= WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [symbol, timeframe]);

  return { connected, candles };
}

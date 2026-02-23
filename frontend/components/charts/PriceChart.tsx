"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import { PriceWithSignalPoint } from "@/types/dashboard";
import ChartWrapper from "@/components/ui/ChartWrapper";
import { useMarketWebSocket } from "@/lib/hooks";

interface PriceChartProps {
  symbol: string;
  timeframe: string;
  data: PriceWithSignalPoint[];
  loading: boolean;
  error: string | null;
  showMA: boolean;
}

export default function PriceChart({ symbol, timeframe, data, loading, error, showMA }: PriceChartProps) {
  const { connected, candles } = useMarketWebSocket(symbol, timeframe, data);
  const chartData = useMemo(
    () =>
      candles.map((d) => ({
        ...d,
        timestamp: String(d.timestamp),
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
        volume: Number(d.volume),
      })),
    [candles],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end text-xs">
        <span className={connected ? "text-bull" : "text-bear"}>{connected ? "Live" : "Disconnected"}</span>
      </div>

      <ChartWrapper loading={loading} error={error} height={330}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 0, left: 6 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="0" />
            <XAxis dataKey="timestamp" type="category" hide />
            <YAxis domain={["dataMin", "dataMax"]} tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #1f2937" }}
              labelStyle={{ color: "#e5e7eb" }}
            />
            <Line type="monotone" dataKey="close" stroke="#60a5fa" dot={false} isAnimationActive={false} />
            {showMA ? null : null}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrapper>

      <ChartWrapper loading={loading} error={error} height={160}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid stroke="#1f2937" />
            <XAxis dataKey="timestamp" tick={{ fill: "#9ca3af", fontSize: 11 }} minTickGap={26} />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1f2937" }} />
            <Bar dataKey="volume" fill="#374151" />
          </BarChart>
        </ResponsiveContainer>
      </ChartWrapper>
    </div>
  );
}

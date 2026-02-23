import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone

import websockets
from fastapi import WebSocket

TIMEFRAME_SECONDS: dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
}


@dataclass
class CandleState:
    bucket_start: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketStreamHub:
    def __init__(self, symbol: str, timeframe: str):
        self.symbol = symbol.upper()
        self.timeframe = timeframe
        self.clients: set[WebSocket] = set()
        self._stream_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.clients.add(websocket)
            if self._stream_task is None or self._stream_task.done():
                self._stop_event = asyncio.Event()
                self._stream_task = asyncio.create_task(self._run_stream())

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self.clients.discard(websocket)
            if not self.clients and self._stream_task and not self._stream_task.done():
                self._stop_event.set()
                self._stream_task.cancel()

    async def broadcast(self, payload: dict) -> None:
        disconnected: list[WebSocket] = []
        for client in list(self.clients):
            try:
                await client.send_json(payload)
            except Exception:
                disconnected.append(client)

        if disconnected:
            async with self._lock:
                for client in disconnected:
                    self.clients.discard(client)

    async def _run_stream(self) -> None:
        stream_url = f"wss://stream.binance.com:9443/ws/{self.symbol.lower()}@trade"
        reconnect_delay = 1
        candle: CandleState | None = None
        last_emit_at = 0.0
        emit_interval_seconds = 1.0

        while not self._stop_event.is_set():
            try:
                async with websockets.connect(stream_url, ping_interval=20, ping_timeout=20) as ws:
                    reconnect_delay = 1
                    async for message in ws:
                        if self._stop_event.is_set():
                            break

                        try:
                            trade = json.loads(message)
                            price = float(trade["p"])
                            quantity = float(trade["q"])
                            event_time_ms = int(trade["E"])
                        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                            continue

                        bucket_start = self._bucket_start(event_time_ms)
                        if candle is None or bucket_start != candle.bucket_start:
                            candle = CandleState(
                                bucket_start=bucket_start,
                                open=price,
                                high=price,
                                low=price,
                                close=price,
                                volume=quantity,
                            )
                            await self.broadcast(self._build_candle_update(candle))
                            last_emit_at = asyncio.get_running_loop().time()
                        else:
                            candle.high = max(candle.high, price)
                            candle.low = min(candle.low, price)
                            candle.close = price
                            candle.volume += quantity

                        now = asyncio.get_running_loop().time()
                        if now - last_emit_at >= emit_interval_seconds:
                            await self.broadcast(self._build_candle_update(candle))
                            last_emit_at = now
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2, 30)

    def _build_candle_update(self, candle: CandleState) -> dict:
        return {
            "type": "candle_update",
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "candle": {
                "timestamp": datetime.fromtimestamp(
                    candle.bucket_start,
                    tz=timezone.utc,
                ).isoformat(),
                "open": candle.open,
                "high": candle.high,
                "low": candle.low,
                "close": candle.close,
                "volume": candle.volume,
            },
        }

    def _bucket_start(self, event_time_ms: int) -> int:
        seconds = event_time_ms // 1000
        bucket_seconds = TIMEFRAME_SECONDS[self.timeframe]
        return (seconds // bucket_seconds) * bucket_seconds


_hubs: dict[tuple[str, str], MarketStreamHub] = {}


def get_market_hub(symbol: str, timeframe: str) -> MarketStreamHub:
    key = (symbol.upper(), timeframe)
    if key not in _hubs:
        _hubs[key] = MarketStreamHub(symbol=symbol, timeframe=timeframe)
    return _hubs[key]

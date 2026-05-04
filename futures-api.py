"""
Futures data + analysis API — runs inside the same container as Next.js on port 8888.
Serves AKShare data and GPT-5.4 analysis for the futures K-line charting module.
"""

import os
import json
import akshare as ak
import pandas as pd
import numpy as np
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import httpx

app = FastAPI(title="Futures Data API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

OPENAI_MODEL = "gpt-5.4"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"


# ===================== VARIETIES =====================

@app.get("/api/varieties")
def get_varieties():
    """Return all futures varieties grouped by exchange."""
    df = ak.futures_fees_info()
    varieties = df.groupby("品种名称").agg({
        "品种代码": "first",
        "交易所": "first",
        "合约乘数": "first",
        "最新价": "first",
    }).reset_index()
    varieties = varieties.sort_values(["交易所", "品种代码"])

    result = {}
    for _, row in varieties.iterrows():
        ex = row["交易所"]
        if ex not in result:
            result[ex] = []
        result[ex].append({
            "code": row["品种代码"],
            "name": row["品种名称"],
            "multiplier": row["合约乘数"],
            "price": float(row["最新价"]) if pd.notna(row["最新价"]) else None,
        })
    return result


# ===================== KLINE =====================

@app.get("/api/kline")
def get_kline(
    symbol: str = Query(..., description="e.g. AU0, RB0, I0"),
    start_date: str = Query("20240101"),
    end_date: str = Query("20261231"),
    period: str = Query("daily", description="daily, weekly, monthly, 30, 60"),
):
    """Return OHLCV data for a futures main contract."""
    if period in ("30", "60"):
        df = ak.futures_zh_minute_sina(symbol=symbol, period=period)
        records = []
        for _, row in df.iterrows():
            dt = pd.to_datetime(row["datetime"])
            records.append({
                "time": int(dt.timestamp()),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": int(row["volume"]),
            })
        return records

    df = ak.futures_main_sina(symbol=symbol, start_date=start_date, end_date=end_date)
    df["日期"] = pd.to_datetime(df["日期"])

    if period == "weekly":
        df = df.set_index("日期")
        df = df.resample("W-FRI").agg({"开盘价": "first", "最高价": "max", "最低价": "min", "收盘价": "last", "成交量": "sum"}).dropna()
        df = df.reset_index()
    elif period == "monthly":
        df = df.set_index("日期")
        df = df.resample("M").agg({"开盘价": "first", "最高价": "max", "最低价": "min", "收盘价": "last", "成交量": "sum"}).dropna()
        df = df.reset_index()

    records = []
    for _, row in df.iterrows():
        records.append({
            "time": str(row["日期"].date()) if hasattr(row["日期"], "date") else str(row["日期"]),
            "open": float(row["开盘价"]),
            "high": float(row["最高价"]),
            "low": float(row["最低价"]),
            "close": float(row["收盘价"]),
            "volume": int(row["成交量"]),
        })
    return records


# ===================== ANALYZE =====================

def gather_futures_data(variety_code: str) -> dict:
    """Gather all data needed for the analysis prompt."""
    data = {}
    upper = variety_code.upper()

    # 1. Contract specs
    try:
        df_fees = ak.futures_fees_info()
        rows = df_fees[df_fees['品种代码'].str.upper() == upper]
        if not rows.empty:
            r = rows.iloc[0]
            data["contract"] = {
                "exchange": r["交易所"], "name": r["品种名称"], "code": r["品种代码"],
                "multiplier": float(r["合约乘数"]), "tick": float(r["最小跳动"]),
                "margin_rate": float(r["做多保证金率"]),
                "open_fee": float(r["开仓费用/手"]), "close_fee": float(r["平仓费用/手"]),
                "intraday_fee": float(r["平今费用/手"]),
            }
            data["contracts_list"] = []
            for _, cr in rows.iterrows():
                data["contracts_list"].append({
                    "code": cr["合约代码"], "price": float(cr["最新价"]) if pd.notna(cr["最新价"]) else None,
                    "volume": int(cr["成交量"]) if pd.notna(cr["成交量"]) else 0,
                    "oi": int(cr["持仓量"]) if pd.notna(cr["持仓量"]) else 0,
                })
    except Exception as e:
        data["contract_error"] = str(e)

    # 2. Realtime term structure
    try:
        symbol_map = ak.futures_symbol_mark()
        cn_name = None
        for _, r in symbol_map.iterrows():
            if r["symbol"].upper().replace("沪", "").replace("国际", "") == upper or upper.lower() in r["mark"]:
                cn_name = r["symbol"]
                break
        if cn_name:
            df_rt = ak.futures_zh_realtime(symbol=cn_name)
            contracts = df_rt[~df_rt['symbol'].str.endswith('0')]
            term = []
            for _, r in contracts.iterrows():
                term.append({"symbol": r["symbol"], "price": float(r["trade"]) if pd.notna(r["trade"]) else None,
                             "volume": int(r["volume"]) if pd.notna(r["volume"]) else 0,
                             "oi": int(r["position"]) if pd.notna(r["position"]) else 0})
            data["term_structure"] = sorted(term, key=lambda x: x["symbol"])
    except Exception as e:
        data["term_structure_error"] = str(e)

    # 3. Spot/basis
    try:
        from datetime import datetime, timedelta
        for d in range(5):
            dt = (datetime.now() - timedelta(days=d)).strftime("%Y%m%d")
            try:
                df_b = ak.futures_spot_price(date=dt)
                basis = df_b[df_b['symbol'].str.upper() == upper]
                if not basis.empty:
                    r = basis.iloc[0]
                    data["basis"] = {col: (float(r[col]) if isinstance(r[col], (int, float, np.floating)) else str(r[col])) for col in basis.columns}
                    break
            except:
                continue
    except Exception as e:
        data["basis_error"] = str(e)

    # 4. Historical prices (1 year)
    try:
        df_hist = ak.futures_main_sina(symbol=f"{upper}0", start_date="20250101", end_date="20261231")
        df_hist['close'] = pd.to_numeric(df_hist['收盘价'], errors='coerce')
        df_hist['high'] = pd.to_numeric(df_hist['最高价'], errors='coerce')
        df_hist['low'] = pd.to_numeric(df_hist['最低价'], errors='coerce')
        df_hist['volume'] = pd.to_numeric(df_hist['成交量'], errors='coerce')

        close = df_hist['close'].dropna()
        latest = close.iloc[-1]
        data["history"] = {
            "latest_price": float(latest),
            "latest_date": str(df_hist['日期'].iloc[-1]),
            "min": float(close.min()), "max": float(close.max()), "mean": float(close.mean()),
            "percentile": float((close < latest).mean() * 100),
            "bars": len(close),
        }

        # Recent performance
        perf = {}
        for days, label in [(5, "1w"), (20, "1m"), (60, "3m"), (120, "6m"), (250, "1y")]:
            if len(close) > days:
                perf[label] = float((latest / close.iloc[-days-1] - 1) * 100)
        data["performance"] = perf

        # MAs
        mas = {}
        for w in [5, 20, 60, 120, 250]:
            ma = close.rolling(w).mean()
            if pd.notna(ma.iloc[-1]):
                mas[f"MA{w}"] = float(ma.iloc[-1])
        data["moving_averages"] = mas

        # RSI
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        data["rsi14"] = float(rsi.iloc[-1]) if pd.notna(rsi.iloc[-1]) else None

        # ATH
        ath = df_hist['high'].max()
        data["ath"] = float(ath)
        data["ath_distance"] = float((latest - ath) / ath * 100)

        # Last 10 bars
        data["recent_bars"] = []
        for _, r in df_hist.tail(10).iterrows():
            data["recent_bars"].append({"date": str(r["日期"]), "O": r["开盘价"], "H": r["最高价"], "L": r["最低价"], "C": r["收盘价"], "V": r["成交量"]})

    except Exception as e:
        data["history_error"] = str(e)

    # 5. Inventory
    try:
        inv_name_map = {"CU": "沪铜", "AL": "沪铝", "ZN": "沪锌", "AU": "沪金", "AG": "沪银",
                        "RB": "螺纹钢", "HC": "热卷", "I": "铁矿石", "J": "焦炭", "JM": "焦煤",
                        "M": "豆粕", "Y": "豆油", "P": "棕榈", "CF": "郑棉", "SR": "白糖",
                        "TA": "PTA", "MA": "甲醇", "NI": "镍", "SN": "锡", "PB": "沪铅",
                        "SS": "不锈钢", "FU": "燃油", "BU": "沥青", "RU": "橡胶", "SP": "纸浆"}
        inv_name = inv_name_map.get(upper)
        if inv_name:
            df_inv = ak.futures_inventory_em(symbol=inv_name)
            recent = df_inv.tail(20)
            inv_start = float(recent['库存'].iloc[0])
            inv_end = float(recent['库存'].iloc[-1])
            data["inventory"] = {
                "current": inv_end,
                "20d_ago": inv_start,
                "change": inv_end - inv_start,
                "change_pct": (inv_end - inv_start) / inv_start * 100 if inv_start else 0,
                "trend": "累库" if inv_end > inv_start else "去库",
            }
    except Exception as e:
        data["inventory_error"] = str(e)

    return data


def build_futures_prompt(variety_code: str, data: dict) -> str:
    """Build the GPT-5.4 analysis prompt from gathered data."""
    contract = data.get("contract", {})
    name = contract.get("name", variety_code)

    prompt = f"""你是一位资深期货分析师，使用"期限结构 x 价格形态 x 供需 x 事件驱动"的多维分析框架。

请对以下品种进行完整的价格结构分析报告：

品种: {variety_code.upper()} ({name})
交易所: {contract.get('exchange', 'N/A')}
合约乘数: {contract.get('multiplier', 'N/A')}
最小变动: {contract.get('tick', 'N/A')}
保证金率: {contract.get('margin_rate', 0) * 100:.1f}%
"""

    # Term structure
    if "term_structure" in data:
        prompt += "\n=== 期限结构（各合约月份实时价格）===\n"
        for t in data["term_structure"]:
            prompt += f"  {t['symbol']}: 价格={t['price']}  成交量={t['volume']}  持仓量={t['oi']}\n"

    # Basis
    if "basis" in data:
        b = data["basis"]
        prompt += f"\n=== 基差数据 ===\n{json.dumps(b, ensure_ascii=False, indent=2)}\n"

    # History
    if "history" in data:
        h = data["history"]
        prompt += f"""
=== 历史价格 ===
最新价: {h['latest_price']}  日期: {h['latest_date']}
区间: {h['min']} - {h['max']}  均值: {h['mean']:.0f}
历史百分位: {h['percentile']:.1f}%
ATH: {data.get('ath', 'N/A')}  距ATH: {data.get('ath_distance', 0):.1f}%
"""

    if "performance" in data:
        prompt += "\n近期表现:\n"
        for k, v in data["performance"].items():
            prompt += f"  {k}: {v:+.2f}%\n"

    if "moving_averages" in data:
        prompt += "\n均线:\n"
        for k, v in data["moving_averages"].items():
            prompt += f"  {k}: {v:.2f}\n"

    if data.get("rsi14"):
        prompt += f"\nRSI(14): {data['rsi14']:.1f}\n"

    # Inventory
    if "inventory" in data:
        inv = data["inventory"]
        prompt += f"""
=== 库存 ===
当前: {inv['current']:.0f}
20日前: {inv['20d_ago']:.0f}
变化: {inv['change']:+.0f} ({inv['change_pct']:+.1f}%)
趋势: {inv['trend']}
"""

    # Recent bars
    if "recent_bars" in data:
        prompt += "\n=== 近10日走势 ===\n"
        for bar in data["recent_bars"]:
            prompt += f"  {bar['date']} O:{bar['O']} H:{bar['H']} L:{bar['L']} C:{bar['C']} V:{bar['V']}\n"

    # All contract details
    if "contracts_list" in data:
        prompt += "\n=== 各合约详情 ===\n"
        for c in data["contracts_list"]:
            prompt += f"  {c['code']}: 价格={c['price']}  成交量={c['volume']}  持仓量={c['oi']}\n"

    prompt += """
=== 输出要求 ===

请生成完整的中文价格结构分析报告，使用Markdown格式，包含以下章节：

## 1. 合约要素
列出交易所、合约乘数、保证金率、手续费等关键要素。

## 2. 期限结构概览
列出各合约价格表，判断正向市场/反向市场/混合结构，描述曲线形态。

## 3. 基差状态
基差 = 现货 - 期货（传统定义）。分析现货升水/贴水及其含义。

## 4. 关键价差
计算主要跨月价差，年化价差率，与理论持仓成本对比。

## 5. 供需分析
基于库存趋势、基差方向和期限结构，推断当前供需平衡状态。
包括：库存数据、供给侧评估、需求侧评估、成本支撑、供需平衡判断。

## 6. 价格形态分析
趋势判断（均线排列和斜率）、摆动结构（HH/HL/LH/LL）、关键支撑阻力、图表形态、动量指标（RSI/MACD）、量价关系。

## 7. 事件驱动分析
影响该品种的近期事件和即将到来的事件，事件敏感度评估。

## 8. EXTREME/CLOCK/GEO/TRENDWISE/ATH 评估
- EXTREME: 价格极端度评分（0-20，基于百分位+Z-Score+波动率）
- CLOCK: 商品周期钟位置（Phase 1谷底/Phase 2复苏/Phase 3饱和/Phase 4崩塌）
- GEO: 多维信号一致性（Order 0-3）
- TRENDWISE: 趋势信号（Open/Closed）
- ATH: 距历史高点距离

## 9. 结构综合研判
综合评估表（各维度发现+方向偏向），关键含义（套保者/投机者/套利者），需关注的结构变化信号。

报告应专业、数据驱动、结论明确。所有数值保留合理精度。
"""

    return prompt


@app.get("/api/analyze")
async def analyze_futures(
    code: str = Query(..., description="Variety code, e.g. CU, AU, RB"),
):
    """Gather data + call GPT-5.4 to generate futures analysis report."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured", "status": 500}

    upper = code.strip().upper()

    # Gather all data
    data = gather_futures_data(upper)

    # Build prompt
    prompt = build_futures_prompt(upper, data)

    # Call GPT-5.4
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            resp = await client.post(
                OPENAI_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": OPENAI_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_completion_tokens": 8000,
                    "temperature": 0.2,
                },
            )
            resp.raise_for_status()
            result = resp.json()
            report = result["choices"][0]["message"]["content"]
            return {"ok": True, "code": upper, "report": report, "data_summary": {
                "contracts": len(data.get("contracts_list", [])),
                "term_structure": len(data.get("term_structure", [])),
                "has_basis": "basis" in data,
                "has_inventory": "inventory" in data,
                "has_history": "history" in data,
            }}
        except Exception as e:
            return {"error": str(e), "status": 500}


@app.get("/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8888)

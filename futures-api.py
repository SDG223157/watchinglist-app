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


def build_strategy_prompt(variety_code: str, data: dict) -> str:
    """Build trading strategy prompt from gathered data."""
    contract = data.get("contract", {})
    name = contract.get("name", variety_code)
    h = data.get("history", {})
    inv = data.get("inventory", {})
    basis = data.get("basis", {})
    mas = data.get("moving_averages", {})
    perf = data.get("performance", {})

    prompt = f"""基于以下{variety_code.upper()}（{name}）的价格结构数据，生成完整的交易策略报告：

核心数据：
- 当前价格：{h.get('latest_price', 'N/A')}（主力合约）
- 现货价格：{basis.get('spot_price', 'N/A')}
- 库存：{inv.get('current', 'N/A')}，20日变化：{inv.get('change_pct', 0):+.1f}%（{inv.get('trend', 'N/A')}）
- 期限结构："""

    if "term_structure" in data:
        ts = data["term_structure"]
        if len(ts) >= 2:
            first_p = ts[0].get("price", 0) or 0
            last_p = ts[-1].get("price", 0) or 0
            if last_p < first_p:
                prompt += "远端贴水（反向市场为主）"
            elif last_p > first_p:
                prompt += "远端升水（正向市场）"
            else:
                prompt += "平坦"

    prompt += f"""
- 均线：{' | '.join(f'{k}:{v:.0f}' for k, v in mas.items())}
- RSI(14): {data.get('rsi14', 'N/A')}
- ATH: {data.get('ath', 'N/A')}（距ATH: {data.get('ath_distance', 0):.1f}%）
- 历史百分位: {h.get('percentile', 0):.1f}%
- 近期表现: {' | '.join(f'{k}:{v:+.2f}%' for k, v in perf.items())}
"""

    if "term_structure" in data:
        prompt += "\n各合约价格：\n"
        for t in data["term_structure"]:
            prompt += f"  {t['symbol']}: {t['price']}  持仓量={t['oi']}\n"

    if "recent_bars" in data:
        prompt += "\n近10日走势：\n"
        for b in data["recent_bars"]:
            prompt += f"  {b['date']} O:{b['O']} H:{b['H']} L:{b['L']} C:{b['C']} V:{b['V']}\n"

    prompt += """
请输出完整中文交易策略报告（Markdown格式），包含：

## 一、多空情景分析
### 情景A：偏多情景（概率评估%、触发条件、驱动逻辑、目标区）
### 情景B：偏空情景（概率评估%、触发条件、驱动逻辑、目标区）
### 情景C：中性震荡（概率评估%、预期区间）

## 二、方向性交易策略
### 策略1：趋势多单（入场条件与价位、止损位与逻辑、第一/第二/第三目标位、仓位建议、盈亏比计算）
### 策略2：回调做多（入场区间、止损位、目标位、仓位、盈亏比）
### 策略3：高位做空短线（入场区间、止损位、目标位、仓位、风险警告）

## 三、跨期套利策略
### 策略4：正套/反套（合约组合、入场价差、目标价差、止损价差、逻辑）

## 四、风险管理
### 仓位管理原则
### 关键止损纪律
### 需要立即平仓的极端信号

## 五、每日跟踪清单（关键价位、指标、信号）

## 六、策略优先级排序（当前最优策略到最低优先级）

报告应实操性强，所有价位精确到整数，盈亏比清晰，每个策略的入场/止损/目标必须有明确数字。
"""
    return prompt


def _data_summary_block(variety_code: str, data: dict) -> str:
    """Reusable data summary for all strategy-variant prompts."""
    h = data.get("history", {})
    mas = data.get("moving_averages", {})
    perf = data.get("performance", {})
    block = f"品种: {variety_code}\n当前价格: {h.get('latest_price', 'N/A')}\nRSI(14): {data.get('rsi14', 'N/A')}\n"
    block += f"ATH: {data.get('ath', 'N/A')}（距ATH: {data.get('ath_distance', 0):.1f}%）\n百分位: {h.get('percentile', 0):.1f}%\n"
    block += f"均线: {' | '.join(f'{k}:{v:.0f}' for k, v in mas.items())}\n"
    block += f"近期: {' | '.join(f'{k}:{v:+.2f}%' for k, v in perf.items())}\n"
    if "term_structure" in data:
        block += "期限结构:\n"
        for t in data["term_structure"]:
            block += f"  {t['symbol']}: {t['price']} OI={t['oi']}\n"
    if "recent_bars" in data:
        block += "近10日:\n"
        for b in data["recent_bars"]:
            block += f"  {b['date']} O:{b['O']} H:{b['H']} L:{b['L']} C:{b['C']} V:{b['V']}\n"
    return block


def build_table_prompt(variety_code: str, data: dict) -> str:
    """表格版交易计划"""
    return f"""基于以下数据，生成{variety_code}的表格版交易计划（中文Markdown）：

{_data_summary_block(variety_code, data)}

输出要求：用纯Markdown表格格式，包含以下表格：

## 表格1：多空情景概率
| 情景 | 概率 | 触发条件 | 目标区 |

## 表格2：方向性策略一览
| 策略 | 方向 | 入场价 | 止损价 | 目标1 | 目标2 | 目标3 | 风险点数 | 盈亏比(T1) | 盈亏比(T2) | 仓位 |
（至少3个策略：突破做多、回调做多、高位做空）

## 表格3：跨期套利
| 合约组合 | 方向 | 入场价差 | 目标价差 | 止损价差 | 盈亏比 |

## 表格4：关键价位速查
| 类型 | 价位 | 说明 |
（列出所有阻力位和支撑位）

## 表格5：每日检查清单
| 检查项 | 多头信号 | 空头信号 |

## 表格6：策略优先级
| 优先级 | 策略 | 理由 | 适合人群 |

所有价位精确到整数。表格要清晰整齐，可直接打印使用。"""


def build_intraday_prompt(variety_code: str, data: dict) -> str:
    """日内短线版策略"""
    return f"""基于以下数据，生成{variety_code}的日内短线交易策略（中文Markdown）：

{_data_summary_block(variety_code, data)}

输出要求：针对日内交易者（持仓不过夜），包含：

## 一、日内偏向判断
基于隔夜走势、开盘价相对前收、均线位置，判断今日偏多/偏空/震荡

## 二、日内关键价位
### 开盘参考区间
### 日内阻力位（至少3个）
### 日内支撑位（至少3个）
### 枢轴点（Pivot Point）计算

## 三、日内策略
### 策略A：开盘突破跟随（入场条件/止损/目标/持仓时间）
### 策略B：区间高抛低吸（入场条件/止损/目标）
### 策略C：尾盘趋势单（入场条件/止损/目标）

## 四、日内风控规则
- 单笔止损上限
- 日内最大亏损上限
- 连续止损后的应对
- 不交易的时段（如开盘15分钟、午间、收盘前5分钟）

## 五、日内执行时间表
| 时间段 | 操作 | 注意事项 |
（按中国期货交易时间：9:00-10:15, 10:30-11:30, 13:30-15:00, 21:00-23:00）

所有价位精确到整数。策略要求快进快出，清晰明确。"""


def build_swing_prompt(variety_code: str, data: dict) -> str:
    """Swing波段版策略"""
    return f"""基于以下数据，生成{variety_code}的Swing波段交易策略（中文Markdown）：

{_data_summary_block(variety_code, data)}

输出要求：针对波段交易者（持仓3-20个交易日），包含：

## 一、波段趋势判断
### 周线级别趋势
### 日线级别趋势
### 当前波段所处位置（起涨/中途/末端/起跌）

## 二、波段策略
### 策略1：趋势波段多单
- 入场信号（什么条件触发建仓）
- 分批建仓计划（第一仓/加仓条件/最大仓位）
- 波段止损（初始/移动止损规则）
- 波段目标（第一目标/第二目标/最终目标）
- 预期持仓周期
- 盈亏比

### 策略2：反弹波段空单
- 入场信号
- 止损
- 目标
- 预期持仓周期

### 策略3：区间波段
- 箱体上沿/下沿
- 操作规则

## 三、波段加仓与减仓规则
- 浮盈加仓条件
- 分批止盈规则
- 移动止损设置

## 四、波段风控
- 单笔最大风险
- 组合最大风险
- 波段失败的认定标准

## 五、波段交易日历
| 时间节点 | 动作 | 条件 |
（未来2-4周的关键操作节点）

## 六、与跨期套利的配合
如何将波段判断与跨月价差结合

所有价位精确到整数，盈亏比清晰。"""


def build_orders_prompt(variety_code: str, data: dict) -> str:
    """盘中挂单版策略"""
    return f"""基于以下数据，生成{variety_code}的盘中挂单策略清单（中文Markdown）：

{_data_summary_block(variety_code, data)}

输出要求：直接可用于实盘挂单的精确指令，包含：

## 挂单策略总表
| 编号 | 方向 | 类型 | 挂单价 | 数量(手) | 止损价 | 目标价 | 盈亏比 | 备注 |

至少包含以下挂单：
1. 突破买入单（买入止损单）
2. 回调买入单（限价买入）
3. 二次回调买入单（更低位限价买入）
4. 反弹做空单（限价卖出）
5. 破位做空单（卖出止损单）
6. 跨期正套挂单（近月买入+远月卖出）

## 每笔挂单详解
对每一笔挂单给出：
- 挂单逻辑（为什么在这个价位）
- 触发后的操作（立刻挂止损/止盈）
- 需要取消的条件

## 挂单管理规则
- 开盘前检查/调整
- 盘中哪些挂单需要撤回
- 收盘前未成交挂单的处理
- 次日是否继续挂出

## 仓位汇总
| 情景 | 最终持仓方向 | 总仓位 | 总风险 |
（列出各种可能的成交组合和最终持仓状态）

所有价位精确到整数，数量以1手为基准单位。"""


def build_risk_prompt(variety_code: str, data: dict) -> str:
    """风险管理专项报告"""
    return f"""基于以下{variety_code}的数据，生成专项风险管理报告（中文Markdown）：

{_data_summary_block(variety_code, data)}

输出要求——这是一份给交易员和风控经理的风险管理手册：

## 一、当前风险全景评估
### 1.1 价格风险
- 当前价格处于历史什么位置（百分位、距ATH）
- 最大可能回撤幅度估算（基于ATR和历史波动率）
- 单日最大可能亏损（按1手/5手/10手计算，精确到元）

### 1.2 流动性风险
- 主力合约成交量与持仓量评估
- 远月合约流动性
- 夜盘 vs 日盘流动性差异

### 1.3 期限结构风险
- 展期风险（近强远弱 vs 近弱远强对展期的影响）
- 临近交割月的风险（逼仓、交割违约）
- 基差风险（期现价差收敛的不确定性）

### 1.4 相关性风险
- 该品种与哪些品种高度相关（产业链上下游）
- 与宏观因子的相关性（美元、原油、利率）
- 系统性风险暴露度

## 二、仓位管理体系
### 2.1 单品种仓位上限
- 按账户规模的百分比（保守/标准/激进三档）
- 按波动率调整的仓位公式：仓位 = 风险预算 / (ATR × 合约乘数)
- 具体计算示例（假设100万、500万、1000万账户）

### 2.2 多品种组合仓位
- 与相关品种的合计持仓限制
- 同方向敞口上限
- 净敞口管理

### 2.3 加仓规则
- 浮盈加仓的条件和比例
- 补仓/摊平的严格限制
- 金字塔加仓法则

## 三、止损体系
### 3.1 技术止损
- 基于关键支撑阻力位的止损设置（精确价位）
- 基于ATR的动态止损（ATR × N倍）
- 移动止损规则

### 3.2 时间止损
- 持仓N天未盈利则平仓
- 事件前必须减仓（如重大数据发布）

### 3.3 资金止损
- 单笔最大亏损（占账户比例）
- 日最大亏损限额
- 周/月最大回撤限额
- 触发各级止损后的操作：降仓 → 暂停 → 清仓

## 四、极端风险预案
### 4.1 黑天鹅情景
- 涨跌停板被封（无法平仓）的应对
- 连续涨跌停的处理
- 交易所强制平仓/调整保证金的应对

### 4.2 流动性枯竭
- 无法成交时的备选方案
- 跨品种对冲的应急操作
- 期权保护（若有对应期权）

### 4.3 系统性风险
- 全市场暴跌时的应对
- 政策突变（交易所调保证金/限仓/暂停交易）
- 外盘联动风险

## 五、风险指标监控看板
| 指标 | 当前值 | 安全区 | 警戒区 | 危险区 | 当前状态 |
（列出8-10个关键风险指标：ATR%、RSI极值、持仓集中度、基差率、库存变化速度、月间价差、波动率百分位、持仓盈亏比等）

## 六、风险检查清单（盘前/盘中/盘后）
### 盘前检查
| 序号 | 检查项 | 标准 | 操作 |

### 盘中监控
| 序号 | 监控项 | 触发条件 | 应急操作 |

### 盘后复盘
| 序号 | 复盘项 | 目的 |

报告应严谨、量化、可执行。所有金额和价位精确到整数。"""


def build_checklist_prompt(variety_code: str, data: dict) -> str:
    """每日跟踪清单"""
    return f"""基于以下{variety_code}的最新数据，生成今日的每日跟踪清单（中文Markdown）：

{_data_summary_block(variety_code, data)}

输出要求——一份可每天打印执行的操盘跟踪清单：

## 今日{variety_code}操盘清单

### 一、关键价位速查（今日有效）
| 类型 | 价位 | 说明 | 触发后操作 |
（列出所有阻力位4个 + 支撑位4个 + 枢轴点 + 整数关口）

### 二、今日方向判断
- 日线趋势方向：____
- 今日偏向：偏多 / 偏空 / 震荡
- 判断依据（3个核心理由）
- 置信度：高 / 中 / 低

### 三、今日交易计划
| 策略 | 方向 | 入场条件 | 入场价 | 止损价 | 目标价 | 仓位 | 执行状态 |
（3-5个具体策略，留空"执行状态"列供盘中填写）

### 四、需要监控的指标
| 指标 | 昨日值 | 今日关注 | 多头信号 | 空头信号 |
（RSI、成交量、持仓量、基差、月间价差、库存、均线位置）

### 五、今日事件提醒
| 时间 | 事件 | 预期影响 | 应对方案 |
（列出今日可能影响该品种的事件：数据发布、政策、外盘联动时间等）

### 六、盘前检查（开盘前完成）
- [ ] 隔夜外盘走势确认
- [ ] 夜盘收盘价 vs 昨日收盘
- [ ] 今日有无重大数据/事件
- [ ] 当前持仓状态确认
- [ ] 今日最大可承受亏损确认
- [ ] 挂单是否需要调整

### 七、盘中纪律提醒
- [ ] 不在开盘15分钟内追涨杀跌
- [ ] 止损触发后不犹豫不扩大
- [ ] 单笔亏损不超过____元
- [ ] 日内亏损累计不超过____元
- [ ] 连续2次止损后暂停30分钟
- [ ] 目标到达后至少减仓50%

### 八、盘后复盘模板
| 项目 | 记录 |
|------|------|
| 今日盈亏 | ____ 元 |
| 最大浮盈 | ____ 元 |
| 最大浮亏 | ____ 元 |
| 执行纪律 | 好 / 一般 / 差 |
| 今日最佳决策 | ____ |
| 今日最差决策 | ____ |
| 明日关注重点 | ____ |

### 九、本周关键节点
| 日期 | 事件 | 预期影响 |

所有价位精确到整数。清单应简洁实用，适合打印后放在交易台旁。"""


@app.get("/api/analyze")
async def analyze_futures(
    code: str = Query(..., description="Variety code, e.g. CU, AU, RB"),
    mode: str = Query("analysis", description="analysis/strategy/table/intraday/swing/orders/risk/checklist"),
):
    """Gather data + call GPT-5.4 to generate futures report."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured", "status": 500}

    upper = code.strip().upper()
    data = gather_futures_data(upper)

    prompt_builders = {
        "analysis": build_futures_prompt,
        "strategy": build_strategy_prompt,
        "table": build_table_prompt,
        "intraday": build_intraday_prompt,
        "swing": build_swing_prompt,
        "orders": build_orders_prompt,
        "risk": build_risk_prompt,
        "checklist": build_checklist_prompt,
    }
    builder = prompt_builders.get(mode, build_futures_prompt)
    prompt = builder(upper, data)

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
            return {"ok": True, "code": upper, "mode": mode, "report": report}
        except Exception as e:
            return {"error": str(e), "status": 500}


@app.get("/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8888)

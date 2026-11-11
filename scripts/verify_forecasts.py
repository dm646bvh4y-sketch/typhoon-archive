#!/usr/bin/env python3
"""Verify archived typhoon forecasts against analysis records."""

import json
from math import radians, sin, cos, asin, sqrt
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
FORECAST_DIR = ROOT / "data" / "archive"
TRACK_DIR = ROOT / "data" / "track-archive"


def load_json(path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_analysis(code):
    data = load_json(TRACK_DIR / f"{code}.json")
    return {
        r["observationDateTime"]: r
        for r in data.get("records", [])
    }


def distance_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(
        radians, [lat1, lon1, lat2, lon2]
    )
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = (
        sin(dlat / 2) ** 2
        + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    )
    return 6371 * 2 * asin(sqrt(a))


def collect_forecasts(code):
    forecasts = []

    for path in sorted((FORECAST_DIR / code).glob("*.json")):
        data = load_json(path)

        for item in data.get("specifications", []):
            validtime = item.get("validtime", {}).get("JST")
            hours = item.get("advancedHours")
            position = item.get("position", {}).get("deg", [])

            if not validtime or hours is None or hours <= 0:
                continue
            if len(position) < 2:
                continue

            wind = (item.get("maximumWind") or {}).get("sustained") or {}

            forecasts.append({
                "validtime": validtime,
                "issueTime": data.get("sourceIssueTime"),
                "advancedHours": hours,
                "latitude": float(position[0]),
                "longitude": float(position[1]),
                "pressure": item.get("pressure"),
                "wind": wind.get("m/s"),
            })

    return forecasts


def calculate_errors(forecast, actual):
    pressure = forecast["pressure"]
    wind = forecast["wind"]

    return {
        "position": distance_km(
            forecast["latitude"], forecast["longitude"],
            actual["latitude"], actual["longitude"],
        ),
        "pressure": (
            float(pressure) - actual["centralPressureHpa"]
            if pressure is not None
            and actual.get("centralPressureHpa") is not None
            else None
        ),
        "wind": (
            float(wind) - actual["maximumWindMs"]
            if wind is not None
            and actual.get("maximumWindMs") is not None
            else None
        ),
    }


def mean(values):
    return sum(values) / len(values) if values else None


def mae(values):
    return mean([abs(v) for v in values])


def show_leadtime_summary(results):
    groups = defaultdict(list)

    for row in results:
        groups[row["advancedHours"]].append(row)

    print("\n【リードタイム別予報精度】")
    print("時間 | 件数 | 位置MAE | 気圧ME | 気圧MAE | 風速ME | 風速MAE")

    for hours, rows in sorted(groups.items()):
        positions = [r["position"] for r in rows]
        pressures = [r["pressure"] for r in rows if r["pressure"] is not None]
        winds = [r["wind"] for r in rows if r["wind"] is not None]

        print(
            f"{hours:>2}h | {len(rows):>3} | "
            f"{mae(positions):6.1f}km | "
            f"{mean(pressures):6.1f} | {mae(pressures):6.1f} | "
            f"{mean(winds):6.1f} | {mae(winds):6.1f}"
        )


def show_revision_history(results):
    groups = defaultdict(list)

    for row in results:
        groups[row["validtime"]].append(row)

    print("\n【対象時刻ごとの予報更新履歴】")

    for target, rows in sorted(groups.items()):
        print(f"\n対象時刻: {target}")
        print("発表時刻 | 予報時間 | 位置誤差 | 気圧誤差 | 風速誤差")

        for r in sorted(rows, key=lambda x: x["issueTime"]):
            p = f'{r["pressure"]:+.1f}' if r["pressure"] is not None else "-"
            w = f'{r["wind"]:+.1f}' if r["wind"] is not None else "-"

            print(
                f'{r["issueTime"]} | '
                f'{r["advancedHours"]:>2}h | '
                f'{r["position"]:6.1f}km | '
                f'{p:>6} | {w:>6}'
            )


def main():
    code = "TC2638"
    analysis = load_analysis(code)
    forecasts = collect_forecasts(code)

    results = []

    for forecast in forecasts:
        actual = analysis.get(forecast["validtime"])
        if actual is None:
            continue

        errors = calculate_errors(forecast, actual)
        results.append({**forecast, **errors, "dataType": "analysis"})

    print("【予報精度検証】")
    print(f"解析記録数: {len(analysis)}")
    print(f"予報データ数: {len(forecasts)}")
    print(f"照合できた予報数: {len(results)}")

    show_leadtime_summary(results)
    show_revision_history(results)

    # Save machine-readable verification results.
    output_dir = ROOT / "data" / "verification"
    output_dir.mkdir(parents=True, exist_ok=True)

    matched_times = {r["validtime"] for r in results}
    all_times = {r["validtime"] for r in forecasts}

    output = {
        "schemaVersion": 1,
        "typhoonCode": code,
        "verificationReference": "analysis",
        "summary": {
            "analysisRecordCount": len(analysis),
            "forecastCount": len(forecasts),
            "matchedForecastCount": len(results),
            "matchedValidTimeCount": len(matched_times),
        },
        "unmatchedValidTimes": sorted(all_times - matched_times),
        "results": results,
    }

    output_path = output_dir / f"{code}.json"
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n検証結果を保存しました: {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Download current JMA typhoon JSON and snapshots for local browser fallback.

JMA Bosai typhoon JSON are public website data endpoints, not a documented,
versioned API. Their structure/availability can change.
"""
import json
import urllib.request
from pathlib import Path

BASE = "https://www.jma.go.jp/bosai/typhoon/data"
OUT = Path(__file__).resolve().parents[1] / "data"
OUT.mkdir(exist_ok=True)

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "TyphoonArchivePersonalProject/0.2"})
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8")), len(raw)

def save_json(path, obj, size=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {path.relative_to(OUT.parent)}" + (f" ({size:,} bytes)" if size else ""))

def main():
    targets, size = fetch_json(f"{BASE}/targetTc.json")
    save_json(OUT / "targetTc.json", targets, size)

    past, size = fetch_json(f"{BASE}/pastTracks.json")
    save_json(OUT / "pastTracks.json", past, size)

    for tc in targets:
        code = tc.get("tropicalCyclone")
        if not code:
            continue
        try:
            specs, size = fetch_json(f"{BASE}/{code}/specifications.json")
            save_json(OUT / code / "specifications.json", specs, size)
        except Exception as exc:
            print(f"Skip {code} specifications: {exc}")
        try:
            forecast, size = fetch_json(f"{BASE}/{code}/forecast.json")
            save_json(OUT / code / "forecast.json", forecast, size)
        except Exception as exc:
            print(f"Skip {code} forecast: {exc}")


    # Bulletin index/details for local browser fallback.
    info_base = "https://www.jma.go.jp/bosai/information/data/r8"
    try:
        info_list, size = fetch_json(f"{info_base}/information.json")
        save_json(OUT / "information" / "information.json", info_list, size)
        detail_dir = OUT / "information" / "denbun"
        detail_dir.mkdir(parents=True, exist_ok=True)
        count = 0
        for item in info_list if isinstance(info_list, list) else []:
            json_name = item.get("jsonName")
            if not json_name or count >= 80:
                continue
            try:
                detail, detail_size = fetch_json(f"{info_base}/denbun/{json_name}.json")
                save_json(detail_dir / f"{json_name}.json", detail, detail_size)
                count += 1
            except Exception as exc:
                print(f"Skip bulletin {json_name}: {exc}")
        print(f"Saved up to {count} bulletin details for offline fallback.")
    except Exception as exc:
        print(f"Bulletin history fetch skipped: {exc}")

    print("Done. Local snapshots are in data/ (ignored by Git).")
    print("Note: this script stores the data as-is; it does not guarantee forecast validity.")

if __name__ == "__main__":
    main()

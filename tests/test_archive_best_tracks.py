import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "archive_best_tracks.py"
spec = importlib.util.spec_from_file_location("archive_best_tracks", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def sample_specs():
    return [
        {"part": {"jp": "実況", "en": "Analysis"}, "advancedHours": 0,
         "validtime": {"JST": "2026-11-09T18:00:00+09:00"},
         "position": {"deg": [24.4, 135.0]}, "pressure": "980",
         "maximumWind": {"sustained": {"m/s": "35"}, "gust": {"m/s": "50"}}},
        {"part": {"jp": "予報", "en": "Forecast"}, "advancedHours": 12,
         "validtime": {"JST": "2026-11-10T06:00:00+09:00"},
         "position": {"deg": [24.7, 137.0]}, "pressure": "970",
         "maximumWind": {"sustained": {"m/s": "40"}}},
    ]


def test_extracts_only_timestamped_analysis_point():
    records = mod.extract_records(sample_specs(), "TC2638", "2632", "チャンパカ",
                                  "2026-11-09T18:45:00+09:00", "test.json", "capture")
    assert len(records) == 1
    record = records[0]
    assert record["observationDateTime"] == "2026-11-09T18:00:00+09:00"
    assert record["latitude"] == 24.4
    assert record["longitude"] == 135.0
    assert record["centralPressureHpa"] == 980
    assert record["maximumWindMs"] == 35
    assert record["maximumGustMs"] == 50


def test_duplicate_observation_time_does_not_add_duplicate():
    storm = {"records": []}
    records = mod.extract_records(sample_specs(), "TC2638")
    assert mod.merge_into_storm(storm, records) == 1
    assert mod.merge_into_storm(storm, records) == 0
    assert len(storm["records"]) == 1


def test_revision_is_preserved_for_same_observation_time():
    first = mod.extract_records(sample_specs(), "TC2638")[0]
    revised_specs = sample_specs()
    revised_specs[0]["pressure"] = "975"
    second = mod.extract_records(revised_specs, "TC2638")[0]
    storm = {"records": []}
    mod.merge_into_storm(storm, [first])
    mod.merge_into_storm(storm, [second])
    assert storm["records"][0]["centralPressureHpa"] == 975
    assert len(storm["records"][0]["revisions"]) == 1

import importlib.util
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "archive_jma_xml.py"
spec = importlib.util.spec_from_file_location("archive_jma_xml", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_only_first_serial_is_identified():
    assert mod.serial_number("1", "台風第32号 第1号") == 1
    assert mod.serial_number("2", "台風第32号 第2号") == 2
    assert mod.serial_number("", "全般気象解説情報（台風第32号）第1号") == 1


def test_genesis_datetime_from_first_bulletin_body():
    text = "7日12時、マリアナ諸島の北緯19度10分、東経143度30分において、熱帯低気圧が台風第32号になりました。"
    issued = datetime(2026, 11, 7, 13, 22, tzinfo=timezone.utc).astimezone()
    result = mod.extract_genesis_datetime(text, issued)
    assert result is not None
    assert result.endswith("T12:00+09:00")


def test_does_not_infer_genesis_from_issue_time():
    text = "台風第32号は日本の南を北西へ進んでいます。"
    issued = datetime(2026, 11, 9, 7, 50, tzinfo=timezone.utc)
    assert mod.extract_genesis_datetime(text, issued) is None


def test_typhoon_number():
    assert mod.extract_typhoon_number("全般気象解説情報（台風第32号）第1号") == 32

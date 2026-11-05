import json
from pathlib import Path
from urllib.request import urlopen

# 気象庁の台風情報URL
url = "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json"

# JSONデータを取得
with urlopen(url) as response:
    data = json.load(response)

# 保存先フォルダを作成
output_dir = Path("data")
output_dir.mkdir(exist_ok=True)

# JSONファイルとして保存
output_file = output_dir / "targetTc.json"

with output_file.open("w", encoding="utf-8") as file:
    json.dump(data, file, ensure_ascii=False, indent=2)

print(f"取得した台風の数: {len(data)}")
print(f"保存先: {output_file}")
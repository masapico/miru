# CLAUDE.md

Miru は閉域網で使うデータ可視化ツール。CSV / TSV / JSON / JSONL をブラウザ内で読み込み、Chart.js でグラフを描く。
静的な HTML / CSS / JavaScript だけで動き、ビルドはない。`index.html` を `file://` で開いても動く。

## 守ること

- **外部と通信しない**: CDN・Web フォント・外部 API は使わない。ライブラリは `vendor/` に同梱し、`vendor/LICENSES.md` に版・取得元・改変点を書く。vendor のファイルはなるべく改変しない(必要な補いはアプリ側のコードで行う)。
- **ビルドなし・ES Modules なし**: 各ファイルは IIFE で、`window.VizDate` / `VizParser` / `VizSchema` / `VizTransform` / `VizChart` に公開する。`index.html` の `<script>` の並び順が依存関係の順。
- **DOM に依存させない**: `js/datetime.js`・`parser.js`・`schema.js`・`transform.js` は Node でテストするため、DOM を使わない(`module.exports` にも公開している)。
- **画面は デジタル庁デザインシステム(DADS)の HTML スニペットを使う**(`vendor/dads/`)。色は DADS のトークンや、`chart-view.js` の PALETTE を使う。
- **文言は日本語**。括弧は半角 `( )` に揃えている。

## 構成とデータの流れ

```
parser.js     文字コード判定・各形式の解析 → {columns, rows}
schema.js     列の型の推定(日時/数値/カテゴリ/文字列)・値の配列化
datetime.js   日時・和暦・年度の解析と表示、期間の切り捨て
transform.js  絞り込み・集計・系列分割 → 描画用の結果(series, xKind など)
chart-view.js Chart.js の設定の組み立て(buildConfig)、画面描画、SVG 出力
date-adapter.js  Chart.js の時間軸アダプタ(表示タイムゾーンを固定)
app.js        画面の状態・イベント。readConfig() で画面の設定を集めて transform → chart-view に渡す
```

## コマンド

```sh
node --test tests/*.test.js
```

画面の確認は Edge / Chrome のヘッドレスモードで行える。`index.html` を元に、`<base href="file:///…/miru/">` を付けてサンプルを読み込むスクリプトを足した検証用ページを作業用ディレクトリに作り、`msedge --headless=new --allow-file-access-from-files --virtual-time-budget=8000 --screenshot=… --window-size=1280,1000 <URL>` で撮る(`--dump-dom` で結果の文字列も取れる)。ファイルは `document.getElementById("file-upload").addFiles([new File([text], "x.csv")])` で読み込ませられる。

## 注意点

- **SVG 保存**: `chart-view.js` の `exportSVG` は、canvas2svg のモックのコンテキストに画面と同じ設定で Chart.js を描かせている。canvas2svg に足りないところを `shimSvgContext` で補っている(`setLineDash` などの API、`clip()` でパスが空になる不具合、折れ線の `Path2D` を描画中だけ記録用のクラスに差し替える処理)。Chart.js や canvas2svg を更新したら、SVG の出力(折れ線・目盛・欠測区間の切れ目)を確かめる。
- **左右の軸の種類**: 右軸の種類は `cfg.chartTypeRight`。混合グラフ(データセットごとの `type`)で描いている。棒の軸は常に 0 から始める。
- **タイトル・注記・出典**: グラフの中に描くので PNG / SVG にも入る。注記・出典はプラグイン `vizFooter`(レイアウトボックス)で描いている。
- サンプルは `sample/monthly_wareki.csv`。実システムのログなど公開できないデータはコミットしない。

## リリース

`v*` のタグを push すると `.github/workflows/release.yml` がテストを実行し、`git archive` で作った zip を添付した Release を作る。zip に入れない開発用ファイルは `.gitattributes` の `export-ignore` で指定する。README の画面画像は `docs/images/` にある(サンプルデータで撮る)。

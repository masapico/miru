# 同梱ライブラリ

閉域環境で動作させるため、以下をすべてリポジトリに同梱しています(外部 CDN・Web フォントへの通信なし)。

| ライブラリ | バージョン | ライセンス | 同梱ファイル | 取得元 |
|---|---|---|---|---|
| Chart.js | 4.4.7 | MIT | `chartjs/chart.umd.min.js` | npm `chart.js@4.4.7` の `dist/chart.umd.js` |
| chartjs-plugin-zoom | 2.2.0 | MIT | `chartjs/chartjs-plugin-zoom.min.js` | npm `chartjs-plugin-zoom@2.2.0` |
| Hammer.js | 2.0.8 | MIT | `chartjs/hammer.min.js` | npm `hammerjs@2.0.8`(zoom プラグインのタッチ操作用) |
| canvas2svg | 1.0.16 | MIT | `canvas2svg/canvas2svg.js` | npm `canvas2svg@1.0.16`(SVG 保存用。ファイル先頭のコメントは v1.0.15 のまま) |
| Papa Parse | 5.4.1 | MIT | `papaparse/papaparse.min.js` | npm `papaparse@5.4.1` |
| デジタル庁デザインシステム コードスニペット(HTML版) | commit `caa50d7` | MIT | `dads/` | GitHub `digital-go-jp/design-system-example-components-html` |

各ライセンス全文: `chartjs/LICENSE.*.md`、`canvas2svg/LICENSE`、`papaparse/LICENSE`、`dads/LICENSE`

## 同梱時の改変

- `chart.umd.min.js` / `hammer.min.js`: 末尾の `sourceMappingURL` コメントを削除(存在しない .map を開発者ツールが要求しないように)。
- `dads/components/file-upload/file-upload.js`: `export` キーワードのみ削除し、ES Modules ではなく通常の `<script>` として読み込めるようにした(`file://` で開いた場合も動作させるため)。処理内容は無改変。
- `canvas2svg/canvas2svg.js`: 無改変。Chart.js 4 で使うために足りない API(`setLineDash`・`resetTransform`・`ellipse`・`Path2D` を引数に取る `stroke` / `fill`)と、`clip()` がパスを書き出さない不具合への対処は、SVG 出力時に `js/chart-view.js` 側で補っている。
- DADS の他のファイル(`global.css` と各コンポーネントの CSS)は無改変でコピー。

## 更新手順(インターネット接続のある開発機で実施)

```sh
npm pack chart.js@<ver> chartjs-plugin-zoom@<ver> hammerjs@2.0.8 papaparse@<ver>
# 展開して上表のファイルを差し替え、sourceMappingURL 行を削除
git clone --depth 1 https://github.com/digital-go-jp/design-system-example-components-html.git
# src/global.css と src/components/<name>/<name>.css を dads/ 以下へコピー
# file-upload.js は先頭の export を除去:  sed -E 's/^export (class|function) /\1 /'
```

更新後は `node --test tests/*.test.js` と、ブラウザでサンプルファイルの表示を確認してください。

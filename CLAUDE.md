# 画像切り抜き連番保存ツール — 開発メモ

指定サイズに画像を切り抜いて連番ファイル名で保存するツール(旧`94_gazou`、
2026-09-09に公開サイト化して`18_gazou`に改名)。Firebase等のバックエンドは
使わない完全ローカル動作(ログインもデータ保存も無い)。

## 運用ルール(25_FriendBoard/17_storageと同じ)
- 修正するたびに`index.html`の`#site-version`を1つ上げる。
- 同時に`<link rel="stylesheet" href="style.css?v=X.X">`のクエリパラメータも
  同じ番号に揃える(CSSだけキャッシュが古いまま反映されない症状を防ぐため)。

## ブラウザ対応の前提
- 「保存先フォルダを選択」(File System Access API, `showDirectoryPicker`)は
  **Chromium系のPCブラウザのみ**対応(Chrome/Edge)。スマートフォン・タブレット
  では(Chromeでも)非対応で、`HAS_FS_API`の判定により自動的に「通常の
  ダウンロード」フォールバックに切り替わる(連番はページを開いている間だけ
  session内で記憶、フォルダには保存されない)。index.html内に常時表示の
  ※対応ブラウザ注記と、非対応時だけ出る警告文の2つがある。
- 切り抜き枠のドラッグ操作はPointer Events(`pointerdown`/`pointermove`)＋
  `touch-action: none`で実装済みなので、スマホのタッチ操作でも動く
  (ホイールズームだけは効かないが、ズームスライダーで代替できる)。

## script.jsをtype="module"にしないこと
[[feedback_file_protocol_module_scripts]]参照。importもexportも無いので、
うっかり`type="module"`にすると`file://`で開いた時に動かなくなる
(過去に一度これでハマった)。

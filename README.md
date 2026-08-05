# stock-No.1 — 見通ダッシュボード

会社別「見通管理」ファイル（約50社、共通テンプレート）を週次で手集計していた業務を、
ドラッグ&ドロップ→ブラウザ内で自動集計→ダッシュボード表示に置き換えるプロジェクト。

設計の背景・数式の移植根拠は `docs/design.md` を参照。

## 構成

```
lib/                 解析・集計ロジック（Node/ブラウザ共通のESモジュール）
  dates.mjs             Excel日付セル → "YYYY-MM" キー変換
  parseCompanySheet.mjs  「商材集計」シートの構造化パーサー
  aggregate.mjs          901/902/903/対目標スト売上 相当の集計ロジック
web/                 GitHub Pagesで公開する静的サイト（デプロイ時、lib/ の内容を web/lib/ にも複製する必要あり）
  index.html             タブ切替シェル
  summary.html           全体サマリー
  company.html           会社別（一覧+詳細）
  product.html           商材別（検索・4象限フィルタ）
  import.html            週次/年次データの取り込み・保存
  assets/                共通CSS・暗号化・データ取得
gas/Code.gs          インポート画面から送られた暗号化データをGitHubにコミットするWebアプリ
.github/workflows/deploy.yml  push時にweb/をGitHub Pagesへ自動デプロイ
```

`lib/` を更新したときは `web/lib/` にも同じ内容をコピーすること（Pagesは `web/` 配下のみ公開されるため）。

## セットアップ

### 1. GitHub Personal Access Token の準備

GASからこのリポジトリにコミットするために、`repo` スコープを持つ Personal Access Token が必要です。
GitHub の Settings → Developer settings → Personal access tokens で発行してください。

### 2. GAS Web App のデプロイ

1. https://script.google.com で新規プロジェクトを作成し、`gas/Code.gs` の内容を貼り付ける
2. 左の「プロジェクトの設定」→「スクリプト プロパティ」に以下を追加
   - `SHARED_TOKEN`: ダッシュボードの合言葉（任意の文字列。フロント側でも同じ値を使う）
   - `GITHUB_TOKEN`: 手順1で発行したPAT
   - `GITHUB_REPO`: `andcokey/stock-No.1`
   - `GITHUB_BRANCH`: `main`（省略可）
3. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」→アクセスできるユーザー「全員」
4. 発行されたURLをダッシュボードの「インポート」タブ→「接続設定」に貼り付けて保存

### 3. GitHub Pages の有効化

リポジトリの Settings → Pages → Source を「GitHub Actions」に設定。`main` へのpushで自動デプロイされます。

## 使い方

### 週次（通常運用）

1. 会社別の見通管理ファイル（約50個）をダウンロード
2. ダッシュボードの「インポート」タブを開き、まとめてドラッグ&ドロップ
3. プレビューで内容を確認（会社数・商材数・当月の売上高等）
4. 合言葉を入力して「保存」→ GAS経由でGitHubにコミットされ、数分後にPagesへ反映される

GASが未設定の場合は「暗号化JSONをダウンロード」で `sync/forecast-latest.enc.json` を手動作成し、
`sync/forecast-<snapshotDate>.enc.json` としてもコピーしてcommit&pushしてください。

### 年次（目標更新時）

集計ファイルの「目標」シートを含むファイルを「インポート」タブの目標セクションにアップロードし、同様に保存します。

## ローカルでのロジック検証

`lib/` は依存ライブラリなしのプレーンなESモジュールなので、Node.jsから直接importして検証できます
（xlsxの読み込み自体はPython/openpyxl等でJSON化してから渡す想定。実データを含むフィクスチャはこのリポジトリには含めていません）。

## 既知の制約・今後の課題

- 902相当の成長ステージ分類は「顧客継続率（新規）≧75%」「顧客増加数>0」の2軸のみで決まる（元Excelの数式で確認済み。売上高前年同月増加量は参考値であり分類には使われない）
- 現時点では直近スナップショットのみを表示（`sync/forecast-latest.enc.json`）。週次履歴を蓄積する `sync/forecast-YYYYMMDD.enc.json` は書き出し済みなので、トレンド表示は今後の拡張で対応可能
- 商材集計テンプレートの列位置はヘッダー行のラベル文字列から動的に検出しているが、全50ファイルでの実データ検証はまだ行っていない（手元にあった2社分のファイルでのみ検証済み）

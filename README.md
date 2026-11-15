# airline-irregular-notification

航空券の特別な取り扱いの一覧をSlackに通知する

## 設定

[mise](https://mise.jdx.dev/) を使い、`mise.toml` で指定した Bun をインストールする。

```bash
mise trust
mise install
```

`.env.example` をコピーして `.env` を作成し、依存関係をインストールする。`.env` が既に存在する場合は、`.env` を上書きしない。

```bash
mise run setup
```

実行後、`.env` に各環境変数の値を記載する。

| 環境変数 | 内容 |
| --- | --- |
| `SLACK_TOKEN` | Slack のトークン |
| `SLACK_CHANNEL` | 通知先の Slack チャンネル |
| `USER_AGENT` | 運航情報の取得時に送信する User-Agent |

## License

MIT License

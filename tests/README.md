# 本機端對端測試

在未設定 COOP／COEP 的靜態伺服器上，用系統 Google Chrome（Playwright）跑轉換，再用 `ffprobe` 檢驗 MP3。

前置：已安裝 `ffmpeg`／`ffprobe`、Chrome，以及 `playwright-core`（不必下載瀏覽器，使用 `channel: 'chrome'`）。

```bash
# 於專案根目錄
NODE_PATH=/path/to/playwright-core/node_modules node tests/run-e2e.mjs
```

合成測試媒體在 `fixtures/`（可再執行系統 ffmpeg 產生）。截圖寫入 `screenshots/`。

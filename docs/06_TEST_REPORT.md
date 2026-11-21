# 06 TEST REPORT｜測試與除錯紀錄

- Project ID：CI-2026-002　　測試版本：本機交付包（尚未有 git commit）　　日期：2026-11-21
- 測試環境：本機 box（Asia/Hong_Kong）、未設定 COOP／COEP 的靜態 HTTP 伺服器（`127.0.0.1:8765`，只提供 `site/`）
- 測試者：BOT 05，以 Playwright（playwright-core，Google Chrome 156 headless，視窗 1280×800 與 390×844）實際執行 `tests/run-e2e.mjs`
- 測試媒體：以系統 ffmpeg 7.1 合成的 5 秒短檔（`fixtures/sample.mp4|webm|mov|mkv|wav|m4a`）及 `not-media.txt`
- 輸出檢驗：系統 `ffprobe`（codec、duration、bit_rate）
- 機組結果檔：`docs/test-results.json`

> **誠實原則**：只記錄實際執行過的測試與真實結果。未測試的項目標示「未測試」。

## 1. 驗收測試（對照 SPEC §6）

| 編號 | 測試步驟 | 預期 | 實際 | 結果 | 證據 |
|---|---|---|---|---|---|
| AC-01a | 檢查回應標頭 | 無 COOP／COEP | 皆為 (none) | PASS | test-results.json |
| AC-01b | `crossOriginIsolated` | false，頁面仍可轉檔 | `false`，後續轉換成功 | PASS | test-results.json |
| AC-02 wav | 轉 sample.wav（瀏覽器解碼路徑） | 有效 MP3、長度約 5 秒 | codec=mp3，dur=5.04s，檔名 sample.mp3 | PASS | tests/output；screenshots/02-wav-done.png |
| AC-02 mp4 | 轉 sample.mp4 | 有效 MP3、長度約 5 秒 | codec=mp3，dur=5.041633s，br≈193227 | PASS | screenshots/03-videos-done.png |
| AC-02 webm | 轉 sample.webm | 同上 | codec=mp3，dur=5.04s，br≈192985 | PASS | 同上 |
| AC-02 mov | 轉 sample.mov | 同上 | codec=mp3，dur=5.041633s，br≈193208 | PASS | 同上 |
| AC-02 mkv | 轉 sample.mkv | 同上 | codec=mp3，dur=5.067755s，br≈193059 | PASS | 同上 |
| AC-03 | 選 192 kbps（wav） | 接近 192 kbps | bit_rate=192000 | PASS | test-results.json |
| AC-04 | mp4 裁切 1–3 秒 | 長度約 2 秒的 MP3 | codec=mp3，dur=2.037551s | PASS | screenshots/04-trim-done.png |
| AC-05 | 一次加入 wav + m4a，全部轉換 | 兩個有效 MP3、原檔名.mp3 | 兩列皆完成，下載名皆為 sample.mp3（兩檔原名均為 sample.*） | PASS | screenshots/05-multi-done.png |
| AC-06 console | 轉換過程 console／pageerror | 無錯誤 | 終局：consoleErrors=[] pageErrors=[] | PASS（見 §3 第一次失敗） | test-results.json |
| AC-06 mobile | 390×844 截圖，主要按鈕可見 | 可操作 | pick 與「全部轉換」可見 | PASS | screenshots/07-mobile-queue.png |
| AC-07 | 隱私／著作權聲明；無 URL 欄 | 有聲明、無 url input | 聲明存在；url inputs=0 | PASS | screenshots/01-desktop-home.png |
| 附加 | 不支援的 txt | 清楚錯誤訊息 | 「不支援的格式：瀏覽器與本機引擎都無法解碼此檔案。」 | PASS | screenshots/06-unsupported-error.png |

四個影片格式在 UI 上顯示引擎為「本機 ffmpeg.wasm（單執行緒）」。wav 走瀏覽器解碼 + lamejs 路徑（輸出仍為合法 MP3）。

## 2. 技術檢查

| 檢查項 | 方法 | 結果 | 備註 |
|---|---|---|---|
| 靜態檢查 / Lint | 未跑 ESLint | 未測試 | 專案無打包器與 lint 設定 |
| 建置 | 無需 `npm run build` | 不適用 | 純靜態檔 |
| 瀏覽器 Console 無錯誤 | Playwright 監聽 | 終局 PASS | 第一次因缺少 favicon 出現 404，已補 `favicon.png` 後重測通過 |
| 網路請求 | 本機靜態伺服器 | PASS | 未向 CDN 載入 ffmpeg／lamejs |
| 無 COOP／COEP 仍可轉檔 | 自寫靜態伺服器刻意不設標頭 | PASS | 模擬 GitHub Pages |
| RWD 360／390 | 390×844 截圖 | PASS | 未另測 360px 與 768px 的自動化斷點，只截了 390 與 1280 |
| 無障礙 | 未跑 axe | 未測試 | 有 label、焦點樣式與語意標題；完整 a11y 稽核未做 |
| Pages 子路徑 | 資源皆用相對路徑 `./` | 程式層已這樣寫 | **未**在真實 `https://user.github.io/repo/` 子路徑部署驗證 |
| 敏感資料掃描 | 人工＋工作流程有 grep | 未發現金鑰 | vendor wasm／min.js 已排除於 workflow grep |
| 128／320 kbps | 只測了 192 | 未測試 | UI 有這兩個選項，未分別用 ffprobe 驗證 |
| 拖放手勢 | 只用檔案選擇器觸發同一套 `addFiles` | 未測試 GUI 拖放 | 選擇器路徑已測 |
| English 切換 | UI 有按鈕 | 未做自動化點擊斷言 | 截圖可見切換器 |
| Safari／Firefox／實機 iOS | — | 未測試 | 僅 Chrome 156 headless |
| 大檔（>80 MB）與記憶體上限 | — | 未測試 | 僅使用約 80–431 KB 的合成短檔 |
| 正式 GitHub Pages | — | 未測試 | 本次不推送、不部署 |

## 3. 錯誤與修復紀錄（8 步除錯法）

| Bug ID | 重現步驟 | 錯誤位置 | 根本原因 | 修正方案 | 修改 | 重新測試 | 回歸測試 | 嘗試次數 |
|---|---|---|---|---|---|---|---|---|
| B-01 | 第一次 e2e：AC-06-console 失敗 | 首頁載入 | Chrome 自動請求 `/favicon.ico`，測試伺服器回 404，被記為 console error。轉換功能本身已全部通過（14/15）。 | 新增 `site/favicon.png` 並在 `index.html` 加上 icon 連結 | 無 git commit | 2026-11-21 重跑 `tests/run-e2e.mjs`，15/15 PASS | 原有轉檔案例在第二次全部再跑一次且通過 | 1 |

## 4. 已知問題

| ID | 說明 | 嚴重度 | 計畫 |
|---|---|---|---|
| K-01 | 未在真實 GitHub Pages 子路徑驗證 | 中 | 部署批准後以實網址再測 |
| K-02 | 大檔、Safari、Firefox、128／320 kbps、拖放手勢未測 | 中 | 若要上線給一般大眾，建議補測 |
| K-03 | 非常見編碼（例如部分 HEVC／專業 mov）可能仍失敗 | 低 | 錯誤訊息已涵蓋「不支援的格式」 |
| K-04 | 單檔超過約 256 MB 會被前端拒絕；80–256 MB 僅警告。實際記憶體上限因裝置而異，未用大檔驗證崩潰行為 | 中 | 文件已說明建議小於 80 MB |
| K-05 | 輸出長度比來源多約 0.04–0.07 秒（MP3 畫格填充），裁切 2 秒結果為 2.04 秒。屬編碼器常見現象，本次視為可接受 | 低 | 無需修正 |
| K-06 | 散布 `ffmpeg-core.wasm` 須遵守 GPL-2.0-or-later | 合規 | 見 NOTICE；原創程式碼 MIT 僅為建議 |

## 5. 結論

- ☑ 可進入 REVIEW（本機驗收項目已通過；尚未部署）
- ☐ 需修正後重測
- ☐ BLOCKED

終局自動化：15／15 通過（第二次完整重跑，約 2026-11-21 2026-11-21 16:31 Asia/Hong_Kong）。部署仍須創辦人批准，並由有權限者將 Pages 來源改為 GitHub Actions。本次不推送、不發信。

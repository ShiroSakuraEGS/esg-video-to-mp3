# 本機影片／音訊轉 MP3（CI-2026-002）

在瀏覽器裡把**你自己的**本機影音檔轉成 MP3。檔案不會上傳到任何伺服器，也**不是** YouTube／小紅書或其他平台的網址下載器（產品已明確不做網址抓取）。

預期 GitHub Pages 位址（部署並驗證後才算數）：`https://shirosakuraegs.github.io/<repo>/`  
目前**尚未推送、尚未部署**。

## 能做什麼

- 拖放或選擇多個檔案（佇列逐一轉換）
- 常見輸入：mp4、mov、webm、mkv、m4a、wav，以及 mp3／aac／ogg 等
- 位元率：128／192／320 kbps
- 可選裁切起點／終點
- 進度條、檔案大小與長度、下載 MP3（沿用原檔名，副檔名改為 `.mp3`）
- 介面預設繁體中文，可切換 English
- 隱私與著作權聲明固定顯示於頁面

## 本機預覽

在 `site/` 目錄用任何靜態伺服器開啟（**不要**加 COOP／COEP 標頭，以模擬 GitHub Pages）：

```bash
cd site
python3 -m http.server 8080
```

然後開啟 http://127.0.0.1:8080/

## 技術做法（為何這樣選）

GitHub Pages **不能**自訂 COOP／COEP，因此多執行緒 `@ffmpeg/core-mt` 所需的 `SharedArrayBuffer` 通常無法使用。本專案**不依賴** `coi-serviceworker`。

採用混合路徑：

1. **瀏覽器能解碼的音訊**（如 wav、m4a）：使用 Web Audio `decodeAudioData`，再以 **lamejs** 編碼 MP3。較快，也不必先載入大型 WASM。
2. **瀏覽器解不了的容器**（如多數 mp4／mov／webm／mkv 影片）：退回 **單執行緒** `@ffmpeg/core` 0.12.10（與 `@ffmpeg/ffmpeg` 0.12.15）。核心已內嵌於 `site/vendor/`，執行期不走 CDN。若核心能用 `libmp3lame` 就直接出 MP3；否則先解成 WAV 再交給 lamejs。

內嵌資產大約 **32 MB**（其中 `ffmpeg-core.wasm` 約 31 MB），低於 GitHub 單一檔案 100 MB 限制。請勿把超過 100 MB 的檔案提交到 git。

## 部署到 GitHub Pages

工作流程：`.github/workflows/deploy-pages.yml`（只上傳 `site/`）。

合併到 `main` 之前，請有權限者把 **Settings → Pages → Source** 設成 **GitHub Actions**（本工作流程不會改 Settings）。這與 CI-2026-001 相同，需要一次性手動切換。

## 授權

- 原創程式碼：**建議 MIT**，見 `LICENSE.SUGGESTION.md`（尚未加入正式 `LICENSE` 檔）。
- 第三方：見 `NOTICE`。`@ffmpeg/core` 為 GPL-2.0-or-later，lamejs／LAME 為 LGPL-3.0。

## 限制（請先閱讀）

- 轉換在分頁記憶體中進行。建議單一檔案小於 80 MB；超過 256 MB 會被拒絕。
- 非常見編碼（例如部分專業相機的 mov、或缺解碼器的 mkv）仍可能失敗。
- 未在每一種行動瀏覽器上完整實測；iOS Safari 記憶體較緊。
- 輸出位元率是目標 CBR，實際 `ffprobe` 讀到的平均值可能略有出入。

## 文件

產品文件在 `docs/`。測試截圖在 `screenshots/`。請只轉換你有權利的內容。

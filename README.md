# 電子書特價日報爬蟲

這是一套自己抓原始來源的電子書限時折扣爬蟲，不依賴 BrokeButRead 的整理結果。資料來源是四個官方頁面：Readmoo 每日優惠、Kobo 99 書單、博客來每日 e 書 99、Pubu 限時 99 選書。

## 架構

```text
Readmoo Playwright  ┐
Kobo Blog HTML      ├─ normalizeDeals() ── Google Sheets CSV
博客來活動頁 HTML   ┤                    └─ Discord Embed JSON / Webhook
Pubu 活動頁 HTML    ┘
```

## 四個平台抓法

| 平台 | 來源 | 抓法 | 注意事項 |
|---|---|---|---|
| 讀墨 | `https://readmoo.com/campaign/specialoffer/index` | Playwright 等 JS 渲染後解析 DOM | 純 HTTP 常會拿不到內容或遇到 WAF challenge |
| Kobo | `https://www.kobo.com/zh/blog/tag/99書單` | 先找最新 `weekly-dd99-*` 文章，再解析每日標題區塊 | 文章常不明寫價格，依活動規則預設 NT$99 |
| 博客來 | `https://activity.books.com.tw/crosscat/show/A00000062854` | HTML 解析活動頁與 Google Calendar 連結 | 移除 `?loc=` 追蹤參數 |
| Pubu | `https://www.pubu.com.tw/campaign/event/pubu99select` | HTML 解析 `li.in_book` 商品卡 | 要解析 `5/9(六)` 與 `〜6/5限時99` 兩種日期格式 |

## 安裝

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## 執行

```bash
# 跑全部來源，產生 CSV 與 Discord JSON，不發送
npm run dry

# 只跑 Pubu + 博客來
SOURCES=pubu,booksTw npm run dry

# 真正發送 Discord / 寫入 Google Sheets
DRY_RUN=0 npm run crawl
```

在 Laptop 或 GitHub 測試時優先使用 `DRY_RUN=1`。GitHub 的
`Ebook crawler safe dry run` workflow 不載入任何 secrets，也不會寫入 Sheet
或發送 Discord；正式 `Daily ebook deals` workflow 在完成驗收前維持停用。

輸出會在 `output/`：

- `ebook_deals_YYYY-MM-DD.csv`：可直接匯入 Google Sheets。
- `discord_payload_YYYY-MM-DD.json`：美化過的 Discord embed payload。

## Discord 美化格式

Discord 不是輸出一整串純文字，而是 embed：

- 今日摘要：總筆數、進行中筆數、平台分布。
- 今天開始：今天剛開始的優惠。
- 今天到期：需要優先看的優惠。
- 低價優先：以特價最低排序。
- 折扣率較高：以折扣率排序。

## Google Sheets 欄位

CSV 欄位採繁中標題，適合直接給團隊使用：

```text
平台、活動類型、分類、書名、作者、出版社、原價_TWD、特價_TWD、
省下_TWD、折扣率_%、特價開始、特價結束、剩餘天數、狀態、
購買連結、乾淨連結、封面圖、來源頁、抓取方式、信心等級、抓取時間
```

## Google Sheets API 設定

如果要直接寫入 Google Sheets：

1. 建立 Google Cloud service account。
2. 把 Google Sheet 分享給 service account email。
3. `.env` 設定（生產環境的固定值）：

```bash
GOOGLE_SHEET_ID=1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU
GOOGLE_SHEET_TAB=每日特價
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
DRY_RUN=0
```

> 生產 Sheet：<https://docs.google.com/spreadsheets/d/1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU/edit>，工作表 `每日特價`。

寫入時會先保存新資料、回讀驗證，再清除舊資料多出的尾端列；禁止採用
「先清空整張工作表再寫入」的流程。若 Sheet 驗證失敗，Discord 不會發送。
> Service account JSON **不可提交進 repo**，請放在本機 `.env` 或 GitHub Secrets。

## Discord Webhook 設定

Discord 整合是 webhook 模式：程式只會 `POST` 到 `process.env.DISCORD_WEBHOOK_URL`，**不會** 把 webhook URL 寫進原始碼。本機測試時放在 `.env`，CI 上放在 GitHub Secret `DISCORD_WEBHOOK_URL`。

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DRY_RUN=0
npm run crawl
```

### Forum 頻道 webhook（選用）

若 webhook 指向 **Discord forum channel**，Discord 規定每則貼文必須附帶 `thread_id` 或 `thread_name`，否則會回傳 `HTTP 400 code 220001`。提供兩個可選的環境變數：

| 名稱 | 用途 |
|---|---|
| `DISCORD_THREAD_ID` | 直接貼進現存的 forum thread。設了之後會以 `?thread_id=` 加在 webhook URL 上。 |
| `DISCORD_THREAD_NAME` | 每次推播都建立一個新 forum post，標題用這個值。 |

兩者都沒設的情況下，若 Discord 回 `code 220001`，程式會自動重試一次，使用預設 thread name `電子書特價日報 YYYY-MM-DD`（`DISCORD_TEST_MODE=1` 時前綴 `[測試] `）。

一般文字頻道 webhook 不要設這兩個變數，行為與原本完全相同。

## GitHub Actions 排程

已附 `.github/workflows/daily.yml`，預設每天台灣時間 00:10 左右執行。GitHub Actions 使用 UTC，所以 cron 是 `10 16 * * *`。

正式排程需要這些 GitHub Secrets / env：

- `GOOGLE_SHEET_ID` = `1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU`
- `GOOGLE_SHEET_TAB` = `每日特價`（已內建在 workflow，無需另外設定）
- `GOOGLE_SERVICE_ACCOUNT_JSON` = 單行 service account JSON
- `DISCORD_WEBHOOK_URL` = Discord webhook URL

詳細設定步驟請見 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

## 後續可加強

- 為每個來源保存 raw HTML snapshot，網站改版時方便比較。
- 把書籍 ID 與歷史價格存進 SQLite，追蹤歷史最低價。
- Discord 分頻推播，例如財經投資、小說文學、語言學習分開推。
- 加入 LINE Notify 或 Telegram Bot。

## 已知注意事項

- Kobo 在某些雲端機房會回傳 403 或 challenge page。程式已做 Playwright fallback，若仍解析到 0 筆，建議改用本機/VPS 固定 IP 執行，或把 Kobo 來源獨立成 `SOURCES=kobo npm run dry` 方便 debug。
- Readmoo 是 JS 動態渲染，必須安裝 Playwright Chromium，不能只靠 `fetch()`。
- 博客來活動頁有很多暢銷榜/新書推薦，本專案先只保留 66/99 的每日 e 書候選，避免推播混入一般推薦書。
- 2026-08-27 WSL 與 Jina 文字代理均收到博客來 HTTP 403，但 Windows 原生
  網路可正常讀取官方活動頁。Laptop 正式流程會在 23:55 由 Windows 更新經過
  內容驗證的 HTML 快取，WSL 直連與 Jina 都失敗時才讀取六小時內的快取；解析
  仍使用官方頁面的 Google Calendar 連結，不需要 AI 或瀏覽器。

# GitHub Actions 部署設定

這份專案已經改成可直接在 GitHub Actions 排程執行。你需要做三件事：建立 Google Sheet 權限、建立 Discord webhook、把 secrets 填進 GitHub repo。

## 生產環境固定設定

| 名稱 | 值 |
|---|---|
| Google Sheet ID | `1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU` |
| Google Sheet URL | <https://docs.google.com/spreadsheets/d/1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU/edit> |
| Worksheet / 工作表 | `每日特價` |

這些值已寫進 `.github/workflows/daily.yml` 與 `.env.example`，正式排程不需要再覆寫。

## GitHub Secrets

到 GitHub repo：

```text
Settings → Secrets and variables → Actions → New repository secret
```

正式環境需要以下 secrets / env：

| 名稱 | 來源 | 用途 |
|---|---|---|
| `GOOGLE_SHEET_ID` | GitHub Secret | 目標 Google Sheet ID，固定為 `1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU` |
| `GOOGLE_SHEET_TAB` | workflow env（已內建） | 工作表分頁名稱，固定為 `每日特價` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GitHub Secret | Google service account JSON，必須壓成單行 |
| `DISCORD_WEBHOOK_URL` | GitHub Secret | Discord 頻道 webhook URL，由程式以 webhook 方式 POST |
| `DISCORD_THREAD_ID` | GitHub Secret（選用） | 僅 forum channel webhook 需要：要貼進的 forum thread ID |
| `DISCORD_THREAD_NAME` | GitHub Secret（選用） | 僅 forum channel webhook 需要：每次推播建立新 thread 時的標題 |

> Discord 整合僅以 webhook 方式呼叫，不會在原始碼中硬編碼 webhook URL，也不會把 service account JSON 寫進 repo。所有敏感值都從 `process.env` 讀取。

把上方三個 secret 加進 repo：

- `GOOGLE_SHEET_ID` = `1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU`
- `GOOGLE_SERVICE_ACCOUNT_JSON` = service account 單行 JSON
- `DISCORD_WEBHOOK_URL` = Discord webhook URL（取得後再填入；程式會自動讀環境變數）

## Google Sheet 權限

Sheet 已建立完成（見上方 ID / URL）。需要做的是：

1. 建立 Google Cloud service account，下載 JSON key。
2. 把該 service account 的 `client_email` 分享到 Sheet `1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU`，權限給「編輯者」。
3. 把 JSON 轉成單行後放進 GitHub secret `GOOGLE_SERVICE_ACCOUNT_JSON`。
4. 確認 Sheet 內已存在 `每日特價` 工作表（沒有的話程式啟動時會自動建立）。

轉單行方式：

```bash
node -e "console.log(JSON.stringify(require('./service-account.json')))"
```

## Discord Webhook

在 Discord 頻道：

```text
Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL
```

把 URL 放到 GitHub secret `DISCORD_WEBHOOK_URL`。**不要把實際 URL 提交進 repo**，程式只會從環境變數讀取。

### Forum channel webhook

若你要把推播送進 **forum channel**（而不是一般文字頻道），Discord 會強制要求每則 webhook 附 `thread_name` 或 `thread_id`，否則會回 `HTTP 400 {"code":220001}`。本程式支援兩種設法：

- `DISCORD_THREAD_ID`（GitHub Secret，選用）：要貼進的現存 forum thread ID。設了之後 webhook 會自動加 `?thread_id=...`。
- `DISCORD_THREAD_NAME`（GitHub Secret，選用）：每次推播都建立一個新的 forum post 標題。

兩者都沒設的情況下，若 Discord 回 `code 220001`，程式會自動以預設標題 `電子書特價日報 YYYY-MM-DD`（`DISCORD_TEST_MODE=1` 時前綴 `[測試] `）重試一次。

一般文字頻道 webhook 不要設這兩個 secrets，行為與原本完全相同。

## 手動測試

到 GitHub repo：

```text
Actions → Daily ebook deals → Run workflow
```

建議第一次這樣跑：

```text
dry_run = 1
discord_test_mode = 1
sources = pubu,booksTw
```

這只會產生 artifacts，不會寫 Sheets，也不會發 Discord。

確認沒問題後再跑：

```text
dry_run = 0
discord_test_mode = 1
sources = readmoo,kobo,booksTw,pubu
```

測試推播成功後，正式排程會每天台灣時間 00:10 自動跑，`discord_test_mode` 會是 0。

## 輸出

每次 GitHub Actions 都會保存 artifacts：

- `ebook_deals_YYYY-MM-DD.csv`
- `discord_payload_YYYY-MM-DD.json`

正式模式會同時：

- 寫入 Google Sheet 的「每日特價」工作表（Sheet ID `1rBnTmFgAjQYHvEjUxSZqG3yswLXD-keueIaGNRK6mJU`）。
- 透過 webhook 發送美化後 Discord embed。

## 故障排查

- 如果 Google Sheets 失敗，先確認 service account email 是否已分享 Sheet 編輯權限，且工作表名稱是 `每日特價`。
- 如果 Discord 失敗，先確認 webhook URL 沒有過期或被刪除，且 secret `DISCORD_WEBHOOK_URL` 已正確設定。
- 如果 Kobo 是 0 筆，通常是雲端 IP 被 Kobo challenge；可先用其他三個來源跑，或改在自己的 VPS/本機排程。
- 如果總筆數低於 `MIN_DEALS`，程式會拒絕正式推播，避免網站改版時發出錯誤資料。

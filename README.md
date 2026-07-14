# search-and-scrape-action

GitHub composite action：給一個關鍵字，先用自架的 [SearXNG](https://github.com/searxng/searxng) 搜尋，
再用 Playwright 無頭瀏覽器擷取前 N 筆搜尋結果網頁的文字內容。內容會寫進
`$GITHUB_WORKSPACE/<results-dir>/`，並把檔案路徑 + metadata 以 step output 的形式輸出，讓下一個 step 使用。

## 用法

### 跨 repo 引用

```yaml
jobs:
  search-and-scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Search & scrape
        id: search
        uses: ti777777/search-and-scrape-action@main
        with:
          keyword: "你的關鍵字"
          result-count: 3

      - name: 用結果
        run: |
          echo "${{ steps.search.outputs.results-json }}"
          cat "${{ github.workspace }}/${{ steps.search.outputs.results-dir }}/summary.json"
```

`action.yml` 放在 repo 根目錄，所以 `uses:` 不用寫 `.github/actions/...` 那串路徑。
建議正式使用時把 `@main` 換成固定的 tag/commit SHA（例如 `@v1`），避免上游變動影響你的 workflow。

### 同一個 repo 內引用

```yaml
- uses: ./
  with:
    keyword: "你的關鍵字"
```

## Inputs

| name | 必填 | 預設 | 說明 |
|---|---|---|---|
| `keyword` | 是 | - | 要搜尋的關鍵字 |
| `result-count` | 否 | `3` | 要擷取的搜尋結果數量 |
| `results-dir-name` | 否 | `search-results` | 輸出資料夾名稱（相對於 `GITHUB_WORKSPACE`） |
| `searxng-image` | 否 | `searxng/searxng:latest` | 自架 SearXNG 用的 docker image |

## Outputs

| name | 說明 |
|---|---|
| `results-dir` | 相對於 `GITHUB_WORKSPACE` 的輸出資料夾路徑 |
| `results-json` | JSON 陣列字串，每筆包含 `rank` / `url` / `title` / `file` / `contentLength` / `error` |

完整擷取內容（每篇網頁的全文）不會塞進 output（避免超過 GitHub Actions 對 output 大小的限制），
而是寫成 `<results-dir>/{rank}-{title}.md` 檔案，加上 `<results-dir>/summary.json` 彙整檔，
之後的 step 直接讀 `$GITHUB_WORKSPACE` 底下的檔案即可。

## 運作方式

1. 用 `docker run` 啟動一個一次性的 SearXNG 容器（設定檔開啟 JSON API），只在這個 job 裡存活。
2. 打 SearXNG 的 `/search?format=json` 拿到搜尋結果，取前 `result-count` 筆。
3. 用 Playwright（Chromium）依序開啟每個網址，抓取 `document.body.innerText` 當內容。
4. 寫檔 + 設定 outputs，最後清掉 SearXNG 容器。

## 需求

呼叫此 action 的 runner 需要能跑 Docker（GitHub-hosted `ubuntu-latest` 內建支援）。

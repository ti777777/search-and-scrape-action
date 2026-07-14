// Search a keyword via a local SearXNG instance, then use a headless browser
// (Playwright) to fetch the top N result pages and dump their text content.
//
// Env vars:
//   KEYWORD          - search keyword (required)
//   SEARXNG_URL       - base URL of the SearXNG instance (default: http://localhost:8080)
//   RESULT_COUNT      - how many top results to scrape (default: 3)
//   RESULTS_DIR_NAME  - output folder name under GITHUB_WORKSPACE (default: search-results)
//   GITHUB_WORKSPACE  - where to write output files (set automatically in CI)
//   GITHUB_OUTPUT     - GitHub Actions step output file (set automatically in CI)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const KEYWORD = process.env.KEYWORD;
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8080';
const RESULT_COUNT = Number(process.env.RESULT_COUNT || 3);
const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();
const OUTPUT_FILE = process.env.GITHUB_OUTPUT;
const OUTPUT_DIR_NAME = process.env.RESULTS_DIR_NAME || 'search-results';

function sanitizeFilename(str) {
  return str.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'page';
}

function setOutput(name, value) {
  if (!OUTPUT_FILE) return;
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(OUTPUT_FILE, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function searchSearxng(keyword) {
  const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(keyword)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SearXNG search failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return (data.results || []).slice(0, RESULT_COUNT);
}

async function scrapePage(browser, url) {
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (compatible; GitHubActionsSearchBot/1.0)',
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Let late content settle a bit.
    await page.waitForTimeout(1000);
    const title = await page.title();
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    return { title, text: text.trim() };
  } finally {
    await page.close();
  }
}

async function main() {
  if (!KEYWORD) {
    throw new Error('KEYWORD env var is required');
  }

  const outDir = path.join(WORKSPACE, OUTPUT_DIR_NAME);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Searching SearXNG for: ${KEYWORD}`);
  const searchResults = await searchSearxng(KEYWORD);

  if (searchResults.length === 0) {
    throw new Error('No search results returned from SearXNG');
  }

  const browser = await chromium.launch();
  const summary = [];

  try {
    for (let i = 0; i < searchResults.length; i++) {
      const { url, title: searchTitle } = searchResults[i];
      const rank = i + 1;
      console.log(`[${rank}] Scraping: ${url}`);

      let pageTitle = searchTitle || '';
      let content = '';
      let error = null;

      try {
        const scraped = await scrapePage(browser, url);
        pageTitle = scraped.title || pageTitle;
        content = scraped.text;
      } catch (err) {
        error = err.message;
        console.warn(`  failed: ${error}`);
      }

      const filename = `${rank}-${sanitizeFilename(pageTitle || url)}.md`;
      const filepath = path.join(outDir, filename);
      const fileBody = [
        `# ${pageTitle || url}`,
        '',
        `- rank: ${rank}`,
        `- url: ${url}`,
        `- keyword: ${KEYWORD}`,
        error ? `- error: ${error}` : '',
        '',
        '---',
        '',
        content || '_(no content extracted)_',
      ].filter(Boolean).join('\n');

      fs.writeFileSync(filepath, fileBody, 'utf-8');

      summary.push({
        rank,
        url,
        title: pageTitle,
        file: path.relative(WORKSPACE, filepath).replace(/\\/g, '/'),
        contentLength: content.length,
        error,
      });
    }
  } finally {
    await browser.close();
  }

  const summaryPath = path.join(outDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log('Done. Summary:');
  console.log(JSON.stringify(summary, null, 2));

  // Keep the step output small: file paths + metadata, not full page content.
  // Full content lives under $GITHUB_WORKSPACE/<results-dir>/*.md for callers to read.
  setOutput('results_dir', path.relative(WORKSPACE, outDir).replace(/\\/g, '/'));
  setOutput('results_json', JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { chromium } from 'playwright';
import fs from 'node:fs';

const MOVIE_ID = '129839';
const URL = `https://filmarks.com/movies/${MOVIE_ID}`;
const X_URL = 'https://x.com/Koisuru_2026';
const INSTAGRAM_URL = 'https://www.instagram.com/koisuru_2026/';

function nowJstIso() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(new Date()).replace(' ', 'T');
  return `${parts}+09:00`;
}

async function readCounter(page, kind) {
  const selector = `a[href*="${kind}=${MOVIE_ID}"]`;

  await page.waitForFunction(
    ({ selector }) => {
      const els = [...document.querySelectorAll(selector)];
      return els.some((el) => {
        const t = (el.textContent || '').trim();
        return /\d/.test(t) && !t.includes('{{');
      });
    },
    { selector },
    { timeout: 30000 }
  );

  const texts = await page.locator(selector).allTextContents();
  for (const raw of texts) {
    const text = raw.trim().replace(/,/g, '');
    const m = text.match(/\d+/);
    if (m) return Number(m[0]);
  }
  throw new Error(`Could not parse ${kind} counter. Candidates: ${JSON.stringify(texts)}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36'
});

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const clipCount = await readCounter(page, 'clip');
  let markCount = null;
  try {
    markCount = await readCounter(page, 'mark');
  } catch (e) {
    console.warn('Mark count unavailable:', e.message);
  }

  // Read only the explicit total-review count, never the first number near the word レビュー.
  // An ambiguous page must yield null rather than a misleading value.
  let reviewCount = null;
  try {
    const bodyText = await page.locator('body').innerText();
    const reviewPatterns = [
      /([\d,]+)\s*件のレビュー/g,
      /([\d,]+)\s*件の感想(?:・レビュー)?/g,
      /感想・レビュー\s*[（(]?\s*([\d,]+)\s*件/g
    ];
    const totals = new Set();
    for (const pattern of reviewPatterns) {
      for (const match of bodyText.matchAll(pattern)) totals.add(Number(match[1].replace(/,/g, '')));
    }
    if (totals.size === 1) reviewCount = [...totals][0];
    else console.warn('Review total unavailable or ambiguous:', [...totals]);
  } catch (e) { console.warn('Review count unavailable:', e.message); }

  // Social metrics are not part of this daily report.
  const xFollowers = null;
  const instagramFollowers = null;

  const fetchedAt = nowJstIso();
  let previous = null;
  if (fs.existsSync('current.json')) {
    try { previous = JSON.parse(fs.readFileSync('current.json', 'utf8')); } catch {}
  }

  const previousClip = Number.isFinite(previous?.clip_count) ? previous.clip_count : null;
  const delta = previousClip === null ? null : clipCount - previousClip;
  const prevReview = Number.isFinite(previous?.review_count) ? previous.review_count : null;
  const prevX = Number.isFinite(previous?.x_followers) ? previous.x_followers : null;
  const prevInstagram = Number.isFinite(previous?.instagram_followers) ? previous.instagram_followers : null;

  const current = {
    movie_id: Number(MOVIE_ID),
    title: '恋する地球人 ‐劇場特別版‐',
    source_url: URL,
    fetched_at_jst: fetchedAt,
    clip_count: clipCount,
    mark_count: markCount,
    review_count: reviewCount,
    x_followers: xFollowers,
    instagram_followers: instagramFollowers,
    x_url: X_URL,
    instagram_url: INSTAGRAM_URL,
    previous_review_count: prevReview,
    delta_review_from_previous: reviewCount === null || prevReview === null ? null : reviewCount - prevReview,
    previous_x_followers: prevX,
    delta_x_from_previous: xFollowers === null || prevX === null ? null : xFollowers - prevX,
    previous_instagram_followers: prevInstagram,
    delta_instagram_from_previous: instagramFollowers === null || prevInstagram === null ? null : instagramFollowers - prevInstagram,
    previous_clip_count: previousClip,
    delta_from_previous: delta
  };

  fs.writeFileSync('current.json', JSON.stringify(current, null, 2) + '\n');

  const historyPath = 'history.csv';
  if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, 'fetched_at_jst,clip_count,mark_count,delta_clip,source\n');
  }
  const mark = markCount === null ? '' : String(markCount);
  const d = delta === null ? '' : String(delta);
  fs.appendFileSync(historyPath, `${fetchedAt},${clipCount},${mark},${d},playwright\n`);

  console.log(JSON.stringify(current, null, 2));
} finally {
  await browser.close();
}

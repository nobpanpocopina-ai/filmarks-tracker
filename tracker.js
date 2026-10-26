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

  // Review count: only use an explicit total associated with this movie.
  // Avoid the generic "レビュー ... number" pattern (it matched unrelated counts).
  let reviewCount = null;
  try {
    const evidence = await page.evaluate((movieId) => {
      const found = [];
      const add = (source, n) => {
        if (Number.isSafeInteger(n) && n >= 0) found.push({ source, value: n });
      };
      const parse = v => {
        const m = String(v ?? '').trim().match(/^([\d,]+)$/);
        return m ? Number(m[1].replace(/,/g, '')) : null;
      };
      // Structured metadata is preferred when it explicitly names reviewCount.
      for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const walk = obj => {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) { obj.forEach(walk); return; }
            if (obj.aggregateRating?.reviewCount != null) add('jsonld.aggregateRating.reviewCount', parse(obj.aggregateRating.reviewCount));
            if (obj.reviewCount != null && (obj['@type'] === 'AggregateRating')) add('jsonld.reviewCount', parse(obj.reviewCount));
            Object.values(obj).forEach(walk);
          };
          walk(JSON.parse(el.textContent));
        } catch {}
      }
      // Read the review count in review navigation, not numbers in individual reviews.
      const links = [...document.querySelectorAll('a[href]')].filter(el => {
        const href = el.getAttribute('href') || '';
        return href.includes('/movies/' + movieId + '/reviews') || href.includes('/movies/' + movieId + '?') && href.includes('review');
      });
      for (const el of links) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        for (const re of [/感想・レビュー\s*[（(]?\s*([\d,]+)\s*件/, /レビュー\s*[（(]\s*([\d,]+)\s*[）)]/, /([\d,]+)\s*件\s*の\s*(?:感想|レビュー)/]) {
          const m = t.match(re); if (m) add('review-navigation', parse(m[1]));
        }
      }
      const text = document.body?.innerText || '';
      for (const re of [/感想・レビュー\s*[（(]\s*([\d,]+)\s*[）)]/g, /感想・レビュー\s*([\d,]+)\s*件/g, /([\d,]+)\s*件の感想・レビュー/g]) {
        for (const m of text.matchAll(re)) add('explicit-review-total', parse(m[1]));
      }
      return { found, diagnostics: {
        reviewLinks: links.slice(0, 6).map(el => ({ href: el.getAttribute('href'), text: (el.innerText || el.textContent || '').trim().slice(0, 160) })),
        reviewText: text.split('\n').filter(x => /レビュー|感想/.test(x)).slice(0, 18).map(x => x.slice(0, 160)),
        reviewDom: [...document.querySelectorAll('a,button,h1,h2,h3,span,div')].filter(el => /レビュー|感想/.test(el.textContent || '') && (el.textContent || '').length < 180).slice(0, 35).map(el => ({tag:el.tagName, cls:String(el.className).slice(0,100), text:(el.textContent||'').trim().slice(0,140), html:el.outerHTML.slice(0,450)})),
        numericReviewContext: [...text.matchAll(/.{0,35}(?:レビュー|感想).{0,90}/g)].slice(0,25).map(m=>m[0])
      }};
    }, MOVIE_ID);
    const values = [...new Set(evidence.found.map(x => x.value))];
    if (values.length === 1) reviewCount = values[0];
    else console.warn('Review count unresolved:', JSON.stringify(evidence));
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

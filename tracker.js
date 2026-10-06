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

  let reviewCount = null;
  try {
    const candidates = [await page.title(), await page.locator('body').innerText(), await page.content()];
    for (const text of candidates) {
      const m = String(text).match(/感想・レビュー[^0-9]{0,40}([\d,]+)\s*件/) || String(text).match(/レビュー[^0-9]{0,40}([\d,]+)\s*件/) || String(text).match(/レビュー[^0-9]{0,40}([\d,]+)/);
      if (m) { reviewCount = Number(m[1].replace(/,/g, '')); break; }
    }
  } catch (e) { console.warn('Review count unavailable:', e.message); }

  async function socialFollowers(url, platform) {
    const p = await browser.newPage({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36' });
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(8000);
      const metas = await p.locator('meta').evaluateAll(els => els.map(e => `${e.getAttribute('name')||e.getAttribute('property')||''}=${e.getAttribute('content')||''}`).join('\n')).catch(() => '');
      const s = (await p.locator('body').innerText().catch(() => '')) + '\n' + metas + '\n' + (await p.content());
      const patterns = platform === 'x'
        ? [/([\d,.]+\s*[KkMm万]?)\s*(?:Followers|フォロワー)/i, /(?:followers_count|followersCount)[^0-9]{0,40}(\d+)/i]
        : [/([\d,.]+\s*[KkMm万]?)\s*(?:followers|フォロワー)/i, /(?:edge_followed_by|follower_count|followers_count)[^0-9]{0,40}(\d+)/i];
      for (const re of patterns) {
        const m = s.match(re);
        if (m) {
          const raw = m[1].replace(/,/g, '').trim();
          const mm = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*([KkMm万]?)/);
          if (!mm) continue;
          let n = Number(mm[1]); const u = mm[2].toLowerCase();
          if (u === 'k') n *= 1000; else if (u === 'm') n *= 1000000; else if (u === '万') n *= 10000;
          return Math.round(n);
        }
      }
      return null;
    } finally { await p.close(); }
  }

  const [xFollowers, instagramFollowers] = await Promise.all([
    socialFollowers(X_URL, 'x').catch(e => { console.warn('X unavailable:', e.message); return null; }),
    socialFollowers(INSTAGRAM_URL, 'instagram').catch(e => { console.warn('Instagram unavailable:', e.message); return null; })
  ]);

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

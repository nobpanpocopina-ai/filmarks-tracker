import { chromium } from 'playwright';
import fs from 'node:fs';

const MOVIE_ID = '129839';
const URL = `https://filmarks.com/movies/${MOVIE_ID}`;

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

  const fetchedAt = nowJstIso();
  let previous = null;
  if (fs.existsSync('current.json')) {
    try { previous = JSON.parse(fs.readFileSync('current.json', 'utf8')); } catch {}
  }

  const previousClip = Number.isFinite(previous?.clip_count) ? previous.clip_count : null;
  const delta = previousClip === null ? null : clipCount - previousClip;

  const current = {
    movie_id: Number(MOVIE_ID),
    title: '恋する地球人 ‐劇場特別版‐',
    source_url: URL,
    fetched_at_jst: fetchedAt,
    clip_count: clipCount,
    mark_count: markCount,
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

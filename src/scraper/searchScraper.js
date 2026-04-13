const { httpClient, sleep } = require('../utils/httpClient');
const cheerio = require('cheerio');

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://search.naver.com/',
};

// 날짜 문자열 파싱 ("2026.04.13." or "4주 전" → Date)
function parseDateStr(str) {
  if (!str) return new Date();
  const m = str.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  const now = new Date();
  const dayMatch = str.match(/(\d+)일\s*전/);
  if (dayMatch) return new Date(now - +dayMatch[1] * 86400000);
  const weekMatch = str.match(/(\d+)주\s*전/);
  if (weekMatch) return new Date(now - +weekMatch[1] * 7 * 86400000);
  const monthMatch = str.match(/(\d+)(?:달|개월)\s*전/);
  if (monthMatch) { const d = new Date(now); d.setMonth(d.getMonth() - +monthMatch[1]); return d; }
  if (/어제/.test(str)) return new Date(now - 86400000);

  return now;
}

// ssc=tab.blog.all HTML에서 블로그명/날짜 포함 전체 메타데이터 추출
function parseFullMetadata(html, existingKeys) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set(existingKeys || []);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/blog\.naver\.com\/(\w+)\/(\d+)/);
    if (!m) return;

    const blogId = m[1];
    const logNo = m[2];
    const key = blogId + '_' + logNo;
    if (seen.has(key)) return;

    const text = $(el).text().trim();
    if (!text || text.length < 5) return;
    if (text.includes('blog.naver.com')) return;
    seen.add(key);

    // 개별 포스트 컨테이너 찾기
    let container = $(el);
    for (let i = 0; i < 10; i++) {
      const next = container.parent();
      if (!next.length) break;
      if (next.children().length > 20) break;
      container = next;
    }

    // 블로그명
    let blogName = blogId;
    const nameEl = container.find('[class*="profile-info-title-text"]').first();
    if (nameEl.length) {
      blogName = nameEl.text().trim() || blogId;
    }

    // 날짜
    let date = new Date();
    container.find('[class*="profile-info-subtext"]').each((_, sub) => {
      const subText = $(sub).text().trim();
      if (/\d{4}\.\d{1,2}\.\d{1,2}/.test(subText) || /\d+[일주달개월]?\s*전/.test(subText) || /어제/.test(subText)) {
        date = parseDateStr(subText);
        return false;
      }
    });

    results.push({ logNo, title: text.replace(/\s+/g, ' ').substring(0, 200), date, blogId, blogName });
  });

  return results;
}

async function searchBlogPosts(query, maxResults = 70) {
  console.log('[검색] "' + query + '" 검색 중...');

  // ssc=tab.blog.all 페이지 순회 — 네이버 블로그탭 관련도순 그대로
  const results = [];
  const seen = new Set();
  const maxPages = 8;

  for (let page = 0; page < maxPages; page++) {
    const start = page * 10 + 1;
    const url = 'https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query='
      + encodeURIComponent(query) + '&start=' + start;

    try {
      const res = await httpClient.get(url, { headers: SEARCH_HEADERS });
      const posts = parseFullMetadata(res.data, seen);

      if (posts.length === 0 && page > 0) {
        console.log('[검색] 페이지 ' + (page + 1) + ': 신규 없음, 종료');
        break;
      }

      for (const p of posts) {
        seen.add(p.blogId + '_' + p.logNo);
        results.push(p);
      }
      console.log('[검색] 페이지 ' + (page + 1) + ': ' + posts.length + '개 (총 ' + results.length + '개)');

      if (results.length >= maxResults) break;
      await sleep(1000);
    } catch (err) {
      console.error('[검색 에러] 페이지 ' + (page + 1) + ':', err.message);
      break;
    }
  }

  console.log('[검색] 최종: ' + results.length + '개');
  return results.slice(0, maxResults);
}

module.exports = { searchBlogPosts };

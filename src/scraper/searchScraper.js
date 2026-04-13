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

// HTML에서 blogId/logNo 순서만 추출 (관련도순 확보용)
function parseOrderOnly(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/blog\.naver\.com\/(\w+)\/(\d+)/);
    if (!m) return;
    const key = m[1] + '_' + m[2];
    if (seen.has(key)) return;
    const text = $(el).text().trim();
    if (!text || text.length < 5) return;
    if (text.includes('blog.naver.com')) return;
    seen.add(key);
    results.push({ blogId: m[1], logNo: m[2], title: text.replace(/\s+/g, ' ').substring(0, 200) });
  });

  return results;
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

  // 1단계: 일반 검색 → 관련도순 순서 확보 (blogId/logNo/title만)
  let orderList = [];
  try {
    const url = 'https://search.naver.com/search.naver?where=blog&query='
      + encodeURIComponent(query) + '&sm=tab_opt&start=1';
    const res = await httpClient.get(url, { headers: SEARCH_HEADERS });
    orderList = parseOrderOnly(res.data);
    console.log('[검색] 관련도순: ' + orderList.length + '개');
  } catch (err) {
    console.error('[검색 에러] 관련도순:', err.message);
  }

  // 2단계: ssc=tab.blog.all → 전체 메타데이터(블로그명, 날짜) + 추가 결과
  const metadataMap = new Map(); // key → {full post data}
  const sscOrder = []; // ssc에서만 나온 추가 결과 순서
  const maxPages = 8;

  for (let page = 0; page < maxPages; page++) {
    const start = page * 10 + 1;
    const url = 'https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query='
      + encodeURIComponent(query) + '&start=' + start;

    try {
      const res = await httpClient.get(url, { headers: SEARCH_HEADERS });
      const existingKeys = new Set(metadataMap.keys());
      const posts = parseFullMetadata(res.data, existingKeys);

      if (posts.length === 0 && page > 0) {
        console.log('[검색] 페이지 ' + (page + 1) + ': 신규 없음, 종료');
        break;
      }

      for (const p of posts) {
        const key = p.blogId + '_' + p.logNo;
        metadataMap.set(key, p);
        sscOrder.push(key);
      }
      console.log('[검색] 페이지 ' + (page + 1) + ': ' + posts.length + '개 (메타데이터 총 ' + metadataMap.size + '개)');

      if (metadataMap.size >= maxResults + orderList.length) break;
      await sleep(1000);
    } catch (err) {
      console.error('[검색 에러] 페이지 ' + (page + 1) + ':', err.message);
      break;
    }
  }

  // 3단계: 병합 — 관련도순 먼저, 이후 ssc 추가분
  const results = [];
  const usedKeys = new Set();

  // 관련도순 결과에 ssc 메타데이터 병합
  for (const item of orderList) {
    const key = item.blogId + '_' + item.logNo;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);

    const meta = metadataMap.get(key);
    results.push(meta || {
      logNo: item.logNo,
      title: item.title,
      date: new Date(),
      blogId: item.blogId,
      blogName: item.blogId,
    });
  }

  // ssc에서만 나온 추가 결과
  for (const key of sscOrder) {
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    results.push(metadataMap.get(key));
    if (results.length >= maxResults) break;
  }

  console.log('[검색] 최종: 관련도순 ' + Math.min(orderList.length, results.length) + '개 + 추가 ' + Math.max(0, results.length - orderList.length) + '개 = ' + results.length + '개');
  return results.slice(0, maxResults);
}

module.exports = { searchBlogPosts };

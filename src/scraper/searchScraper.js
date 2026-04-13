const { httpClient, sleep } = require('../utils/httpClient');
const cheerio = require('cheerio');

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

// ssc=tab.blog.all 페이지의 HTML을 cheerio로 파싱
function parseSearchPage(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // 블로그 링크가 있는 모든 앵커 태그 순회
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/blog\.naver\.com\/(\w+)\/(\d+)/);
    if (!m) return;

    const blogId = m[1];
    const logNo = m[2];
    const key = blogId + '_' + logNo;
    if (seen.has(key)) return;

    // 제목 텍스트가 있는 링크만 (이미지/썸네일 링크 제외)
    const text = $(el).text().trim();
    if (!text || text.length < 5) return;
    seen.add(key);

    // 개별 포스트 컨테이너 찾기: 위로 올라가다 자식이 많은(>20) 리스트 컨테이너 직전에서 멈춤
    let container = $(el);
    for (let i = 0; i < 10; i++) {
      const next = container.parent();
      if (!next.length) break;
      if (next.children().length > 20) break; // 리스트 컨테이너 도달 → 현재 레벨 사용
      container = next;
    }

    // 블로그명: sds-comps-profile-info-title-text 클래스
    let blogName = blogId;
    const nameEl = container.find('[class*="profile-info-title-text"]').first();
    if (nameEl.length) {
      blogName = nameEl.text().trim() || blogId;
    }

    // 날짜: sds-comps-profile-info-subtext 내 날짜 형식 텍스트
    let date = new Date();
    container.find('[class*="profile-info-subtext"]').each((_, sub) => {
      const subText = $(sub).text().trim();
      if (/\d{4}\.\d{1,2}\.\d{1,2}/.test(subText) || /\d+[일주달개월]?\s*전/.test(subText) || /어제/.test(subText)) {
        date = parseDateStr(subText);
        return false; // break
      }
    });

    results.push({
      logNo,
      title: text.replace(/\s+/g, ' ').substring(0, 200),
      date,
      blogId,
      blogName,
    });
  });

  return results;
}

async function searchBlogPosts(query, maxResults = 70) {
  const results = [];
  const maxPages = 8; // 페이지당 ~10개 신규, 8페이지 = ~80개

  console.log('[검색] "' + query + '" 검색 중...');

  for (let page = 0; page < maxPages; page++) {
    const start = page * 10 + 1;
    const url = 'https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query='
      + encodeURIComponent(query) + '&start=' + start;

    try {
      const res = await httpClient.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://search.naver.com/',
        },
      });

      const posts = parseSearchPage(res.data);
      if (posts.length === 0) {
        console.log('[검색] 페이지 ' + (page + 1) + ': 결과 없음, 종료');
        break;
      }

      // 중복 제거
      const existingKeys = new Set(results.map(r => r.blogId + '_' + r.logNo));
      const newPosts = posts.filter(p => !existingKeys.has(p.blogId + '_' + p.logNo));
      results.push(...newPosts);
      console.log('[검색] 페이지 ' + (page + 1) + ': ' + posts.length + '개 중 ' + newPosts.length + '개 신규 (총 ' + results.length + '개)');

      if (results.length >= maxResults) break;
      if (newPosts.length === 0) {
        console.log('[검색] 신규 결과 없음, 종료');
        break;
      }
      if (page < maxPages - 1) await sleep(1000);
    } catch (err) {
      console.error('[검색 에러] 페이지 ' + (page + 1) + ':', err.message);
      break;
    }
  }

  return results.slice(0, maxResults);
}

module.exports = { searchBlogPosts };

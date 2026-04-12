const { httpClient, sleep } = require('../utils/httpClient');

function parseNaverDate(dateStr) {
  // "2026. 4. 10." 또는 "2026.04.10." 또는 "2026-04-10" 형식
  const cleaned = dateStr.replace(/\./g, '-').replace(/\s/g, '').replace(/-$/, '');
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length >= 3) {
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  return new Date(dateStr);
}

async function fetchPostList(blogId, monthsBack = 3) {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
  cutoffDate.setHours(0, 0, 0, 0);

  const allPosts = [];
  let currentPage = 1;
  let reachedCutoff = false;

  while (!reachedCutoff) {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&currentPage=${currentPage}&countPerPage=30`;

    let response;
    try {
      response = await httpClient.get(url);
    } catch (err) {
      if (err.response?.status === 404) {
        throw new Error(`블로그를 찾을 수 없습니다: ${blogId}`);
      }
      throw err;
    }

    let data = response.data;

    // 네이버 응답은 strict JSON이 아닌 JS 객체 리터럴
    // pagingHtml에 \' (JSON 비표준 이스케이프)가 포함됨 → 수정 후 파싱
    let parsed;
    if (typeof data === 'string') {
      // \' → ' 치환 (JSON에서는 유효하지 않은 이스케이프)
      data = data.replace(/\\'/g, "'");
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new Error('블로그 글 목록을 파싱할 수 없습니다. 블로그 ID를 확인해주세요.');
      }
    } else {
      parsed = data;
    }

    const postList = parsed.postList || [];
    if (postList.length === 0) {
      break;
    }

    for (const post of postList) {
      const postDate = parseNaverDate(post.addDate);
      if (postDate < cutoffDate) {
        reachedCutoff = true;
        break;
      }

      // 제목: URL 인코딩 디코딩 + HTML 태그 제거
      let title = post.title || '제목 없음';
      try {
        title = decodeURIComponent(title);
      } catch {
        // 디코딩 실패 시 원본 유지
      }
      // HTML 엔티티 디코딩
      title = title
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\+/g, ' ');
      // HTML 태그 제거
      title = title.replace(/<[^>]*>/g, '').trim();

      allPosts.push({
        logNo: post.logNo,
        title,
        date: postDate,
      });
    }

    if (postList.length < 30) {
      break;
    }

    currentPage++;
    await sleep(1000);
  }

  return allPosts;
}

module.exports = { fetchPostList };

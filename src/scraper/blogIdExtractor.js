function extractBlogId(urlString) {
  let url;
  try {
    // 프로토콜 없으면 추가
    if (!urlString.startsWith('http')) {
      urlString = 'https://' + urlString;
    }
    url = new URL(urlString);
  } catch {
    throw new Error('올바른 URL 형식이 아닙니다.');
  }

  const hostname = url.hostname;
  if (hostname !== 'blog.naver.com' && hostname !== 'm.blog.naver.com') {
    throw new Error('네이버 블로그 URL이 아닙니다. (blog.naver.com)');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('블로그 ID를 URL에서 찾을 수 없습니다.');
  }

  const blogId = segments[0];

  // blogId 유효성 검증 (영문, 숫자, 언더스코어)
  if (!/^[a-zA-Z0-9_]{2,30}$/.test(blogId)) {
    throw new Error(`올바르지 않은 블로그 ID: ${blogId}`);
  }

  return blogId;
}

module.exports = { extractBlogId };

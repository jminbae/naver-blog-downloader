const cheerio = require('cheerio');
const { httpClient, sleep } = require('../utils/httpClient');

async function scrapePost(blogId, logNo) {
  // 모바일 버전 사용 (iframe 회피)
  const url = `https://m.blog.naver.com/${blogId}/${logNo}`;

  const response = await httpClient.get(url);
  const $ = cheerio.load(response.data);

  // 제목 추출 (여러 에디터 버전 대응)
  const title =
    $('div.se-title-text span').text().trim() ||
    $('h3.se_textarea').text().trim() ||
    $('div.tit_h3').text().trim() ||
    $('div.post_tit h2').text().trim() ||
    $('div.se-module-text span').first().text().trim() ||
    '';

  // 본문 HTML 추출 (에디터 버전별 fallback)
  let contentHtml = '';

  if ($('div.se-main-container').length > 0) {
    // SmartEditor 3 (2019+, 가장 흔함)
    contentHtml = $('div.se-main-container').html();
  } else if ($('div.__se_component_area').length > 0) {
    // SmartEditor ONE
    contentHtml = $('div.__se_component_area').html();
  } else if ($('div#postViewArea').length > 0) {
    // SmartEditor 2 (2015-2019)
    contentHtml = $('div#postViewArea').html();
  } else if ($('div.post_ct').length > 0) {
    // 레거시 포맷
    contentHtml = $('div.post_ct').html();
  } else if ($('div.post-view').length > 0) {
    contentHtml = $('div.post-view').html();
  } else if ($('article').length > 0) {
    contentHtml = $('article').html();
  }

  if (!contentHtml) {
    contentHtml = '';
  }

  // 이미지 URL 수집 (모든 이미지 포함, 링크카드 썸네일도 포함)
  const images = [];
  const $content = cheerio.load(contentHtml);

  $content('img').each((i, el) => {
    const src =
      $content(el).attr('data-lazy-src') ||
      $content(el).attr('data-src') ||
      $content(el).attr('src');
    if (src && (src.includes('pstatic.net') || src.includes('blogfiles'))) {
      // 중복 제거
      if (!images.includes(src)) {
        images.push(src);
      }
    }
  });

  return { title, contentHtml, images, logNo };
}

module.exports = { scrapePost };

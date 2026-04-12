const cheerio = require('cheerio');
const { httpClient, sleep } = require('../utils/httpClient');

// 이미지 URL의 type 파라미터를 w966으로 업그레이드 (큰 이미지 요청)
// 네이버 CDN은 type 제거 시 작은 썸네일을 반환하므로, 반드시 w966 지정
function upgradeToLarge(url) {
  try {
    const parsed = new URL(url);

    // dthumb 프록시 URL인 경우: 실제 URL을 추출하고 w966 적용
    if (parsed.hostname === 'dthumb-phinf.pstatic.net' && parsed.searchParams.has('src')) {
      let realUrl = parsed.searchParams.get('src').replace(/^"|"$/g, '');
      try {
        const realParsed = new URL(realUrl);
        realParsed.searchParams.set('type', 'w966');
        return realParsed.toString();
      } catch {
        return url;
      }
    }

    // 일반 pstatic.net 이미지: type을 w966으로 설정
    if (parsed.hostname.includes('pstatic.net') || parsed.hostname.includes('blogfiles')) {
      parsed.searchParams.set('type', 'w966');
      return parsed.toString();
    }
  } catch {}
  return url;
}

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

  // 이미지 URL 수집 + DOM에서 src 속성 직접 교체
  // 핵심: 네이버는 src=작은썸네일, data-lazy-src=실제이미지 구조.
  // 브라우저는 src만 사용하므로, src를 w966 큰 이미지로 직접 교체해야 함.
  const images = [];
  const $content = cheerio.load(contentHtml, { decodeEntities: false });

  // 헬퍼: 이미지 관련 요소의 URL을 w966으로 업그레이드
  function upgradeElement($el, attrs) {
    // 주어진 속성들 중 가장 큰 원본 URL 찾기
    let bestSrc = null;
    for (const attr of attrs) {
      const val = $el.attr(attr);
      if (val && (val.includes('pstatic.net') || val.includes('blogfiles'))) {
        bestSrc = val;
        break;
      }
    }
    if (!bestSrc) return;

    const fullSrc = upgradeToLarge(bestSrc);

    // 중복 제거 후 images 배열에 추가
    if (!images.includes(fullSrc)) {
      images.push(fullSrc);
    }

    // src 속성을 w966 URL로 직접 교체
    $el.attr('src', fullSrc);
    // lazy loading 속성 제거 (로컬 HTML에서는 JS 없이 무의미)
    $el.removeAttr('data-lazy-src');
    $el.removeAttr('data-src');
  }

  // 1. <img> 태그 처리
  $content('img').each((i, el) => {
    upgradeElement($content(el), ['data-lazy-src', 'data-src', 'src']);
  });

  // 2. <video> 포스터 이미지 처리 (네이버는 GIF를 video로 변환)
  $content('video').each((i, el) => {
    const $el = $content(el);
    const poster = $el.attr('poster');
    const src = $el.attr('src');

    // poster 속성의 블러 썸네일 → w966으로 업그레이드
    if (poster && (poster.includes('pstatic.net') || poster.includes('blogfiles'))) {
      $el.attr('poster', upgradeToLarge(poster));
    }
    // video src가 pstatic 이미지(GIF)인 경우도 처리
    if (src && src.includes('pstatic.net') && !src.includes('mblogvideo-phinf')) {
      const fullSrc = upgradeToLarge(src);
      if (!images.includes(fullSrc)) {
        images.push(fullSrc);
      }
      $el.attr('src', fullSrc);
    }
  });

  // 수정된 DOM을 HTML 문자열로 재직렬화
  contentHtml = $content('body').html() || '';

  return { title, contentHtml, images, logNo };
}

module.exports = { scrapePost };

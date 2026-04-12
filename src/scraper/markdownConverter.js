const TurndownService = require('turndown');
const cheerio = require('cheerio');

function createConverter() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  // 네이버 이미지 컴포넌트
  turndown.addRule('naverImage', {
    filter: (node) => {
      return (
        node.nodeName === 'IMG' &&
        (node.getAttribute('src')?.includes('pstatic.net') ||
          node.getAttribute('data-lazy-src')?.includes('pstatic.net') ||
          node.getAttribute('data-src')?.includes('pstatic.net'))
      );
    },
    replacement: (content, node) => {
      // data-lazy-src가 원본 큰 이미지 URL → 우선 사용 (안전장치)
      const src =
        node.getAttribute('data-lazy-src') ||
        node.getAttribute('data-src') ||
        node.getAttribute('src') ||
        '';
      const alt = node.getAttribute('alt') || '';
      return `![${alt}](${src})\n\n`;
    },
  });

  // 네이버 링크 카드 (se-oglink)
  turndown.addRule('naverOgLink', {
    filter: (node) => {
      return (
        node.nodeName === 'DIV' &&
        node.getAttribute('class')?.includes('se-oglink')
      );
    },
    replacement: (content, node) => {
      // 텍스트에서 링크와 제목 추출 시도
      const text = content.trim();
      if (text) return `\n${text}\n\n`;
      return '';
    },
  });

  // 네이버 비디오 (se-video) - 링크로 대체
  turndown.addRule('naverVideo', {
    filter: (node) => {
      return (
        node.nodeName === 'DIV' &&
        node.getAttribute('class')?.includes('se-video')
      );
    },
    replacement: () => '\n[동영상]\n\n',
  });

  // 스티커 제거
  turndown.addRule('naverSticker', {
    filter: (node) => {
      return (
        node.nodeName === 'DIV' &&
        node.getAttribute('class')?.includes('se-sticker')
      );
    },
    replacement: () => '',
  });

  // 지도 컴포넌트
  turndown.addRule('naverMap', {
    filter: (node) => {
      return (
        node.nodeName === 'DIV' &&
        (node.getAttribute('class')?.includes('se-map') ||
          node.getAttribute('class')?.includes('se-placesMap'))
      );
    },
    replacement: () => '\n[지도]\n\n',
  });

  // 빈 요소 제거
  turndown.addRule('stripEmpty', {
    filter: (node) => {
      return (
        ['DIV', 'P', 'SPAN'].includes(node.nodeName) &&
        node.textContent.trim() === '' &&
        node.querySelectorAll('img').length === 0
      );
    },
    replacement: () => '',
  });

  return turndown;
}

function convertToMarkdown(title, dateStr, contentHtml, blogId, logNo) {
  const turndown = createConverter();
  let markdown = '';

  try {
    markdown = turndown.turndown(contentHtml || '');
  } catch {
    markdown = '(본문 변환 실패)';
  }

  // 연속 빈 줄 정리 (3개 이상 → 2개)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  const frontmatter = `---
title: "${(title || '').replace(/"/g, '\\"')}"
date: "${dateStr}"
source: "https://blog.naver.com/${blogId}/${logNo}"
---

# ${title}

`;

  return frontmatter + markdown;
}

function cleanHtmlForDisplay(html) {
  if (!html) return '';
  const $ = cheerio.load(html, { decodeEntities: false });

  // 모든 img 태그에서 크기 제한 속성 제거
  $('img').each((i, el) => {
    $(el).removeAttr('width');
    $(el).removeAttr('height');
    $(el).removeAttr('style');
    $(el).removeAttr('data-width');
    $(el).removeAttr('data-height');
  });

  // 이미지 감싸는 컨테이너에서 고정 크기 style 제거
  $('[class*="se-image"], [class*="se-module"], [class*="se-section"], [class*="se-component"]').each((i, el) => {
    const style = $(el).attr('style');
    if (style && /width\s*:/i.test(style)) {
      $(el).removeAttr('style');
    }
  });

  // a 태그의 고정 크기 style 제거 (이미지 링크)
  $('a[style]').each((i, el) => {
    const style = $(el).attr('style');
    if (style && /width\s*:/i.test(style)) {
      $(el).removeAttr('style');
    }
  });

  return $('body').html() || '';
}

function convertToHtml(title, dateStr, contentHtml, blogId, logNo) {
  const safeTitle = (title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cleanedHtml = cleanHtmlForDisplay(contentHtml);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  body { font-family: 'Noto Sans KR', -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; line-height: 1.8; }
  .meta { color: #888; font-size: 14px; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 12px; }
  .meta a { color: #03c75a; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  img { width: 100% !important; height: auto !important; border-radius: 4px; margin: 8px 0; display: block; }
  .content * { max-width: 100%; box-sizing: border-box; }
  .content .se-image, .content .se-imageStrip, .content .se-module-image { width: 100% !important; }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<div class="meta">${dateStr} | <a href="https://blog.naver.com/${blogId}/${logNo}">원본 글</a></div>
<div class="content">
${cleanedHtml}
</div>
</body>
</html>`;
}

function convertToText(title, dateStr, contentHtml, blogId, logNo) {
  // HTML 태그 제거 → 순수 텍스트
  let text = (contentHtml || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 연속 빈 줄 정리
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  const header = `제목: ${title}
날짜: ${dateStr}
원본: https://blog.naver.com/${blogId}/${logNo}
${'='.repeat(50)}

`;

  return header + text;
}

function convertContent(format, title, dateStr, contentHtml, blogId, logNo) {
  switch (format) {
    case 'html': return convertToHtml(title, dateStr, contentHtml, blogId, logNo);
    case 'txt':  return convertToText(title, dateStr, contentHtml, blogId, logNo);
    default:     return convertToMarkdown(title, dateStr, contentHtml, blogId, logNo);
  }
}

module.exports = { convertToMarkdown, convertContent };

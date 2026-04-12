const TurndownService = require('turndown');

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
      const src =
        node.getAttribute('src') ||
        node.getAttribute('data-lazy-src') ||
        node.getAttribute('data-src') ||
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

module.exports = { convertToMarkdown };

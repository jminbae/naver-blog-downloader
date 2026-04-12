const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { httpClient, sleep } = require('../utils/httpClient');

// dthumb-phinf 프록시 URL에서 실제 이미지 URL 추출
function resolveProxyUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'dthumb-phinf.pstatic.net' && parsed.searchParams.has('src')) {
      let realUrl = parsed.searchParams.get('src');
      realUrl = realUrl.replace(/^"|"$/g, '');
      return realUrl;
    }
  } catch {}
  return url;
}

function isProxyUrl(url) {
  return url.includes('dthumb-phinf.pstatic.net');
}

// 프록시/직접 URL에 대해 다운로드 시도할 URL 목록 생성
// 우선순위: w966 (큰 이미지) → 원본 URL → 프록시 URL
function buildDownloadCandidates(originalUrl) {
  const candidates = [];

  if (isProxyUrl(originalUrl)) {
    const realUrl = resolveProxyUrl(originalUrl);

    // 1. type=w966 (큰 이미지 우선)
    try {
      const parsed = new URL(realUrl);
      parsed.searchParams.set('type', 'w966');
      candidates.push(parsed.toString());
    } catch {}

    // 2. 실제 URL 그대로
    candidates.push(realUrl);

    // 3. blogthumb → mblogthumb-phinf 호스트 변환 시도
    if (realUrl.includes('blogthumb.pstatic.net')) {
      const converted = realUrl.replace('blogthumb.pstatic.net', 'mblogthumb-phinf.pstatic.net');
      try {
        const parsed = new URL(converted);
        parsed.searchParams.set('type', 'w966');
        candidates.push(parsed.toString());
      } catch {}
      candidates.push(converted);
    }

    // 4. 프록시 URL 그대로 (최후 수단)
    candidates.push(originalUrl);
  } else {
    // 직접 URL: w966 → 원본 URL 그대로
    try {
      const parsed = new URL(originalUrl);
      parsed.searchParams.set('type', 'w966');
      const w966Url = parsed.toString();
      if (w966Url !== originalUrl) {
        candidates.push(w966Url);
      }
    } catch {}
    candidates.push(originalUrl);
  }

  // 중복 제거
  return [...new Set(candidates)];
}

// URL에서 원본 파일명 추출
function extractOriginalFilename(url) {
  const resolved = resolveProxyUrl(url);
  try {
    const parsed = new URL(resolved);
    const segments = parsed.pathname.split('/').filter(Boolean);
    let filename = segments[segments.length - 1];

    if (!path.extname(filename)) {
      filename += '.jpg';
    }

    // 파일명이 너무 짧거나 일반적이면(image.jpg 등) 상위 경로를 접두사로 추가
    const genericNames = ['image', 'img', 'photo', 'thumb', 'thumbnail', 'picture', 'pic'];
    const baseName = path.basename(filename, path.extname(filename));
    if (genericNames.includes(baseName.toLowerCase()) && segments.length >= 2) {
      // 상위 세그먼트의 앞 8자를 접두사로 사용 (고유성 확보)
      const parent = segments[segments.length - 2];
      const prefix = parent.substring(0, 12).replace(/[^a-zA-Z0-9_-]/g, '_');
      filename = `${prefix}_${filename}`;
    }

    if (filename.length > 150) {
      const ext = path.extname(filename);
      filename = filename.substring(0, 150 - ext.length) + ext;
    }

    return filename;
  } catch {
    return 'image.jpg';
  }
}

// 여러 URL 후보로 순차 시도 → 버퍼로 다운로드
async function tryDownloadToBuffer(candidates) {
  for (const url of candidates) {
    try {
      const response = await httpClient.get(url, {
        responseType: 'arraybuffer',
        headers: {
          Referer: 'https://blog.naver.com/',
        },
        timeout: 15000,
      });

      if (response.data && response.data.byteLength > 0) {
        return Buffer.from(response.data);
      }
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

function fileHash(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

// hashMap: filename → [{ hash, savedName }] (세션 간 공유)
// 같은 파일명+같은 내용 → 기존 파일 재사용
// 같은 파일명+다른 내용 → (1), (2) 넘버링
async function downloadImages(images, imagesDir, markdown, hashMap) {
  if (!images || images.length === 0) return markdown;

  fs.mkdirSync(imagesDir, { recursive: true });

  let updatedMarkdown = markdown;
  let successCount = 0;
  let failCount = 0;
  let reuseCount = 0;

  for (let i = 0; i < images.length; i++) {
    const imageUrl = images[i];
    const candidates = buildDownloadCandidates(imageUrl);

    const originalName = extractOriginalFilename(imageUrl);
    const buf = await tryDownloadToBuffer(candidates);

    if (buf) {
      const hash = fileHash(buf);
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);

      // hashMap에서 동일 파일명 항목 검색
      if (!hashMap[originalName]) {
        hashMap[originalName] = [];
      }

      const existing = hashMap[originalName].find(e => e.hash === hash);

      if (existing) {
        // 동일 파일명 + 동일 내용 → 재사용
        updatedMarkdown = updatedMarkdown.split(imageUrl).join(`./images/${existing.savedName}`);
        reuseCount++;
      } else {
        // 새 파일 결정
        let savedName;
        if (hashMap[originalName].length === 0) {
          savedName = originalName;
        } else {
          // 같은 파일명이지만 다른 내용 → 넘버링
          let counter = 1;
          savedName = `${base} (${counter})${ext}`;
          while (fs.existsSync(path.join(imagesDir, savedName))) {
            counter++;
            savedName = `${base} (${counter})${ext}`;
          }
        }

        fs.writeFileSync(path.join(imagesDir, savedName), buf);
        hashMap[originalName].push({ hash, savedName });
        updatedMarkdown = updatedMarkdown.split(imageUrl).join(`./images/${savedName}`);
        successCount++;
      }
    } else {
      failCount++;
    }

    await sleep(300);
  }

  if (reuseCount > 0 || failCount > 0) {
    console.log(`  이미지: ${successCount}개 다운로드, ${reuseCount}개 재사용, ${failCount}개 실패`);
  }

  return updatedMarkdown;
}

module.exports = { downloadImages };

const path = require('path');
const fs = require('fs');
const os = require('os');

function sanitizeFilename(name) {
  // Windows 금지 문자 제거, 한글은 유지
  let sanitized = name.replace(/[\\/:*?"<>|]/g, '_');
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  // 100자 제한 (Windows 경로 길이 문제 방지)
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }
  return sanitized;
}

function formatDate(date) {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function getDownloadsDir() {
  // 서버 환경 (Render 등): 임시 디렉토리 사용
  if (process.env.RENDER || process.env.SERVER_MODE) {
    const tmpDir = path.join(os.tmpdir(), 'naver-blog-dl');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }
  // 로컬 환경: 사용자 Downloads 폴더
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  return downloadsDir;
}

function isServerMode() {
  return !!(process.env.RENDER || process.env.SERVER_MODE);
}

// 중복 파일명 처리: file.jpg → file (1).jpg → file (2).jpg
function getUniqueFilename(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let finalName = filename;
  let counter = 1;

  while (fs.existsSync(path.join(dir, finalName))) {
    finalName = `${base} (${counter})${ext}`;
    counter++;
  }

  return finalName;
}

module.exports = { sanitizeFilename, formatDate, getDownloadsDir, isServerMode, getUniqueFilename };

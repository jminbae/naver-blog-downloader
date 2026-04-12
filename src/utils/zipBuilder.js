const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

async function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 5 },
      // UTF-8 파일명 지원 (한글 폴더/파일명)
      forceZip64: false,
      store: false,
    });

    output.on('close', () => {
      console.log(`ZIP 생성 완료: ${(archive.pointer() / 1024 / 1024).toFixed(1)}MB`);
      resolve(archive.pointer());
    });

    archive.on('error', (err) => {
      console.error('ZIP 생성 에러:', err);
      reject(err);
    });

    archive.on('warning', (err) => {
      console.warn('ZIP 경고:', err);
    });

    archive.pipe(output);
    // ZIP 루트에 바로 파일 배치 (폴더 래핑 없음)
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

module.exports = { createZip };

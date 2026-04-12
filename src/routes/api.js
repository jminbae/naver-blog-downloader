const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { extractBlogId } = require('../scraper/blogIdExtractor');
const { fetchPostList } = require('../scraper/postListFetcher');
const { scrapePost } = require('../scraper/postContentScraper');
const { convertContent } = require('../scraper/markdownConverter');
const { downloadImages } = require('../scraper/imageDownloader');
const { createZip } = require('../utils/zipBuilder');
const { sanitizeFilename, formatDate, getDownloadsDir, isServerMode } = require('../utils/fileUtils');
const { sleep } = require('../utils/httpClient');
const { createJob, updateJob, getJob } = require('../jobManager');

// 스크래핑 파이프라인
async function runScrapingPipeline(jobId, blogId, period, format) {
  try {
    // 1. 글 목록 조회
    updateJob(jobId, { status: 'fetching_list' });
    const posts = await fetchPostList(blogId, period);
    updateJob(jobId, { totalPosts: posts.length });

    if (posts.length === 0) {
      updateJob(jobId, { status: 'done', totalPosts: 0 });
      return;
    }

    // 2. 저장 폴더 생성 (로컬: Downloads, 서버: /tmp)
    const downloadsDir = getDownloadsDir();
    const blogDir = path.join(downloadsDir, blogId);
    const imagesDir = path.join(blogDir, 'images');
    fs.mkdirSync(blogDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });

    // 3. 각 글 스크래핑
    updateJob(jobId, { status: 'scraping' });

    // 이미지 중복 추적 맵 (파일명 → [{hash, savedName}])
    const imageHashMap = {};

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      updateJob(jobId, {
        processedPosts: i,
        currentPost: post.title,
      });

      try {
        // 3a. 글 내용 가져오기
        const scraped = await scrapePost(blogId, post.logNo);

        // 3b. 콘텐츠 변환
        const postTitle = scraped.title || post.title;
        const dateStr = formatDate(post.date);
        let content = convertContent(
          format,
          postTitle,
          post.date.toISOString().split('T')[0],
          scraped.contentHtml,
          blogId,
          post.logNo
        );

        // 3c. 이미지 다운로드 (txt 형식이면 스킵)
        if (format !== 'txt') {
          content = await downloadImages(scraped.images, imagesDir, content, imageHashMap);
        }

        // 3d. 파일 저장
        const ext = format === 'html' ? '.html' : format === 'txt' ? '.txt' : '.md';
        const outFilename = `${dateStr}_${sanitizeFilename(postTitle)}${ext}`;
        fs.writeFileSync(path.join(blogDir, outFilename), content, 'utf-8');
      } catch (postError) {
        console.error(`[글 에러] ${post.title}:`, postError.message);
        const job = getJob(jobId);
        if (job) {
          job.errors.push({
            logNo: post.logNo,
            title: post.title,
            error: postError.message,
          });
        }
      }

      await sleep(1500);
    }

    // 4. ZIP 생성 (다운로드 폴더에)
    updateJob(jobId, { status: 'zipping', processedPosts: posts.length });
    const zipFilename = `${blogId}.zip`;
    const zipPath = path.join(downloadsDir, zipFilename);
    await createZip(blogDir, zipPath);

    // 5. 완료
    updateJob(jobId, {
      status: 'done',
      processedPosts: posts.length,
      zipPath,
      zipFilename,
      blogDir: isServerMode() ? null : blogDir,
      serverMode: isServerMode(),
    });
  } catch (err) {
    console.error('[파이프라인 에러]', err);
    updateJob(jobId, {
      status: 'error',
      errors: [{ error: err.message }],
    });
  }
}

// POST /api/scrape - 스크래핑 시작
router.post('/scrape', (req, res) => {
  try {
    const { url, period, format } = req.body;
    if (!url) {
      return res.status(400).json({ error: '블로그 URL을 입력해주세요.' });
    }

    const blogId = extractBlogId(url);
    const validPeriod = /^\d+(w|m)$/.test(period) ? period : '3m';
    const validFormat = ['html', 'md', 'txt'].includes(format) ? format : 'html';
    const jobId = createJob(blogId);

    // 비동기로 파이프라인 실행 (응답은 즉시 반환)
    runScrapingPipeline(jobId, blogId, validPeriod, validFormat);

    res.json({ jobId, blogId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/status/:jobId - 진행 상태
router.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  }
  res.json({
    id: job.id,
    blogId: job.blogId,
    status: job.status,
    totalPosts: job.totalPosts,
    processedPosts: job.processedPosts,
    currentPost: job.currentPost,
    errors: job.errors,
    zipFilename: job.zipFilename,
    blogDir: job.blogDir,
    serverMode: job.serverMode || false,
  });
});

// GET /api/download/:jobId - ZIP 다운로드
router.get('/download/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
  }
  if (job.status !== 'done' || !job.zipPath) {
    return res.status(400).json({ error: '아직 다운로드 준비가 안 되었습니다.' });
  }
  if (!fs.existsSync(job.zipPath)) {
    return res.status(404).json({ error: 'ZIP 파일을 찾을 수 없습니다.' });
  }

  res.download(job.zipPath, job.zipFilename, () => {
    // 서버 모드: 다운로드 후 임시 파일 정리
    if (isServerMode()) {
      try {
        const downloadsDir = getDownloadsDir();
        const blogDir = path.join(downloadsDir, job.blogId);
        fs.rmSync(blogDir, { recursive: true, force: true });
        fs.rmSync(job.zipPath, { force: true });
      } catch {}
    }
  });
});

module.exports = router;

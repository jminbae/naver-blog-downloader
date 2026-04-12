const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { extractBlogId } = require('../scraper/blogIdExtractor');
const { fetchPostList } = require('../scraper/postListFetcher');
const { scrapePost } = require('../scraper/postContentScraper');
const { convertToMarkdown } = require('../scraper/markdownConverter');
const { downloadImages } = require('../scraper/imageDownloader');
const { createZip } = require('../utils/zipBuilder');
const { sanitizeFilename, formatDate, getUserDownloadsDir } = require('../utils/fileUtils');
const { sleep } = require('../utils/httpClient');
const { createJob, updateJob, getJob } = require('../jobManager');

// 스크래핑 파이프라인
async function runScrapingPipeline(jobId, blogId) {
  try {
    // 1. 글 목록 조회
    updateJob(jobId, { status: 'fetching_list' });
    const posts = await fetchPostList(blogId, 3);
    updateJob(jobId, { totalPosts: posts.length });

    if (posts.length === 0) {
      updateJob(jobId, { status: 'done', totalPosts: 0 });
      return;
    }

    // 2. 사용자 다운로드 폴더에 블로그이름 폴더 생성
    const downloadsDir = getUserDownloadsDir();
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

        // 3b. 마크다운 변환
        const postTitle = scraped.title || post.title;
        const dateStr = formatDate(post.date);
        let markdown = convertToMarkdown(
          postTitle,
          post.date.toISOString().split('T')[0],
          scraped.contentHtml,
          blogId,
          post.logNo
        );

        // 3c. 이미지 다운로드 (공용 images 폴더에 원본 파일명으로, 스마트 중복 처리)
        markdown = await downloadImages(scraped.images, imagesDir, markdown, imageHashMap);

        // 3d. 마크다운 파일 저장 (블로그 폴더에 바로, YYMMDD_제목.md)
        const mdFilename = `${dateStr}_${sanitizeFilename(postTitle)}.md`;
        fs.writeFileSync(path.join(blogDir, mdFilename), markdown, 'utf-8');
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
    const zipFilename = `${blogId}_blog_backup.zip`;
    const zipPath = path.join(downloadsDir, zipFilename);
    await createZip(blogDir, zipPath);

    // 5. 완료
    updateJob(jobId, {
      status: 'done',
      processedPosts: posts.length,
      zipPath,
      zipFilename,
      blogDir,
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
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: '블로그 URL을 입력해주세요.' });
    }

    const blogId = extractBlogId(url);
    const jobId = createJob(blogId);

    // 비동기로 파이프라인 실행 (응답은 즉시 반환)
    runScrapingPipeline(jobId, blogId);

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

  res.download(job.zipPath, job.zipFilename);
});

module.exports = router;

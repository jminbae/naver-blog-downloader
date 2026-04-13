const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { extractBlogId } = require('../scraper/blogIdExtractor');
const { fetchPostList } = require('../scraper/postListFetcher');
const { searchBlogPosts } = require('../scraper/searchScraper');
const { scrapePost } = require('../scraper/postContentScraper');
const { convertContent } = require('../scraper/markdownConverter');
const { downloadImages } = require('../scraper/imageDownloader');
const { createZip } = require('../utils/zipBuilder');
const { sanitizeFilename, formatDate, getDownloadsDir, isServerMode } = require('../utils/fileUtils');
const { sleep } = require('../utils/httpClient');
const { createJob, updateJob, getJob } = require('../jobManager');

// 블로그명에서 특수문자/이모지 제거 (한글, 영문, 숫자, 공백만 유지)
function stripSpecialChars(str) {
  return str
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 스크래핑 파이프라인 (선택된 글만 처리)
// mode: 'blog' (기존) | 'search' (검색)
async function runScrapingPipeline(jobId, identifier, posts, format, mode = 'blog') {
  try {
    updateJob(jobId, { status: 'scraping', totalPosts: posts.length });

    if (posts.length === 0) {
      updateJob(jobId, { status: 'done', totalPosts: 0 });
      return;
    }

    // 저장 폴더 생성
    const downloadsDir = getDownloadsDir();
    const folderName = sanitizeFilename(identifier);
    const blogDir = path.join(downloadsDir, folderName);
    const imagesDir = path.join(blogDir, 'images');
    fs.mkdirSync(blogDir, { recursive: true });
    if (format !== 'txt') {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const imageHashMap = {};

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      updateJob(jobId, {
        processedPosts: i,
        currentPost: post.title,
      });

      try {
        // 글 내용 가져오기 (검색 모드: post별 blogId 사용)
        const postBlogId = mode === 'search' ? post.blogId : identifier;
        const scraped = await scrapePost(postBlogId, post.logNo);

        // 콘텐츠 변환
        const postTitle = scraped.title || post.title;
        const dateStr = formatDate(post.date);
        let content = convertContent(
          format,
          postTitle,
          post.date.toISOString().split('T')[0],
          scraped.contentHtml,
          postBlogId,
          post.logNo
        );

        // 이미지 다운로드
        if (format !== 'txt') {
          content = await downloadImages(scraped.images, imagesDir, content, imageHashMap);
        }

        // 파일명: 검색 모드는 블로그명 포함
        const ext = format === 'html' ? '.html' : format === 'txt' ? '.txt' : '.md';
        let outFilename;
        if (mode === 'search') {
          const cleanBlogName = stripSpecialChars(post.blogName || post.blogId);
          outFilename = `${dateStr}_${sanitizeFilename(cleanBlogName)}_${sanitizeFilename(postTitle)}${ext}`;
        } else {
          outFilename = `${dateStr}_${sanitizeFilename(postTitle)}${ext}`;
        }
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

    // ZIP 생성
    updateJob(jobId, { status: 'zipping', processedPosts: posts.length });
    const zipFilename = `${sanitizeFilename(identifier)}.zip`;
    const zipPath = path.join(downloadsDir, zipFilename);
    await createZip(blogDir, zipPath);

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

// POST /api/fetch-list - 블로그 글 목록 조회
router.post('/fetch-list', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: '블로그 URL을 입력해주세요.' });
    }

    const blogId = extractBlogId(url);
    const posts = await fetchPostList(blogId, '6m');

    const serializedPosts = posts.map(p => ({
      logNo: p.logNo,
      title: p.title,
      date: p.date.toISOString(),
    }));

    res.json({ blogId, posts: serializedPosts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/search-posts - 키워드 검색 글 목록 조회
router.post('/search-posts', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ error: '검색어를 입력해주세요.' });
    }

    const posts = await searchBlogPosts(query.trim(), 70);

    const serializedPosts = posts.map(p => ({
      logNo: p.logNo,
      title: p.title,
      date: p.date.toISOString(),
      blogId: p.blogId,
      blogName: p.blogName,
    }));

    res.json({ query: query.trim(), posts: serializedPosts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/scrape - 선택된 글 스크래핑 시작
router.post('/scrape', (req, res) => {
  try {
    const { url, format, posts, mode = 'blog', query } = req.body;

    if (mode === 'blog' && !url) {
      return res.status(400).json({ error: '블로그 URL을 입력해주세요.' });
    }
    if (mode === 'search' && !query) {
      return res.status(400).json({ error: '검색어가 필요합니다.' });
    }
    if (!posts || !Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: '다운로드할 글을 선택해주세요.' });
    }

    // identifier: 블로그 모드 = blogId, 검색 모드 = 검색어
    const identifier = mode === 'search' ? query : extractBlogId(url);
    const validFormat = ['html', 'md', 'txt'].includes(format) ? format : 'html';
    const jobId = createJob(identifier);
    updateJob(jobId, { mode, query: mode === 'search' ? query : null });

    const parsedPosts = posts.map(p => ({
      logNo: p.logNo,
      title: p.title,
      date: new Date(p.date),
      blogId: p.blogId || identifier,
      blogName: p.blogName || '',
    }));

    runScrapingPipeline(jobId, identifier, parsedPosts, validFormat, mode);

    res.json({ jobId, blogId: identifier });
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
    mode: job.mode || 'blog',
    query: job.query || null,
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
    if (isServerMode()) {
      try {
        const downloadsDir = getDownloadsDir();
        const folderName = sanitizeFilename(job.blogId);
        const blogDir = path.join(downloadsDir, folderName);
        fs.rmSync(blogDir, { recursive: true, force: true });
        fs.rmSync(job.zipPath, { force: true });
      } catch {}
    }
  });
});

module.exports = router;

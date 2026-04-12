let pollingInterval = null;

async function startScraping() {
  const urlInput = document.getElementById('blogUrl');
  const errorMsg = document.getElementById('errorMsg');
  const startBtn = document.getElementById('startBtn');

  const url = urlInput.value.trim();
  if (!url) {
    showError('블로그 URL을 입력해주세요.');
    return;
  }

  // 네이버 블로그 URL 기본 검증
  if (!url.includes('blog.naver.com') && !url.includes('m.blog.naver.com')) {
    showError('네이버 블로그 URL을 입력해주세요. (예: https://blog.naver.com/blogname)');
    return;
  }

  hideError();
  startBtn.disabled = true;
  startBtn.textContent = '처리 중...';

  try {
    const period = document.getElementById('periodSelect').value;
    const format = document.getElementById('formatSelect').value;
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, period, format }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || '요청 실패');
      startBtn.disabled = false;
      startBtn.textContent = '다운로드 시작';
      return;
    }

    // 진행 상태 표시
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';

    // 폴링 시작
    startPolling(data.jobId);
  } catch (err) {
    showError('서버에 연결할 수 없습니다.');
    startBtn.disabled = false;
    startBtn.textContent = '다운로드 시작';
  }
}

function startPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const job = await res.json();
      updateProgress(job, jobId);
    } catch {
      // 네트워크 오류 시 계속 폴링
    }
  }, 1500);
}

function updateProgress(job, jobId) {
  const statusIcon = document.getElementById('statusIcon');
  const statusText = document.getElementById('statusText');
  const progressBar = document.getElementById('progressBar');
  const progressDetail = document.getElementById('progressDetail');
  const currentPost = document.getElementById('currentPost');

  progressBar.classList.remove('indeterminate', 'error');

  switch (job.status) {
    case 'pending':
      statusIcon.textContent = '⏳';
      statusText.textContent = '준비 중...';
      progressBar.classList.add('indeterminate');
      break;

    case 'fetching_list':
      statusIcon.textContent = '📋';
      statusText.textContent = '글 목록 조회 중...';
      progressBar.classList.add('indeterminate');
      break;

    case 'scraping':
      statusIcon.textContent = '📥';
      statusText.textContent = '글 다운로드 중...';
      if (job.totalPosts > 0) {
        const pct = Math.round((job.processedPosts / job.totalPosts) * 100);
        progressBar.style.width = pct + '%';
        progressDetail.textContent = `${job.processedPosts} / ${job.totalPosts} 글 완료`;
      }
      if (job.currentPost) {
        currentPost.textContent = `현재: ${job.currentPost}`;
      }
      break;

    case 'zipping':
      statusIcon.textContent = '📦';
      statusText.textContent = 'ZIP 파일 생성 중...';
      progressBar.style.width = '100%';
      progressBar.classList.add('indeterminate');
      progressDetail.textContent = `${job.totalPosts}개 글 처리 완료`;
      currentPost.textContent = '';
      break;

    case 'done':
      clearInterval(pollingInterval);
      pollingInterval = null;
      statusIcon.textContent = '✅';
      statusText.textContent = '완료!';
      progressBar.style.width = '100%';
      progressDetail.textContent = '';
      currentPost.textContent = '';
      showResult(job, jobId);
      resetButton();
      break;

    case 'error':
      clearInterval(pollingInterval);
      pollingInterval = null;
      statusIcon.textContent = '❌';
      statusText.textContent = '오류 발생';
      progressBar.style.width = '100%';
      progressBar.classList.add('error');
      if (job.errors.length > 0) {
        progressDetail.textContent = job.errors[0].error || '알 수 없는 오류';
      }
      currentPost.textContent = '';
      resetButton();
      break;
  }
}

function showResult(job, jobId) {
  const section = document.getElementById('resultSection');
  const summary = document.getElementById('resultSummary');
  const downloadLink = document.getElementById('downloadLink');
  const errorList = document.getElementById('errorList');
  const errorItems = document.getElementById('errorItems');

  section.style.display = 'block';

  if (job.totalPosts === 0) {
    summary.textContent = '최근 3개월 내 글이 없습니다.';
    downloadLink.style.display = 'none';
    return;
  }

  const successCount = job.totalPosts - job.errors.length;
  summary.innerHTML = `
    블로그 <strong>${job.blogId}</strong>에서
    총 <strong>${successCount}</strong>개 글 다운로드 완료
    ${job.errors.length > 0 ? ` (${job.errors.length}개 실패)` : ''}
    ${job.blogDir ? `<br><small style="color:#888">저장 위치: ${job.blogDir}</small>` : ''}
  `;

  downloadLink.href = `/api/download/${jobId}`;
  downloadLink.textContent = job.serverMode ? 'ZIP 파일 다운로드' : 'ZIP 파일 다운로드 (별도 백업용)';
  downloadLink.style.display = 'block';

  // 오류 목록
  if (job.errors.length > 0) {
    errorList.style.display = 'block';
    errorItems.innerHTML = '';
    for (const err of job.errors) {
      const li = document.createElement('li');
      li.textContent = `${err.title || err.logNo || '알 수 없음'}: ${err.error}`;
      errorItems.appendChild(li);
    }
  } else {
    errorList.style.display = 'none';
  }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function resetButton() {
  const btn = document.getElementById('startBtn');
  btn.disabled = false;
  btn.textContent = '다운로드 시작';
}

// Enter 키로 시작
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('blogUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startScraping();
  });
});

let pollingInterval = null;
let postData = [];   // 전체 글 목록: [{logNo, title, date(ISO)}, ...]
let blogUrl = '';     // 현재 블로그 URL

// ============================
// Step 1: 글 목록 가져오기
// ============================

async function fetchPostList() {
  const urlInput = document.getElementById('blogUrl');
  const fetchBtn = document.getElementById('fetchBtn');
  const url = urlInput.value.trim();

  if (!url) {
    showError('블로그 URL을 입력해주세요.');
    return;
  }
  if (!url.includes('blog.naver.com') && !url.includes('m.blog.naver.com')) {
    showError('네이버 블로그 URL을 입력해주세요. (예: https://blog.naver.com/blogname)');
    return;
  }

  hideError();
  fetchBtn.disabled = true;
  fetchBtn.textContent = '불러오는 중...';

  // 이전 섹션 숨기기
  document.getElementById('postListSection').style.display = 'none';
  document.getElementById('progressSection').style.display = 'none';
  document.getElementById('resultSection').style.display = 'none';

  try {
    const res = await fetch('/api/fetch-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || '요청 실패');
      resetFetchBtn();
      return;
    }

    blogUrl = url;
    postData = data.posts;

    renderPostList();
    document.getElementById('postListSection').style.display = 'block';
    // 디폴트: 최근 2개월 선택
    selectByPeriod('2m');
    resetFetchBtn();
  } catch {
    showError('서버에 연결할 수 없습니다.');
    resetFetchBtn();
  }
}

function resetFetchBtn() {
  const btn = document.getElementById('fetchBtn');
  btn.disabled = false;
  btn.textContent = '글 목록 가져오기';
}

// ============================
// 글 목록 렌더링
// ============================

function renderPostList() {
  const container = document.getElementById('monthGroups');
  container.innerHTML = '';

  if (postData.length === 0) {
    container.innerHTML = '<p class="empty-message">최근 6개월 내 글이 없습니다.</p>';
    document.getElementById('postCount').textContent = '0개';
    updateDownloadButton();
    return;
  }

  // 월별 그룹핑 (YYYY-MM)
  const grouped = {};
  for (const post of postData) {
    const d = new Date(post.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(post);
  }

  // 최신순 정렬
  const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  document.getElementById('postCount').textContent = `총 ${postData.length}개`;

  for (const monthKey of sortedKeys) {
    const posts = grouped[monthKey];
    const [year, month] = monthKey.split('-');
    const monthLabel = `${year}년 ${parseInt(month)}월`;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'month-group';

    // 월 헤더 (체크박스 + 월명 + 글 수)
    const header = document.createElement('label');
    header.className = 'month-header';
    header.innerHTML =
      `<input type="checkbox" class="month-checkbox" data-month="${monthKey}" onchange="onMonthCheckChange('${monthKey}')">` +
      `<span>${monthLabel}</span>` +
      `<span class="month-post-count">${posts.length}개</span>`;

    // 글 리스트
    const ul = document.createElement('ul');
    ul.className = 'post-list';
    ul.dataset.month = monthKey;

    for (const post of posts) {
      const d = new Date(post.date);
      const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

      const li = document.createElement('li');
      li.className = 'post-item';
      li.innerHTML =
        `<input type="checkbox" class="post-checkbox" data-logno="${post.logNo}" data-month="${monthKey}" onchange="onPostCheckChange('${monthKey}')">` +
        `<span class="post-title">${escapeHtml(post.title)}</span>` +
        `<span class="post-date">${dateStr}</span>`;

      // 행 클릭 시 체크박스 토글
      li.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = li.querySelector('.post-checkbox');
          cb.checked = !cb.checked;
          onPostCheckChange(monthKey);
        }
      });

      ul.appendChild(li);
    }

    groupDiv.appendChild(header);
    groupDiv.appendChild(ul);
    container.appendChild(groupDiv);
  }

  updateDownloadButton();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================
// 체크박스 로직
// ============================

function onMonthCheckChange(monthKey) {
  const monthCb = document.querySelector(`.month-checkbox[data-month="${monthKey}"]`);
  const postCbs = document.querySelectorAll(`.post-checkbox[data-month="${monthKey}"]`);
  monthCb.indeterminate = false;
  for (const cb of postCbs) {
    cb.checked = monthCb.checked;
  }
  clearPeriodActive();
  updateDownloadButton();
}

function onPostCheckChange(monthKey) {
  const postCbs = document.querySelectorAll(`.post-checkbox[data-month="${monthKey}"]`);
  const total = postCbs.length;
  const checked = Array.from(postCbs).filter(cb => cb.checked).length;

  const monthCb = document.querySelector(`.month-checkbox[data-month="${monthKey}"]`);
  if (monthCb) {
    monthCb.checked = checked === total;
    monthCb.indeterminate = checked > 0 && checked < total;
  }
  clearPeriodActive();
  updateDownloadButton();
}

function selectAll() {
  document.querySelectorAll('.month-checkbox, .post-checkbox').forEach(cb => {
    cb.checked = true;
    cb.indeterminate = false;
  });
  clearPeriodActive();
  updateDownloadButton();
}

function deselectAll() {
  document.querySelectorAll('.month-checkbox, .post-checkbox').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  clearPeriodActive();
  updateDownloadButton();
}

function clearPeriodActive() {
  document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
}

function getSelectedPosts() {
  const selectedLogNos = new Set();
  document.querySelectorAll('.post-checkbox:checked').forEach(cb => {
    selectedLogNos.add(cb.dataset.logno);
  });
  return postData.filter(p => selectedLogNos.has(String(p.logNo)));
}

function updateDownloadButton() {
  const selected = document.querySelectorAll('.post-checkbox:checked').length;
  const total = document.querySelectorAll('.post-checkbox').length;
  const btn = document.getElementById('downloadBtn');
  btn.textContent = `선택한 글 다운로드 (${selected}개)`;
  btn.disabled = selected === 0;

  // 선택 카운터 배지 업데이트
  const selectionText = document.getElementById('selectionText');
  if (selectionText) {
    selectionText.textContent = `${selected}개 선택 / 전체 ${total}개`;
  }
}

// ============================
// 기간 필터
// ============================

function selectByPeriod(period) {
  // 기간 버튼 활성 상태 갱신
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });

  // 기준 날짜 계산 (오늘 기준)
  const now = new Date();
  let cutoff;

  if (period.endsWith('w')) {
    const weeks = parseInt(period);
    cutoff = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
  } else if (period.endsWith('m')) {
    const months = parseInt(period);
    cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  }

  // 각 체크박스를 기간 기준으로 체크/해제
  document.querySelectorAll('.post-checkbox').forEach(cb => {
    const logNo = cb.dataset.logno;
    const post = postData.find(p => String(p.logNo) === logNo);
    if (post) {
      cb.checked = new Date(post.date) >= cutoff;
    }
  });

  // 월별 체크박스 동기화
  const monthKeys = new Set();
  document.querySelectorAll('.month-checkbox').forEach(cb => {
    monthKeys.add(cb.dataset.month);
  });
  for (const monthKey of monthKeys) {
    syncMonthCheckbox(monthKey);
  }

  updateDownloadButton();
}

function selectByCount(count) {
  // 기간 버튼 활성 상태 갱신
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === count + 'n');
  });

  // 최신순으로 정렬된 postData 기준, 상위 N개만 선택
  const sortedPosts = [...postData].sort((a, b) => new Date(b.date) - new Date(a.date));
  const topLogNos = new Set(sortedPosts.slice(0, count).map(p => String(p.logNo)));

  document.querySelectorAll('.post-checkbox').forEach(cb => {
    cb.checked = topLogNos.has(cb.dataset.logno);
  });

  // 월별 체크박스 동기화
  const monthKeys = new Set();
  document.querySelectorAll('.month-checkbox').forEach(cb => {
    monthKeys.add(cb.dataset.month);
  });
  for (const monthKey of monthKeys) {
    syncMonthCheckbox(monthKey);
  }

  updateDownloadButton();
}

function syncMonthCheckbox(monthKey) {
  const postCbs = document.querySelectorAll(`.post-checkbox[data-month="${monthKey}"]`);
  const total = postCbs.length;
  const checked = Array.from(postCbs).filter(cb => cb.checked).length;

  const monthCb = document.querySelector(`.month-checkbox[data-month="${monthKey}"]`);
  if (monthCb) {
    monthCb.checked = checked === total;
    monthCb.indeterminate = checked > 0 && checked < total;
  }
}

// ============================
// Step 2: 선택한 글 다운로드
// ============================

async function startDownload() {
  const selectedPosts = getSelectedPosts();
  if (selectedPosts.length === 0) return;

  const downloadBtn = document.getElementById('downloadBtn');
  downloadBtn.disabled = true;
  downloadBtn.textContent = '처리 중...';
  hideError();

  try {
    const format = document.getElementById('formatSelect').value;
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: blogUrl,
        format,
        posts: selectedPosts,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || '요청 실패');
      updateDownloadButton();
      return;
    }

    // 진행 상태 표시
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';

    startPolling(data.jobId);
  } catch {
    showError('서버에 연결할 수 없습니다.');
    updateDownloadButton();
  }
}

// ============================
// 폴링 + 진행 상태
// ============================

function startPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const job = await res.json();

      if (!res.ok || job.error) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        showError('서버가 재시작되어 작업이 초기화되었습니다. 다시 시도해주세요.');
        document.getElementById('progressSection').style.display = 'none';
        updateDownloadButton();
        return;
      }

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
      statusIcon.textContent = '\u23F3';
      statusText.textContent = '준비 중...';
      progressBar.classList.add('indeterminate');
      break;

    case 'scraping':
      statusIcon.textContent = '\uD83D\uDCE5';
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
      statusIcon.textContent = '\uD83D\uDCE6';
      statusText.textContent = 'ZIP 파일 생성 중...';
      progressBar.style.width = '100%';
      progressBar.classList.add('indeterminate');
      progressDetail.textContent = `${job.totalPosts}개 글 처리 완료`;
      currentPost.textContent = '';
      break;

    case 'done':
      clearInterval(pollingInterval);
      pollingInterval = null;
      statusIcon.textContent = '\u2705';
      statusText.textContent = '완료!';
      progressBar.style.width = '100%';
      progressDetail.textContent = '';
      currentPost.textContent = '';
      showResult(job, jobId);
      updateDownloadButton();
      break;

    case 'error':
      clearInterval(pollingInterval);
      pollingInterval = null;
      statusIcon.textContent = '\u274C';
      statusText.textContent = '오류 발생';
      progressBar.style.width = '100%';
      progressBar.classList.add('error');
      if (job.errors.length > 0) {
        progressDetail.textContent = job.errors[0].error || '알 수 없는 오류';
      }
      currentPost.textContent = '';
      updateDownloadButton();
      break;
  }
}

// ============================
// 결과 표시
// ============================

function showResult(job, jobId) {
  const section = document.getElementById('resultSection');
  const summary = document.getElementById('resultSummary');
  const downloadLink = document.getElementById('downloadLink');
  const errorList = document.getElementById('errorList');
  const errorItems = document.getElementById('errorItems');

  section.style.display = 'block';

  if (job.totalPosts === 0) {
    summary.textContent = '다운로드할 글이 없습니다.';
    downloadLink.style.display = 'none';
    return;
  }

  const successCount = job.totalPosts - job.errors.length;
  summary.innerHTML =
    `블로그 <strong>${job.blogId}</strong>에서 ` +
    `총 <strong>${successCount}</strong>개 글 다운로드 완료` +
    (job.errors.length > 0 ? ` (${job.errors.length}개 실패)` : '') +
    (job.blogDir ? `<br><small style="color:#888">저장 위치: ${job.blogDir}</small>` : '');

  downloadLink.href = `/api/download/${jobId}`;
  downloadLink.textContent = job.serverMode ? 'ZIP 파일 다운로드' : 'ZIP 파일 다운로드 (별도 백업용)';
  downloadLink.style.display = 'block';

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

// ============================
// 유틸리티
// ============================

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

// Enter 키로 글 목록 가져오기
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('blogUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchPostList();
  });
});

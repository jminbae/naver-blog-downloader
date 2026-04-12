const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API 라우트
const apiRoutes = require('./src/routes/api');
app.use('/api', apiRoutes);

// 에러 핸들링
app.use((err, req, res, next) => {
  console.error('서버 에러:', err.message);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`네이버 블로그 다운로더가 실행 중입니다: http://localhost:${PORT}`);
});

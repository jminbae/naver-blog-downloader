# 네이버 블로그 다운로더

네이버 블로그 URL을 입력하면 최근 3개월치 글을 마크다운(.md) 파일로 변환하고, 이미지까지 모두 다운로드합니다.

## 설치 및 실행

```bash
# 1. 저장소 클론
git clone https://github.com/YOUR_USERNAME/naver-blog-downloader.git
cd naver-blog-downloader

# 2. 의존성 설치
npm install

# 3. 서버 실행
npm start
```

브라우저에서 **http://localhost:3000** 접속 후 블로그 URL을 입력하면 됩니다.

## 요구사항

- Node.js 18 이상

## 사용법

1. `npm start`로 서버 실행
2. 브라우저에서 `http://localhost:3000` 접속
3. 네이버 블로그 URL 입력 (예: `https://blog.naver.com/blogid`)
4. "다운로드 시작" 클릭
5. 완료되면 사용자의 Downloads 폴더에 저장됨

## 출력 구조

```
~/Downloads/blogid/
├── 260401_글제목1.md
├── 260402_글제목2.md
├── ...
└── images/
    ├── photo1.jpg
    ├── photo2.jpg
    └── ...
```

- 마크다운 파일: `YYMMDD_글제목.md` 형식
- 이미지: 원본 파일명 유지, 동일 내용은 중복 없이 하나만 저장
- ZIP 파일도 함께 생성됨

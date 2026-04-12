const axios = require('axios');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createHttpClient() {
  const client = axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    decompress: true,
  });

  // 429/5xx 재시도 (최대 3회, 지수 백오프)
  client.interceptors.response.use(
    response => response,
    async error => {
      const config = error.config;
      if (!config.__retryCount) config.__retryCount = 0;
      if (config.__retryCount >= 3) throw error;

      const status = error.response?.status;
      if (status === 429 || (status >= 500 && status < 600)) {
        config.__retryCount++;
        const delay = 2000 * config.__retryCount;
        await sleep(delay);
        return client(config);
      }
      throw error;
    }
  );

  return client;
}

const httpClient = createHttpClient();

module.exports = { httpClient, sleep };

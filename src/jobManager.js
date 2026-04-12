const { v4: uuidv4 } = require('uuid');

const jobs = new Map();

function createJob(blogId) {
  const jobId = uuidv4();
  jobs.set(jobId, {
    id: jobId,
    blogId,
    status: 'pending',
    totalPosts: 0,
    processedPosts: 0,
    currentPost: '',
    errors: [],
    zipPath: null,
    zipFilename: null,
    createdAt: new Date(),
  });
  return jobId;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, updates);
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = { createJob, updateJob, getJob };

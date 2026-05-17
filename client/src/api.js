async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || '请求失败，请稍后重试。');
    error.details = payload.details;
    error.status = response.status;
    throw error;
  }

  return payload;
}

export const api = {
  createQuiz(topic) {
    return request('/api/quizzes', {
      method: 'POST',
      body: JSON.stringify({ topic })
    });
  },
  createQuizJob(topic) {
    return request('/api/quizzes/jobs', {
      method: 'POST',
      body: JSON.stringify({ topic })
    });
  },
  getQuiz(id) {
    return request(`/api/quizzes/${encodeURIComponent(id)}`);
  },
  updateQuiz(id, data) {
    return request(`/api/quizzes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },
  getPopularQuizzes() {
    return request('/api/quizzes/popular');
  },
  submitAnswers(id, answers) {
    return request(`/api/quizzes/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers })
    });
  },
  getResult(id) {
    return request(`/api/results/${encodeURIComponent(id)}`);
  },
  getStats(id) {
    return request(`/api/quizzes/${encodeURIComponent(id)}/stats`);
  }
};

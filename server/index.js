import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { quizzesRouter } from './routes/quizzes.js';
import { resultsRouter } from './routes/results.js';
import { AppError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: 'http://localhost:5173' }));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/quizzes', quizzesRouter);
app.use('/api', resultsRouter);

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(publicDir, 'index.html'));
      return;
    }
    next();
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((error, req, res, next) => {
  const status = error instanceof AppError ? error.status : 500;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({
    error: error.message || '服务器开小差了，请稍后重试。',
    details: error instanceof AppError ? error.details : null
  });
});

app.listen(port, () => {
  console.log(`QuizForge server running at http://localhost:${port}`);
});

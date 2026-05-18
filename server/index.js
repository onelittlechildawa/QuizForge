import 'dotenv/config';
import { app } from './app.js';
import { getApiErrorLogPath } from './logger.js';

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`QuizForge server running at http://localhost:${port}`);
  console.log(`API error log: ${getApiErrorLogPath()}`);
});

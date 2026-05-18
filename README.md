# QuizForge 测趣工坊

AI 驱动的趣味测评生成器。输入一个主题，后端调用 DeepSeek 生成 4 个维度、12 道题和 16 种结果解析，用户可以编辑问卷、分享短链接、答题并查看结果报告。

## 功能

- DeepSeek 分块生成测评设定、题目和结果解析
- 实时生成进度流，前端展示生成预览
- 类 MBTI 的四维评分模型
- 问卷编辑、短链接分享、结果统计
- 本地 SQLite 持久化，生产支持 Vercel + Cloudflare D1

## 技术栈

- 前端：Vite + Vanilla JS + CSS
- 后端：Express
- 数据库：本地 SQLite / Cloudflare D1 HTTP API
- AI：DeepSeek Chat Completions API

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

开发地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3000

生产模式本地预览：

```bash
npm run build
npm start
```

然后打开：http://localhost:3000

## 环境变量

至少需要配置：

```bash
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

部署到 Vercel 并使用 Cloudflare D1 时，还需要：

```bash
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
```

本地默认使用 SQLite。如果本地也想测试 D1，可以设置：

```bash
QUIZFORGE_DB_DRIVER=d1
```

## Cloudflare D1

创建数据库：

```bash
npx wrangler d1 create quizforge-prod
```

执行迁移：

```bash
npx wrangler d1 migrations apply quizforge-prod --remote
```

迁移文件在 `migrations/0001_initial.sql`。

## Vercel 部署

项目已经包含 `vercel.json`，构建命令为：

```bash
npm run build
```

Vite 会输出到根目录 `public/`，Express API 入口为 `api/[...path].js`。在 Vercel 项目环境变量中配置 DeepSeek 和 Cloudflare D1 后即可部署。

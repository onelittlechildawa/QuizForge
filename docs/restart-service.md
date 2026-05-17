# 如何重启 QuizForge 本地服务

本文档用于在本机重启 QuizForge 服务。当前项目使用 Node.js + Express 提供后端和静态前端页面，默认访问地址是：

```text
http://localhost:3000
```

## 常规重启

如果服务是在当前终端里用 `npm start` 启动的：

1. 在运行服务的终端按 `Control + C` 停止服务。
2. 回到项目根目录：

```bash
cd /Users/onelittlechild/Desktop/开源创新大赛
```

3. 重新启动服务：

```bash
npm start
```

4. 浏览器打开：

```text
http://localhost:3000
```

## 修改代码后的重启

如果改过前端代码，先重新构建，再重启服务：

```bash
cd /Users/onelittlechild/Desktop/开源创新大赛
npm run build
npm start
```

如果只改了后端代码或 `.env` 配置，通常不需要重新构建，直接停止后再运行：

```bash
npm start
```

## 端口被占用

如果启动时提示 `3000` 端口被占用，先找到占用进程：

```bash
lsof -i :3000
```

输出里找到 `PID` 后停止它：

```bash
kill <PID>
```

然后重新启动：

```bash
npm start
```

## 开发模式

如果想同时运行 Vite 前端开发服务器和 Express 后端：

```bash
cd /Users/onelittlechild/Desktop/开源创新大赛
npm run dev
```

开发模式下：

```text
前端：http://localhost:5173
后端：http://localhost:3000
```

日常演示建议使用 `npm run build` 后再 `npm start`，访问 `http://localhost:3000`。

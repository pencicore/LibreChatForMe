# 目录

`/LibreChat` 原LibreChat项目

`/ChatManager` LibreChat扩展功能项目

# 启动！！！

### 原Libre项目

创建数据库
```shell
docker run -d --name chat-mongodb -p 27017:27017 mongo:8.0.20
```
安装依赖
```shell
cd LibreChat
cp .env.example .env
npm run smart-reinstall
```
启动原Libre后端
```shell
cd LibreChat
npm run backend:dev
```
启动原Libre前端
```shell
cd LibreChat
npm run frontend:dev
```

### 扩展功能项目（ChatManager）

比赛用户批量创建与管理，**直接读写 LibreChat 的 MongoDB `users` 集合**。

安装依赖
```shell
cd ChatManager
cp .env.example .env
npm install
```

启动（前后端不分离，默认 http://localhost:3000）
```shell
cd ChatManager
npm run dev
```

主要能力：
- 批量创建比赛账号（bcrypt 密码，可立即登录 LibreChat）
- 用户列表 / 搜索 / 禁用 / 删除 / 导入导出 CSV
- 统计总用户、活跃、今日新增、禁用、管理员
- 聊天记录三栏管理（会话列表 / 消息详情 / 会话元数据），直连 `conversations` 与 `messages` 集合

# 可选

刷新缓存（登陆限流后可以使用）
```shell
npm run flush-cache
```

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
- 聊天记录三栏管理（会话列表 / 消息详情 / 会话元数据），直连 `conversations` 与 `messages` 集合

# 可选

刷新缓存（登陆限流后可以使用）
```shell
npm run flush-cache
```

# 功能
**用户管理界面**
![用户管理界面](ChatManager/image/manager-account.png)

**对话管理界面**
![对话管理界面](ChatManager/image/manager-chat.png)

**禁用账号**
![skill-ban-user.mp4](https://github.com/pencicore/LibreChatForMe/raw/refs/heads/main/ChatManager/image/skill-ban-user.mp4)

**批量生产账号**
![skill-batch-add-user.mp4](ChatManager/image/skill-batch-add-user.mp4)

**导出全部聊天记录**
![skill-export-chat-history.mp4](ChatManager/image/skill-export-chat-history.mp4)

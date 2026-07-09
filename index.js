import express from "express";
import cors from "cors";
import { createRequire } from "module";

// ==================== 1. 兼容老项目的 CommonJS 路由 ====================
// 使用官方标准的 createRequire，这样你原有的老路由文件（require 写的）一个字都不用改！
const require = createRequire(import.meta.url);

// const event = require("./router/event.js");
// const _trap = require("./router/trap.js");
// const mtr = require("./router/mtr.js");
// const ping = require("./router/ping.js");

// ==================== 2. 引入原生 ESM 的 MCP 路由 ====================
import mcpRouter from "./router/mcp.js";

const app = express();
const PORT = 3000;
const version = "v1.0.0_INTEGRATED";
const healthSlaveCache = { value: "Healthy" };

// ==================== 3. 核心中间件与路由挂载 ====================

// 允许跨域
app.use(cors());

// ⚡ 极其重要：优先挂载 MCP 路由！
// 这样可以确保 SSE 的长连接流（Stream）不被下方老项目的任何全局解析、打包、权限中间件污染或掐断
app.use("/api/mcp", mcpRouter);

// 挂载解析 POST JSON 数据的中间件（供老项目接口和 MCP 的 /messages 路由公用）
app.use(express.json());

// 模拟你原有的 session 注入中间件
app.use((req, res, next) => {
    req.session = { username: "admin", userType: "superuser" };
    next();
});

// ==================== 4. 挂载你原本的已有路由 ====================
// app.use("/api/event", event);
// app.use("/api/trap", _trap);
// app.use("/api/mtr", mtr);
// app.use("/api/ping", ping);

app.post("/api/current_user", (req, res) => {
    const { username, userType } = req.session;
    res.json({ username, version, userType, healthSlave: healthSlaveCache.value });
});

app.post("/api/getMonitorResult", async (req, res) => {
    const { pid, fiterData } = req.body;
    let searchStr = "*";
    if (fiterData) {
        searchStr = fiterData;
    }
    res.json({ success: true, pid, searchStr, data: [] });
});

// ==================== 5. 启动服务器 ====================
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`✅ 融合版后端服务器已成功启动，端口: ${PORT}`);
    console.log(`🔗 现有老接口示例: http://localhost:${PORT}/api/ping`);
    console.log(`📡 独立 MCP 连接口: http://localhost:${PORT}/api/mcp/sse`);
    console.log(`=================================================`);
});

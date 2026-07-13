import express from "express";
import cors from "cors";
import mcpRouter from "./mcp.router.js"; // 引入刚才抽离的路由

const app = express();
const PORT = 3000;
const version = "v1.0.0_INTEGRATED";
const healthSlaveCache = { value: "Healthy" };

// ==================== 3. 核心中间件与路由挂载 ====================

// 允许跨域
app.use(cors());
// app.use(express.json()); // 如果需要解析 json 请求体可以加上

// ================== 路由挂载核心部分 ==================

// 挂载 MCP 路由到 /api/mcp 前缀下
app.use("/api/mcp", mcpRouter);
app.use(express.json());

// 你提到的其他路由也可以用同样的方式挂载：
// app.use("/api", checkSession);
// app.use("/api/user", user.router);
// app.use("/api/ne", ne);

// ======================================================

app.listen(PORT, () => {
  console.log(`✅ MCP 多并发 SSE 服务器已成功启动，端口 ${PORT}`);
  console.log(`💡 SSE 终结点: http://localhost:${PORT}/api/mcp/sse`);
});

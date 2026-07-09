import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const app = express();
const PORT = 3000;

app.use(cors());

// 创建一个统一的工具注册函数，方便为每个新 Server 配置工具
function setupTools(server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "calculate_sum",
          description: "计算两个数字的和",
          inputSchema: {
            type: "object",
            properties: {
              a: { type: "number", description: "第一个数字" },
              b: { type: "number", description: "第二个数字" },
            },
            required: ["a", "b"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "calculate_sum") {
      const { a, b } = request.params.arguments;
      return {
        content: [{ type: "text", text: `计算结果：${a} + ${b} = ${a + b}` }],
      };
    }
    throw new Error(`未知的工具: ${request.params.name}`);
  });
}

// 存储所有的活跃连接，包含 transport 和它专属的 server
const activeSessions = new Map();

// GET 路由：每个客户端连接进来时，分配独立的 Server 和 Transport
app.get("/mcp/sse", async (req, res) => {
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-transform");

  // 1. 创建属于当前连接的独立 Transport
  const transport = new SSEServerTransport("/mcp/messages", res);
  const sessionId = transport.sessionId;

  console.log(`[🚀 新连接] 客户端请求建立实例，分配会话 ID: ${sessionId}`);

  // 2. 为当前连接创建独立的 MCP Server 实例
  const mcpServer = new Server(
    { name: `my-mcp-server-${sessionId}`, version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // 3. 挂载工具
  setupTools(mcpServer);

  // 4. 将该会话的 transport 存入 Map
  activeSessions.set(sessionId, transport);

  // 监听断开事件，安全清理
  res.on("close", () => {
    console.log(`[❌ 断开连接] 客户端会话已释放: ${sessionId}`);
    activeSessions.delete(sessionId);
  });

  // 5. 启动当前实例的连接
  await mcpServer.connect(transport);
});

// POST 路由：根据请求的 sessionId 准确路由到对应的 transport
app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = activeSessions.get(sessionId);

  if (!transport) {
    console.warn(`[⚠️ 警告] 收到未知或已过期的会话 POST 请求: ${sessionId}`);
    return res.status(400).send(`未找到对应的 SSE 会话: ${sessionId}`);
  }

  try {
    // 准确交给属于该客户端的 transport 实例处理
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error(`❌ [会话 ${sessionId}] 处理消息错误:`, error);
    if (!res.headersSent) res.status(500).send("Internal Error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ MCP 多并发 SSE 服务器已成功启动，端口 ${PORT}`);
});

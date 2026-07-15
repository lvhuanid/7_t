import express from 'express';
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 1. 必须配置：解析 JSON 请求体，用于接收 POST 来的 JSON-RPC 消息
app.use(express.json());

// 2. 初始化 MCP 核心服务端实例
const mcpServer = new Server(
  {
    name: "my-mcp-streamable-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // 声明本服务器拥有“工具”调用能力
    },
  }
);

// 3. 注册工具 (示例：注册一个简单的加法工具)
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "calculate_sum",
        description: "计算两个数字的和",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number", description: "第一个加数" },
            b: { type: "number", description: "第二个加数" },
          },
          required: ["a", "b"],
        },
      },
    ],
  };
});

// 处理具体的工具调用逻辑
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "calculate_sum") {
    const { a, b } = request.params.arguments;
    return {
      content: [
        {
          type: "text",
          text: `计算结果：${a} + ${b} = ${a + b}`,
        },
      ],
    };
  }
  throw new Error(`未找到工具: ${request.params.name}`);
});

// 4. 创建 Streamable HTTP 传输器
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => {
    const sessionId = crypto.randomUUID();
    console.log(`[🔑 状态追踪] 生成全新会话 ID: ${sessionId}`);
    return sessionId;
  },
});

// 绑定错误与连接释放事件监听
transport.onerror = (error) => {
  console.error("❌ [传输器发生错误]:", error);
};

transport.onclose = () => {
  console.log("🔌 [连接断开] 客户端已断开会话连接");
};

// 5. 统一的 HTTP 通信终结点 (同时支持 GET 建立 SSE 和 POST 传输数据)
app.all('/api/mcp', async (req, res) => {
  // 核心响应头：防止中间代理或 Nginx 缓存流式数据，保证 SSE 能够流畅推送到客户端
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-transform");

  try {
    // 派发给 Streamable HTTPServer 处理器自动匹配 GET/POST
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("❌ [路由处理异常]:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

// 6. 异步启动：确保 Server 与 Transport 绑定成功后，再开启 HTTP 监听
async function startServer() {
  try {
    await mcpServer.connect(transport);
    console.log("✅ MCP 核心服务已成功绑定至 Streamable 传输器");

    app.listen(PORT, () => {
      console.log(`\n🚀 MCP Streamable HTTP 服务已成功启动！`);
      console.log(`🌍 统一终结点: http://localhost:${PORT}/api/mcp`);
      console.log(`👉 请按照先前测试步骤进行 POST 握手测试。\n`);
    });
  } catch (error) {
    console.error("❌ 启动服务失败:", error);
    process.exit(1);
  }
}

startServer();

// 7. 优雅停机处理
process.on('SIGTERM', async () => {
  console.log('正在优雅关闭服务...');
  await transport.close();
  process.exit(0);
});

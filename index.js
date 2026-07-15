import express from 'express';
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'; // 导入 Stdio 传输器
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. 初始化 MCP 核心服务端实例
const mcpServer = new Server(
  { name: "my-mcp-streamable-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 2. 注册工具
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "calculate_sum",
        description: "计算两个数字的和",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "calculate_sum") {
    const { a, b } = request.params.arguments;
    return {
      content: [{ type: "text", text: `计算结果：${a} + ${b} = ${a + b}` }],
    };
  }
  throw new Error(`未找到工具: ${request.params.name}`);
});

// 3. 根据启动参数决定使用哪种传输模式
async function start() {
  const isStdioMode = process.argv.includes('--stdio');

  if (isStdioMode) {
    // ---------------- Stdio 模式（专供 Inspector 调试） ----------------
    const stdioTransport = new StdioServerTransport();
    await mcpServer.connect(stdioTransport);
    console.error("🚀 MCP Server 已在 Stdio 模式下启动（用于本地调试）"); // 必须用 console.error，不能占用 stdout
  } else {
    // ---------------- Streamable HTTP 模式（生产部署） ----------------
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await mcpServer.connect(transport);

    app.all('/api/mcp', async (req, res) => {
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      await transport.handleRequest(req, res, req.body);
    });

    app.listen(PORT, () => {
      console.log(`🚀 MCP Streamable HTTP 模式已启动: http://localhost:${PORT}/api/mcp`);
    });
  }
}

start().catch(console.error);

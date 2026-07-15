这个错误是由于官方 `StreamableHTTPServerTransport` 内置了非常严格的协议合规性检查（即 **HTTP Accept 请求头校验**）。

根据堆栈信息：

> `Error: Not Acceptable: Client must accept both application/json and text/event-stream`

这意味着，在进行 POST 握手时，客户端发送的请求必须显式告诉服务端：“我既能接收 JSON 响应，也能接收 SSE 流”。如果请求头里没有声明这两个，传输器就会直接拒绝该连接。

### 💡 解决方法：修改你的 `curl` 测试命令

你在使用 `curl` 命令行测试时，需要额外加上 **`Accept` 请求头**。

请使用下面这个更新后的 `curl` 命令进行第一步握手测试：

```bash
curl -i -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "mcp-test-client", "version": "1.0.0" }
    }
  }'

```

---

### 为什么官方要加这个限制？

在最新的 **Streamable HTTP** 规范中：

* 客户端发起 POST `initialize` 握手。
* 如果客户端支持标准的流式响应，服务端可以直接通过这个 POST 请求维持长连接，或者告知客户端支持 SSE 升级。
* 因此，规范强制要求客户端在请求时必须发送 `Accept: application/json, text/event-stream`，以此证明自己是一个合规且支持流式传输的 MCP 客户端。

加上这个 `Accept` 请求头后，你就可以顺利拿到 `Mcp-Session-Id` 并进行接下来的工具调用测试了！



erro 2
这其实是一个非常典型的**协议不匹配**问题。

简单来说，MCP Inspector（内置的测试客户端）目前默认的连接逻辑和我们刚刚调通的 **Streamable HTTP** 规范存在冲突。

---

## 为什么 Inspector 会报错？

MCP Inspector 在测试远程/HTTP 服务时，使用的是传统的 **Standard SSE Transport** 逻辑：

1. **它的顺序是反的**：Inspector 启动时，会直接向你提供的 URL 发起 **GET** 请求去尝试建立 SSE 连接。
2. **缺乏必要的 Headers**：它的底层请求并没有携带我们刚才在 `curl` 中强制要求的 `Accept: application/json, text/event-stream` 头，也没有先进行 POST 握手。

因为 Inspector 发送了不合规的请求，你的 Streamable HTTP 服务端为了安全直接拒绝了它，从而导致报错。

---

## 最佳解决方案：在服务端同时支持 Stdio（标准输入输出）

在开发阶段，使用 MCP Inspector 最标准、最推荐的做法是让服务端支持 **Stdio 传输协议**。

这样你既可以通过 HTTP 提供生产服务，又可以在本地直接通过命令行拉起服务进行调试。

### 1. 修改 `server.js` 支持双模式（HTTP + Stdio）

我们对 `server.js` 进行极简的修改。如果检测到启动参数里有 `--stdio`，就使用 Stdio 传输器；否则，启动 HTTP 服务。

```javascript
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

```

---

### 2. 如何使用 Inspector 测试？

现在你的代码完美兼容了两种模式。你可以直接在终端中运行以下命令，让 Inspector 启动并托管你的本地代码：

```bash
npx -y @modelcontextprotocol/inspector node server.js --stdio

```

**运行效果：**

1. Inspector 会在后台用 `node server.js --stdio` 启动你的服务。
2. 它会通过标准输入输出（Stdio）进行完美的、零配置的握手和协议交互。
3. 终端里会输出一个网页地址（通常是 `http://localhost:5173` ），你点击打开它，就能在可视化界面里直接测试你的 `calculate_sum` 工具了！

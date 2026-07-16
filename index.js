import express from "express";
import crypto from "crypto";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ---------------- 配置与全局状态 ----------------
const BASE_URL = process.env.API_BASE_URL || "http://localhost:8888";

// 创建支持 Cookie 自动管理的 Axios 实例
const jar = new CookieJar();
const httpClient = wrapper(
  axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    jar, // 绑定 cookie 罐子
    proxy: false,
    withCredentials: true, // 确保跨域请求也携带 cookie
  }),
);

// 内存中维护一个会话级状态
const sessionState = {
  token: null,
  principal: null,
  isLoggedIn: false,
};

// ---------------- 核心登录逻辑 ----------------
async function performLoginAction(username, password, force) {
  const url = "/api/login";
  const payload = { username, password, force };

  try {
    const response = await httpClient.post(url, payload);
    const data = response.data;
    const rtnCode = data.rtnCode;

    if (rtnCode === 0) {
      sessionState.token = data.token;
      sessionState.principal = data.principal;
      sessionState.isLoggedIn = true;

      return {
        success: true,
        message: "登录成功！",
        username: data.username,
        token: data.token,
        principal: data.principal,
        version: (data.version || "").trim(),
      };
    } else if (rtnCode === -2) {
      return {
        success: false,
        rtnCode: -2,
        message: "该用户已在其他终端登录。",
      };
    } else {
      return {
        success: false,
        message: `登录失败: ${data.rtnMessage || "未知错误"}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `连接后端服务失败: ${error.message}`,
    };
  }
}

// ---------------- MCP 服务端初始化 ----------------
const mcpServer = new Server(
  { name: "TnmsManager", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// 1. 注册工具列表
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
      {
        name: "login_to_project",
        description:
          "手动登录到项目管理系统。通常情况下无需手动调用（启动时已自动登录）。如果运行过程中登录失效，可调用此工具。",
        inputSchema: {
          type: "object",
          properties: {
            username: { type: "string", default: "1" },
            password: { type: "string", default: "!Aa123123" },
            force: { type: "boolean", default: true },
          },
        },
      },
    ],
  };
});

// 2. 处理工具调用
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "calculate_sum") {
    const { a, b } = args;
    return {
      content: [{ type: "text", text: `计算结果：${a} + ${b} = ${a + b}` }],
    };
  }

  if (name === "login_to_project") {
    const username = args.username || "1";
    const password = args.password || "!Aa123123";
    const force = args.force !== undefined ? args.force : true;

    const loginResult = await performLoginAction(username, password, force);
    return {
      content: [{ type: "text", text: JSON.stringify(loginResult, null, 2) }],
    };
  }

  throw new Error(`未找到工具: ${name}`);
});

// ---------------- 启动生命周期 ----------------
async function start() {
  const isStdioMode = process.argv.includes("--stdio");

  // --- 触发启动时自动登录逻辑 (@mcp.on_startup) ---
  const defaultUser = process.env.PROJECT_USER || "1";
  const defaultPass = process.env.PROJECT_PASS || "!Aa123123";

  console.error(`[*] MCP 启动中... 正在尝试自动登录到后端: ${BASE_URL}`);
  const res = await performLoginAction(defaultUser, defaultPass, true);

  if (res.success) {
    console.error(`[✓] 自动登录成功！已获取 Session。系统版本: ${res.version}`);
  } else {
    console.error(
      `[✗] 自动登录失败！原因: ${res.message}. AI 将需要在对话中重新调用登录工具。`,
    );
  }

  // --- 绑定传输层 ---
  if (isStdioMode) {
    const stdioTransport = new StdioServerTransport();
    await mcpServer.connect(stdioTransport);
    console.error("🚀 MCP Server 已在 Stdio 模式下启动（用于本地调试）");
  } else {
    const transport = new StreamableHTTPServerTransport({
      // 每次连接尝试都确保有独立的 UUID
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await mcpServer.connect(transport);

    app.all("/api/mcp", async (req, res) => {
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Cache-Control", "no-cache, no-transform");

      try {
        // 捕获可能由于客户端异常断开导致的 SSE/HTTP 流写入失败
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error("[!] MCP 传输层捕获到连接异常:", err.message);
        // 可以在这里做一些清理逻辑
      }
    });

    app.listen(PORT, () => {
      console.log(
        `🚀 MCP Streamable HTTP 模式已启动: http://localhost:${PORT}/api/mcp`,
      );
    });
  }
}

start().catch(console.error);

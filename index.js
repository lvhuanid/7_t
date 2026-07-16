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
import dayjs from "dayjs"; // ES Module 引入方式

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
  rawCookies: "", // 用于存放登录成功后的 Cookie 字符串
};

/**
 * 🛡️ 自动登录守卫与鉴权 Headers 组装器
 * @returns {Promise<Object>} 组装好的鉴权 headers 对象
 * @throws {Error} 自动登录失败时抛出错误
 */
async function ensureAuthHeaders() {
  // 1. 如果当前未登录，自动发起静默登录
  if (!sessionState.isLoggedIn) {
    const defaultUser = process.env.PROJECT_USER || "1";
    const defaultPass = process.env.PROJECT_PASS || "!Aa123123";

    console.error("[*] 检测到未登录，正在触发守卫自动登录...");
    const loginRes = await performLoginAction(defaultUser, defaultPass, true);

    if (!loginRes.success) {
      throw new Error(`自动登录失败：${loginRes.message}`);
    }
  }

  // 2. 组装鉴权 Headers（带上 principal 并且显式注入 Cookie）
  const headers = {
    principal: sessionState.principal || "",
  };

  if (sessionState.rawCookies) {
    headers["Cookie"] = sessionState.rawCookies; // 保持 Express Session 的核心
  }

  return headers;
}

/**
 * 🕒 复刻原有规则：转换告警创建时间
 * @param {string|number} timeCreated - 后端返回的原始 time-created
 * @param {Object} stats - 可选，物理状态对象，包含修改时间 mtime
 * @returns {string} 格式化后的时间，或原始 mtime
 */
function getFormattedAlarmTime(timeCreated, stats = {}) {
  // 模拟你之前的判定逻辑：
  // 如果 timeCreated 存在且有效，使用 dayjs 格式化它（此处如果是纳秒，传入时除以 1,000,000 转换为毫秒）
  if (timeCreated && timeCreated !== "0") {
    const tsStr = timeCreated.toString();
    const ms =
      tsStr.length > 13
        ? parseInt(tsStr.substring(0, 13), 10)
        : parseInt(tsStr, 10);
    return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
  }

  // 否则退回到 stats.mtime
  const mtime = stats.mtime || new Date(); // 容错处理：若无 mtime，退回当前系统时间
  return dayjs(mtime).format("YYYY-MM-DD HH:mm:ss");
}

/**
 * 🖥️ 添加网元设备的核心业务逻辑
 * @param {Object} neParams - 网元参数对象
 */
async function addNeAction(neParams) {
  try {
    // 🛡️ 1. 自动登录守卫，获取最新的鉴权 Headers 和 Cookie
    const headers = await ensureAuthHeaders();

    console.log(
      `[*] 准备发送添加网元请求，Headers: ${JSON.stringify(headers)}，参数: ${JSON.stringify(neParams)}`,
    );

    // 🛡️ 2. 发送业务 POST 请求 (第二个参数是 payload 负载，第三个是配置项 headers)
    const response = await httpClient.post("/api/nelist/add", neParams, {
      headers,
    });

    return response.data;
  } catch (error) {
    // 🛡️ 3. 容错与 401 重置登录态处理
    if (error.message && error.message.includes("自动登录失败")) {
      return {
        success: false,
        message: `操作中止：${error.message}，请尝试手动调用 login_to_project 工具。`,
      };
    }

    if (error.response && error.response.status === 401) {
      console.error("[!] 收到 401 鉴权失败，已重置登录状态。");
      sessionState.isLoggedIn = false;
    }

    return {
      success: false,
      message: `添加网元失败: ${error.message}`,
    };
  }
}

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

      // 💾 显式提取并保存 Cookie 头（兼容 Express 的多 Cookie 格式）
      const setCookieHeader = response.headers["set-cookie"];
      if (setCookieHeader) {
        sessionState.rawCookies =
          "BrowserSurvival=true;" +
          setCookieHeader.map((cookie) => cookie.split(";")[0]).join("; ");
      }

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

// ---------------- 新增工具：获取所有告警 (带登录守卫) ----------------
async function getAllAlarmAction() {
  try {
    const headers = await ensureAuthHeaders();
    const response = await httpClient.post("/api/monitoring/get_all_alarm", {
      headers,
    });
    const rawData = response.data;

    // 🛡️ 3. 数据清洗与时间转换
    if (Array.isArray(rawData)) {
      return rawData.map((alarm) => {
        // 创建一个新对象，避免直接修改原始数据
        return {
          ...alarm,
          // 转换原本的 time-created 字段
          "time-created": getFormattedAlarmTime(alarm["time-created"]),
        };
      });
    }

    return rawData;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.error("[!] 收到 401 鉴权失败，已重置登录状态。");
      sessionState.isLoggedIn = false;
    }
    return {
      success: false,
      message: `请求 get_all_alarm 失败: ${error.message}`,
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
        name: "login",
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
      {
        name: "get_all_alarm",
        description: "获取所有告警",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "add_network_element",
        description: "向项目系统添加新的网元（NE）设备。会自动处理鉴权。",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "设备类型，例如 '5'",
              default: "5",
            },
            name: {
              type: "string",
              description: "设备名称标识，例如 '222'",
            },
            host: {
              type: "string",
              description: "设备的 IP 地址，例如 '192.168.1.222'",
            },
            port: {
              type: "string",
              description: "设备通信端口，例如 '161'",
              default: "161",
            },
            username: {
              type: "string",
              description: "登录该设备的用户名，例如 'admin'",
              default: "admin",
            },
            password: {
              type: "string",
              description: "登录该设备的密码，例如 'OPtical@1'",
              default: "OPtical@1",
            },
            group: {
              type: "string",
              description: "所属分组，例如 'root'",
              default: "root",
            },
          },
          required: ["name", "host"], // 限制名称和 IP 地址为必填项
        },
      },
    ],
  };
});

// 2. 处理工具调用
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "login") {
    const username = args.username || "1";
    const password = args.password || "!Aa123123";
    const force = args.force !== undefined ? args.force : true;

    const loginResult = await performLoginAction(username, password, force);
    return {
      content: [{ type: "text", text: JSON.stringify(loginResult, null, 2) }],
    };
  }

  if (name === "get_all_alarm") {
    // 调用封装好的自动守卫逻辑
    const alarmResult = await getAllAlarmAction();
    return {
      content: [{ type: "text", text: JSON.stringify(alarmResult, null, 2) }],
    };
  }

  if (name === "add_network_element") {
    // 组装前台 AI 传入的参数（带上默认值容错）
    const neParams = {
      type: args.type || "5",
      name: args.name,
      host: args.host,
      port: args.port || "161",
      username: args.username || "admin",
      password: args.password || "OPtical@1",
      group: args.group || "root",
    };

    // 执行添加网元
    const result = await addNeAction(neParams);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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

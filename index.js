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
import dayjs from "dayjs";

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

// ---------------- 🤖 模型驱动：工具元数据配置 ----------------
const API_METADATA = [
  {
    name: "get_all_alarm",
    description: "获取系统所有的实时活动告警列表。",
    path: "/api/monitoring/get_all_alarm",
    method: "POST",
    properties: {}, // 无入参
    required: [],
    // 提供一个可选的数据清洗/转换钩子
    transformResponse: (data) => {
      if (Array.isArray(data)) {
        return data.map((alarm) => ({
          ...alarm,
          "time-created": formatDate(alarm["time-created"]),
        }));
      }
      return data;
    },
  },
  {
    name: "add_network_element",
    description: "向项目系统添加新的网元（NE）设备。",
    path: "/api/nelist/add",
    method: "POST",
    properties: {
      type: {
        type: "string",
        description:
          "设备类型。目前可选：'5' (表示特定网元512), '251' (表示特定网元251)", // 在描述里写清楚每个值代表什么
        enum: ["5", "251"], // 🌟 限制可选的枚举值
        default: "5",
      },
      name: { type: "string", description: "设备名称标识" },
      host: { type: "string", description: "设备的 IP 地址" },
      port: { type: "string", description: "设备通信端口", default: "161" },
      username: {
        type: "string",
        description: "登录该设备的用户名",
        default: "admin",
      },
      password: {
        type: "string",
        description: "登录该设备的密码",
        default: "OPtical@1",
      },
      group: { type: "string", description: "所属分组", default: "root" },
    },
    required: ["name", "host"],
  },
  {
    name: "delete_network_element",
    description: "向项目系统删除的网元（NE）设备。",
    path: "/api/nelist/del",
    method: "POST",
    properties: {
      ne_id: {
        type: "string",
        description: "设备ip地址和端口号例如(192.168.1.123:161)",
      },
    },
    required: ["ne_id"],
  },
  {
    name: "query_system_entity",
    description:
      "通用数据实体查询工具。可用于获取网元列表、分组配置等实体数据，支持过滤条件。默认获取网元配置 (config:ne)。",
    path: "/api/data/get",
    method: "POST",
    properties: {
      entity: {
        type: "string",
        description:
          "要查询的数据实体类型，例如 'config:ne' (网元配置), 'config:group' (分组配置)",
        default: "config:ne",
      },
      filter: {
        type: "object",
        description: "过滤条件，键值对格式。例如 {'group': 'root'}",
        default: {},
      },
    },
    required: [],
    transformResponse: (data) => {
      if (data && Array.isArray(data.documents)) {
        const cleanedDocs = data.documents.map((item) => {
          const val = item.value || {};

          return {
            id: item.id,
            name: val.name || "",
            host: val.host || "",
            port: val.port || "",
            group: val.group || "root",
            type: val.type || "",
            state: val.state,
            runState: val.runState,
            // 🕒 自动转换纳秒级时间戳为本地时间
            updatedTime: val.time ? formatDate(val.time) : "",
            // ❌ 安全脱敏：移除敏感和无用的多余数据
            // 过滤掉 val.password, val.upgrade, val.data
          };
        });

        return {
          total: data.total || cleanedDocs.length,
          documents: cleanedDocs,
        };
      }
      return data;
    },
  },
  {
    name: "get_connection_by_group",
    description:
      "查询系统内所有分组的网元连接状态与拓扑信息。无需任何参数，会自动处理鉴权。",
    path: "/api/data/connectionbygroup",
    method: "POST",
    properties: {},
    required: [],
    transformResponse: (data) => {
      // 安全检查，确保返回了 neInfo 数组
      if (data && Array.isArray(data.neInfo)) {
        const cleanedNeInfo = data.neInfo.map((item) => {
          const val = item.value || {};

          // 1. 提取并打平我们关心的核心属性
          return {
            id: item.id,
            name: val.name || "",
            host: val.host || "",
            port: val.port || "",
            group: val.group || "root",
            type: val.type || "",
            state: val.state, // 状态
            runState: val.runState, // 运行状态

            // 2. 将超长的纳秒级时间戳转化为本地可读时间
            updatedTime: val.time ? formatDate(val.time) : "",

            // 3. 过滤掉无用的敏感信息与冗余数组
            // ❌ 丢弃：val.password (避免泄露安全凭证并节省 token)
            // ❌ 丢弃：val.upgrade, val.data, val.lng, val.lat (除非你非常需要地图定位)
          };
        });

        // 返回清洗后结构清爽的数据
        return {
          groupInfo: data.groupInfo || [],
          neInfo: cleanedNeInfo,
        };
      }
      return data;
    },
  },
];

/**
 * 🚀 统一的 API 驱动执行器
 */
async function executeConfiguredApi(toolName, args) {
  // 1. 查找对应的配置项
  const config = API_METADATA.find((item) => item.name === toolName);
  if (!config) {
    throw new Error(`未找到配置的工具: ${toolName}`);
  }

  try {
    // 🛡️ 2. 调用通用的登录鉴权守卫
    const headers = await ensureAuthHeaders();

    // 3. 合并参数的默认值
    const payload = {};
    for (const [key, propSpec] of Object.entries(config.properties || {})) {
      payload[key] = args[key] !== undefined ? args[key] : propSpec.default;
    }

    // console.log(
    //   `[*] [驱动器] 执行 ${toolName} -> ${config.path}，参数: ${JSON.stringify(payload)}`,
    // );

    // 4. 根据 method 发起请求 (这里以 POST 为例，如果需要支持 GET，可以用 config.method 判断)
    let response;
    if (config.method === "POST") {
      let requestUrl = config.path;
      if (config.path === "/api/data/get" && payload.entity) {
        requestUrl = `${config.path}?${payload.entity}`; // 拼装成: /api/data/get?config:ne
      }
      response = await httpClient.post(requestUrl, payload, { headers });
    } else {
      response = await httpClient.get(config.path, {
        params: payload,
        headers,
      });
    }

    // 5. 执行可能存在的数据清洗钩子
    if (typeof config.transformResponse === "function") {
      return config.transformResponse(response.data);
    }

    return response.data;
  } catch (error) {
    // 6. 统一的 401 拦截
    if (error.response && error.response.status === 401) {
      console.error(
        `[!] [驱动器] ${toolName} 收到 401 鉴权失败，已重置登录状态。`,
      );
      sessionState.isLoggedIn = false;
    }

    return {
      success: false,
      message: `调用 ${toolName} 失败: ${error.message}`,
    };
  }
}

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
function formatDate(timeCreated, stats = {}) {
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

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  // 1. 基础的手动工具（如登录工具）保持不变
  const staticTools = [
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
  ];

  // 2. 将配置自动转换为 MCP 工具声明
  const dynamicTools = API_METADATA.map((config) => ({
    name: config.name,
    description: config.description,
    inputSchema: {
      type: "object",
      properties: config.properties,
      required: config.required,
    },
  }));

  return {
    tools: [...staticTools, ...dynamicTools],
  };
});

// 2. 处理工具调用
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 1. 保留原本必须手动处理的纯本地工具（如 login）
  if (name === "login") {
    const result = await performLoginAction(
      args.username,
      args.password,
      args.force,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  // 2. 所有的模型驱动工具，全部由统一引擎处理
  const isConfigured = API_METADATA.some((item) => item.name === name);
  if (isConfigured) {
    const result = await executeConfiguredApi(name, args);
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

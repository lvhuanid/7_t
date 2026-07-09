import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const router = express.Router();

// 存储所有的活跃连接，包含 transport 和它专属的 server
const activeSessions = new Map();

function setupTools(server) {
  // 1. 注册工具列表：告诉大模型你有哪些工具可用
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
        // 🚀 新增的告警查询工具
        {
          name: "get_history_alarm",
          description: "从网络管理系统中查询所有的历史告警数据",
          inputSchema: {
            type: "object",
            properties: {}, // 目前你的路由不需要传参，所以这里留空对象
            required: [],
          },
        },
      ],
    };
  });

  // 2. 处理工具的实际执行逻辑
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === "calculate_sum") {
      const { a, b } = request.params.arguments;
      return {
        content: [{ type: "text", text: `计算结果：${a} + ${b} = ${a + b}` }],
      };
    }

    // 🚀 处理新增的告警查询工具
    if (name === "get_history_alarm") {
    //   try {
        // 直接复用你原本后端的数据库查询逻辑
        // const data = await TNMSHistoryAlarmModel.findAll({ raw: true });

      try {
        // 模拟数据库返回的历史告警假数据
        const mockData = [
          {
            id: 1,
            alarm_name: "Link Down",
            severity: "Critical",
            device_ip: "192.168.1.50",
            message: "Interface GigabitEthernet0/1 is down",
            created_at: "2026-07-09 10:00:15"
          },
          {
            id: 2,
            alarm_name: "CPU High Usage",
            severity: "Major",
            device_ip: "192.168.1.30",
            message: "CPU utilization exceeded 95%",
            created_at: "2026-07-09 11:30:22"
          },
          {
            id: 3,
            alarm_name: "Memory Leak Warning",
            severity: "Minor",
            device_ip: "192.168.1.31",
            message: "Available memory below 10%",
            created_at: "2026-07-09 14:15:00"
          }
        ];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(mockData, null, 2)
            }
          ],
        };
      } catch (e) {
        console.error("MCP get_history_alarm exception:", e);
        return {
          isError: true,
          content: [{ type: "text", text: `获取历史告警失败: ${e.message || e}` }],
        };
      }
    }

    throw new Error(`未知的工具: ${name}`);
  });
}

// GET 路由：每个客户端连接进来时，分配独立的 Server 和 Transport
router.get("/sse", async (req, res) => {
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-transform");

  // 1. 创建属于当前连接的独立 Transport
  // ⚠️ 注意：这里的路径必须和 app.js 里挂载的完整公网访问路径 "/api/mcp/messages" 保持绝对一致
  const transport = new SSEServerTransport("/api/mcp/messages", res);
  const sessionId = transport.sessionId;

  console.log(`[🚀 MCP 新连接] 客户端请求建立实例，分配会话 ID: ${sessionId}`);

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
    console.log(`[❌ MCP 断开] 客户端会话已释放: ${sessionId}`);
    activeSessions.delete(sessionId);
  });

  // 5. 启动当前实例的连接
  await mcpServer.connect(transport);
});

// POST 路由：根据请求的 sessionId 准确路由到对应的 transport
router.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = activeSessions.get(sessionId);

  if (!transport) {
    console.warn(`[⚠️ MCP 警告] 收到未知或已过期的会话 POST 请求: ${sessionId}`);
    return res.status(400).send(`未找到对应的 SSE 会话: ${sessionId}`);
  }

  try {
    // 准确交给属于该客户端的 transport 实例处理
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error(`❌ [MCP 会话 ${sessionId}] 处理消息错误:`, error);
    if (!res.headersSent) res.status(500).send("Internal Error");
  }
});

export default router;

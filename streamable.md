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

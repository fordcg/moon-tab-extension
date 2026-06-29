# AI 侧边栏本地 MCP Bridge 示例

这是一个零依赖 HTTP Bridge 示例，用来把本地开发工具暴露给 AI 侧边栏。

## 启动

```powershell
cd examples\mcp-bridge
npm start
```

默认监听：

```text
http://127.0.0.1:17333/
```

然后在 AI 侧边栏中打开“历史 → 工具和 MCP”，填写上面的地址，开启 MCP Bridge 并点击“保存并刷新”。

## 协议

侧边栏当前约定两个接口：

- `GET /tools/list`
- `POST /tools/call`，请求体：`{ "toolId": "dev.echo", "input": { "text": "hello" } }`

Bridge 返回的工具会被侧边栏转换为模型安全函数名，例如：

- `dev.echo` → `mcp.dev.echo` → `mcp_dev_echo`

## 内置示例工具

- `dev.echo`：回显文本，用于验证调用链路。
- `dev.current_time`：返回 Bridge 进程当前时间。
- `dev.summarize_request`：把接口调试信息整理成摘要。

注意：真实工具不要在日志或响应中输出原始密钥、Cookie、Authorization 等敏感信息；侧边栏侧会审计并脱敏，但 Bridge 服务端仍应自行避免泄露。

---
title: 实验 11 · 用 net 与 http 手造原始 TCP 与 304 协商缓存
---

# 实验 11｜用 net 与 http 手造原始 TCP 与 304 协商缓存

> 📖 **关联教程**：[第 14 讲：一次请求出门：DNS、TCP、TLS 与 HTTP 演进](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)  
> 🔍 **关联概念**：[概念 16：TCP 三次握手、字节流与队头阻塞](../02-概念/16-TCP三次握手与队头阻塞.md) ｜ [概念 17：TLS 1.3 握手与数字证书信任链](../02-概念/17-TLS握手与数字证书信任链.md)

## 1. 实验目标与验证边界

1. 不用任何浏览器或第三方库，直接用操作系统底层 TCP 字节流（`node:net`）手拼一份原始 HTTP/1.1 文本请求报文（看清 `GET / HTTP/1.1\r\nHost: ...\r\n\r\n` 的物理真面目）；
2. 亲手实现服务端 `ETag` 指纹生成与 `If-None-Match` 比对，在同一脚本中自动验证**“首次请求返回 `200 OK` 与完整正文 ──► 二次请求携带 `If-None-Match` 命中 `304 Not Modified`（响应体为 0 字节）”**的完整闭环！

## 2. 复制即跑代码

新建 `lab11-tcp-http-304.mjs`，运行 `node lab11-tcp-http-304.mjs`：

```js
// lab11-tcp-http-304.mjs —— 零依赖手造原始 TCP HTTP 报文交互 + ETag/304 协商缓存闭环验证
import net from 'node:net'
import http from 'node:http'
import assert from 'node:assert/strict'

const HTML_BODY = '<h1>前端架构师学院 · 原始字节流与 304 缓存实验</h1>'
const CURRENT_ETAG = '"v1-etag-9527"'

// 1. 启动支持 ETag / If-None-Match 的 HTTP 服务端
const server = http.createServer((req, res) => {
  const clientEtag = req.headers['if-none-match']
  if (clientEtag === CURRENT_ETAG) {
    // 命中协商缓存：返回 304 状态码，且响应体必须为空（0 字节传输）！
    res.writeHead(304, { ETag: CURRENT_ETAG, 'Cache-Control': 'no-cache' })
    return res.end()
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: CURRENT_ETAG
  })
  res.end(HTML_BODY)
})

// 辅助函数：直接用底层 TCP Socket (node:net) 手写原始 HTTP 文本报文发送并接收原始响应字节流
function sendRawHttpOverTcp(port, rawRequestText) {
  return new Promise(resolve => {
    const chunks = []
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(rawRequestText)
    })
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

server.listen(0, async () => {
  const { port } = server.address()

  // 【第 1 次请求】不带 If-None-Match，通过原始 TCP 发送手工拼装的 HTTP/1.1 报文
  const rawReq1 = [
    'GET /index.html HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Connection: close',
    '',
    ''
  ].join('\r\n')

  const rawResp1 = await sendRawHttpOverTcp(port, rawReq1)
  console.log('=== [第 1 次请求] 收到服务端原始 TCP 字节流响应 ===')
  console.log(rawResp1.trim())
  assert.ok(rawResp1.startsWith('HTTP/1.1 200 OK'))
  assert.ok(rawResp1.includes(HTML_BODY))

  // 【第 2 次请求】带上刚刚拿到的 If-None-Match: "v1-etag-9527"
  const rawReq2 = [
    'GET /index.html HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    `If-None-Match: ${CURRENT_ETAG}`,
    'Connection: close',
    '',
    ''
  ].join('\r\n')

  const rawResp2 = await sendRawHttpOverTcp(port, rawReq2)
  console.log('\n=== [第 2 次请求] 携带 If-None-Match 后的原始 TCP 响应 (304 无响应体!) ===')
  console.log(rawResp2.trim())
  assert.ok(rawResp2.startsWith('HTTP/1.1 304 Not Modified'))
  assert.equal(rawResp2.includes(HTML_BODY), false, '304 响应不应重复传输正文')

  server.close()
})
```

## 3. 破坏性实验：如果漏掉了请求末尾的空行 `\r\n\r\n` 会怎样？

把第 41 行的空字符串删掉（让请求头末尾只有一个 `\r\n` 而不是连续两个 `\r\n\r\n`），再运行脚本观察现象！
你会发现**服务端永远不会返回响应，连接一直卡死直到超时**！
- **物理原因**：正如我们在 [概念 16：TCP 字节流](../02-概念/16-TCP三次握手与队头阻塞.md) 中所学，TCP 只是一根没有天然消息边界的字节流管道；HTTP/1.1 解析器全靠连续两个回车换行符 **`\r\n\r\n`** 来判定“HTTP 请求头已经全部发完了”！少了一个 `\r\n`，服务端就以为你还有其他 Header 没发完，一直在内核缓冲区里苦苦傻等！

## 4. 思考题

1. **为什么单页应用（SPA）在配置 Nginx 缓存策略时，`index.html` 必须配 `Cache-Control: no-cache`（每次走 304 协商缓存），而带哈希指纹的 `app.8f9a2b.js` 却可以配 `Cache-Control: max-age=31536000, immutable`（强缓存一年）？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

因为 `index.html` 的文件名是固定不变的（用户永远访问同一个 URL），一旦给 `index.html` 配了强缓存，你发版上线后用户在强缓存过期前根本不会向服务器发请求，永远只能看到旧版页面！配成 `no-cache` 后，浏览器每次打开都会发一个极小的 `If-None-Match` 请求（若没发版则 1 个 RTT 收到 `304` 空包瞬间渲染；一旦发版则 `ETag` 改变，立即返回 `200` 和最新 `index.html`）。而新的 `index.html` 里引用的打包产物文件名已经从 `app.8f9a2b.js` 变成了 `app.c3d4e5.js`（内容变则 URL 必变），所以带哈希的 JS/CSS 可以放心大胆开启长达 1 年的强缓存！

</details>

> 🔙 **返回教程**：[第 14 讲：一次请求出门：DNS、TCP、TLS 与 HTTP 演进](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md) ｜ 👉 **下一个实验**：[实验 12：手写反向代理与令牌桶限流](./实验12-手写反向代理与令牌桶限流.md)

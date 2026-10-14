---
title: 实验 11 · 用 net/http 手造原始 TCP 与 304 缓存
---

# 实验 11｜用 net/http 手造原始 TCP 与 304 缓存

> 📖 **关联教程**：[第 14 讲：一次请求出门：DNS、TCP、TLS 与 HTTP 演进](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)  
> 🔍 **关联概念**：[概念 16：TCP 三次握手、字节流与队头阻塞](../02-概念/16-TCP三次握手与队头阻塞.md)

## 1. 实验目标

不借用任何浏览器或 `fetch` 高级封装，直接用 Node.js 最底层的 `node:net`（纯 TCP 字节流）手拼一段原始 HTTP 文本信封发给服务器，亲手验证：
1. HTTP/1.1 本质就是跑在 TCP 字节管道上的一段固定格式纯文本；
2. 第一次请求拿 `200 OK` 与 `ETag` 指纹，第二次带上 `If-None-Match` 触发 **`304 Not Modified` 空响应体**！

## 2. 复制即跑代码

新建 `lab11-raw-tcp-http.mjs`，运行 `node lab11-raw-tcp-http.mjs`：

```js
// lab11-raw-tcp-http.mjs —— 用原始 TCP Socket 手拼 HTTP 报文，亲手触发 200 与 304！
import http from 'node:http'
import net from 'node:net'

const etag = '"v1-hash-999"'
const body = 'Hello Frontend Architect!'

const server = http.createServer((req, res) => {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag })
    return res.end() // 304 绝不发送响应体！
  }
  res.writeHead(200, { 'Content-Type': 'text/plain', ETag: etag, 'Cache-Control': 'no-cache' })
  res.end(body)
}).listen(0, async () => {
  const { port } = server.address()

  // 用最底层的 TCP Socket 直接往管道里写纯文本 HTTP 报文！
  function sendRawHttp(extraHeader = '') {
    return new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`GET /index.html HTTP/1.1
Host: localhost
Connection: close
${extraHeader}
`)
      })
      let rawResponse = ''
      socket.on('data', chunk => (rawResponse += chunk.toString()))
      socket.on('end', () => resolve(rawResponse))
    })
  }

  console.log('=== 第 1 次请求（无缓存指纹）===')
  console.log((await sendRawHttp()).trim())

  console.log('
=== 第 2 次请求（携带 If-None-Match 指纹）===')
  console.log((await sendRawHttp(`If-None-Match: ${etag}
`)).trim())
  server.close()
})
```

## 3. 破坏性实验：如果漏写了一个 `
` 空行会发生什么？

把第 22 行 `socket.write` 末尾的 `
` 删掉再跑：你会发现服务器一直傻等不回话！
因为 HTTP/1.1 跑在无边界的 TCP 字节流上，协议规定**必须用连续两个回车换行 `

`（一个空行）告诉服务器：“我的请求头写完了！”** 少了一个回车换行，服务器就以为你的请求头还没发完，一直挂着连接干等！

## 4. 思考题

1. **对比上面两次打印出的原始响应报文，304 响应比 200 响应到底省掉了哪一部分？如果这是一个 2MB 的未变文件，304 能省下多少带宽？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

304 响应只有寥寥几十字节的状态行和响应头（`

` 后面空空如也），彻底省掉了整个响应正文（Body）。如果是一个 2MB 的资源，304 协商缓存虽然仍需花 1 个 RTT 的网络往返去核对指纹，但把下载传输量从 2,000,000 字节降到了约 150 字节，节省了 99.99% 的带宽。

</details>

---

> 🔙 **返回教程**：[第 14 讲：一次请求出门：DNS、TCP、TLS 与 HTTP 演进](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md) ｜ 👉 **下一个实验**：[实验 12：手写反向代理、健康检查与令牌桶限流](./实验12-手写反向代理与令牌桶限流.md)

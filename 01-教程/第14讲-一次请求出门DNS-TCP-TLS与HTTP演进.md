---
title: 第 14 讲 · 一次请求出门：DNS、TCP、TLS 与 HTTP 演进
---

# 第 14 讲｜一次请求出门：DNS、TCP、TLS 与 HTTP 演进

> **本讲在主线的位置**：第四卷（网络、数据库与分布式底座）第 1 讲。打开 Chrome DevTools 的 Network 瀑布图，把每一个彩色进度条（`DNS Lookup → Initial Connection → SSL → Waiting TTFB`）背后的物理来回、假设前提与协议演进边界彻底算清楚。

## 1. 场景与核心问题

你在前端写了一行 `await fetch('https://api.example.com/orders')`。
这行代码从离开你的浏览器，到穿过海底光缆到达几千公里外的服务器，中间到底套了几层“信封”？
更重要的是，作为架构师你需要精准回答四个有条件边界的工程问题：
1. **常说的“一次冷启动 HTTPS 请求需要 3～4 个 RTT（往返时延）”究竟依赖哪些前提条件？在连接复用或会话恢复时分别是几个 RTT？**
2. **HTTP/1.1 明明规范里定义了管线化（Pipelining），为什么还会发生应用层队头阻塞？现代浏览器实际上是怎么并发请求的？**
3. **HTTP/2 的多路复用解决了什么问题，又为什么在弱网丢包时反而可能比 6 条连接的 HTTP/1.1 更慢？**
4. **HTTP/3（QUIC）是如何消除“跨流队头阻塞”的？它是否意味着彻底消灭了一切网络阻塞？**

---

## 2. 第一层（直观模型）与第二层（真实机制）：四层信封与条件化 RTT 拆解

### 2.1 为什么要分层？—— 四层信封各司其职

两台相隔千里的电脑只靠光纤里的光脉冲或无线电波对话。为了解耦复杂性，网络协议栈将通信划分为四层职责边界：

```text
┌─ 1. 链路层信封（MAC 帧）：只管“当前这一段局域网/Wi-Fi 下一站交给哪块物理网卡”（每过一个路由器换一次信封）
│  ┌─ 2. 网络层信封（IP 数据报）：管“全球跨网段路由寻址”（路由器查路由表尽力转发，但不保证不丢包、不保证顺序）
│  │  ┌─ 3. 传输层信封（TCP 段 / QUIC 包）：管“端口进程寻址 + 可靠重传、流量控制与拥塞控制”
│  │  │  ┌─ 4. 应用层与安全层（TLS + HTTP 报文）：负责身份认证、加密传输与业务语义（GET /orders HTTP/2）
```

### 2.2 架构师定量算账：一次 HTTPS 请求到底消耗几个 RTT？（必须列明前提条件！）

很多面经死记硬背“发一次 HTTPS 请求固定要花 3～4 个 RTT”。**这是不严谨的！** 真实耗时完全取决于**缓存命中态、协议版本与会话恢复机制**。
请看不同前提条件下的精确 RTT 拆解表（注：`1 RTT` 指数据包从客户端到服务端再返回客户端的 1 次往返时间，不含服务端业务处理耗时）：

| 场景分类 | 前提条件假设 | 建连与握手 RTT 拆解 | 首字节前总耗时（至拿到 TTFB） |
| :--- | :--- | :--- | :--- |
| **场景 A：完全冷启动（TLS 1.3 + HTTP/2）** | 本地无 DNS 缓存 + 无可复用 TCP 连接 + 首次 TLS 1.3 完整握手 | `1 RTT` (DNS 递归查询) + `1 RTT` (TCP 三次握手前两步) + `1 RTT` (TLS 1.3 `ClientHello/ServerHello`) + `1 RTT` (HTTP 请求与响应) | **`4 RTT`**（若 OS/浏览器已命中 DNS 缓存则为 **`3 RTT`**） |
| **场景 B：老旧服务端冷启动（TLS 1.2）** | 无 DNS 缓存 + 新建 TCP 连接 + TLS 1.2 完整握手（需额外交换 `ClientKeyExchange`） | `1 RTT` (DNS) + `1 RTT` (TCP) + **`2 RTT` (TLS 1.2)** + `1 RTT` (HTTP) | **`5 RTT`**（命中 DNS 缓存则为 **`4 RTT`**） |
| **场景 C：长连接热复用（Keep-Alive / HTTP/2 多路复用）** | 同域名已有活跃的 HTTPS 连接，直接在现有连接或 Stream 上发送新请求 | `0 RTT` (DNS) + `0 RTT` (TCP) + `0 RTT` (TLS) + `1 RTT` (HTTP 请求与响应) | **仅需 `1 RTT`！**（省去全部建连与握手开销） |
| **场景 D：QUIC + TLS 1.3 冷启动与 0-RTT 恢复（HTTP/3）** | UDP 承载 QUIC，将传输层握手与 TLS 1.3 握手合并在同一往返中 | 首次连接：建连握手 **`1 RTT`** + 请求 `1 RTT`；<br>会话恢复（PSK 0-RTT）：握手阶段即可夹带幂等请求数据！ | 首次 **`2 RTT`**（不含 DNS）；<br>会话恢复仅需 **`1 RTT`** 即可拿到响应！ |

> 💡 **架构师性能优化抓手**：从上表可以清晰看出，前端配置 `<link rel="dns-prefetch">` 与 `<link rel="preconnect">` 的物理本质，就是趁浏览器解析 HTML 的空档，**提前在后台把场景 A 中的前 `2～3 个 RTT`（DNS + TCP + TLS）跑完**，让后续真正发业务请求时直接进入 **场景 C（`1 RTT`）**！

### 2.3 HTTP 两级缓存：强缓存（`0 RTT`）vs 协商缓存（`1 RTT` 空响应体）

```text
浏览器准备加载资源 (如 app.a1b2c3.js 或 index.html)
   │
   ▼
【第 1 级：强缓存检查 (Cache-Control: max-age=31536000, immutable)】
   ├─ 本地未过期 ──► 直接从 Memory Cache / Disk Cache 读取！（0 网络请求，0 RTT）
   │
   ▼ 已过期，或配置了 Cache-Control: no-cache（注意：no-cache 含义是“使用缓存前必须向服务端验证新鲜度”！）
【第 2 级：协商缓存验证 (请求头携带 If-None-Match: "v1-etag" 或 If-Modified-Since)】
   ├─ 服务端核对指纹未变 ──► 返回 【304 Not Modified】（无响应体 Body，仅几百字节 Header，节省 99% 带宽！）
   └─ 服务端核对指纹已变 ──► 返回 【200 OK】 + 最新完整资源正文 + 新 ETag 指纹
```

### 2.4 可独立运行代码：用 Node.js 原生 `http` 编写支持 `ETag + 304` 协商缓存的验证服务

```js
// etag-304-demo.mjs —— 直接用 node 运行，自动完成“首次 200 下载 -> 二次携带 ETag 命中 304”全流程闭环验证
import http from 'node:http'
import crypto from 'node:crypto'

const body = '<h1>前端架构师学院 · 协商缓存验证</h1>'
const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 12)}"`

const server = http.createServer((req, res) => {
  // 核对客户端带来的 If-None-Match 是否与当前资源指纹一致
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' })
    return res.end() // 304 响应严禁携带正文，仅返回空包通知客户端复用本地缓存！
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'ETag': etag
  })
  res.end(body)
})

server.listen(0, async () => {
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`

  // 第 1 次请求：无缓存指纹 -> 服务端返回 200 及完整正文
  const res1 = await fetch(url)
  const text1 = await res1.text()
  const savedEtag = res1.headers.get('etag')
  console.log(`第 1 次请求 -> 状态码: ${res1.status}, ETag: ${savedEtag}, 下载字节数: ${Buffer.byteLength(text1)}`)

  // 第 2 次请求：携带 If-None-Match -> 服务端返回 304，网络传输正文为 0 字节！
  const res2 = await fetch(url, { headers: { 'If-None-Match': savedEtag } })
  const text2 = await res2.text()
  console.log(`第 2 次请求 -> 状态码: ${res2.status}, 响应体字节数: ${Buffer.byteLength(text2)} (直接复用本地缓存！)`)

  server.close()
})
```

---

## 3. 第三层（边界与反例）：HTTP/1.1 → HTTP/2 → HTTP/3 队头阻塞的精确真相

很多教程把 HTTP/1.1 的队头阻塞简单写成“前一个响应没回来，后一个请求连发都不准发”，又把 HTTP/3 写成“彻底消灭了一切网络阻塞”。**这两种说法在协议规范与工程实践上都是不准确的。**

请看三代协议在**真实机制**与**工程边界**上的严格对比：

| 协议版本 | 核心传输机制 | 队头阻塞（HOL Blocking）的真实成因与工程边界 |
| :--- | :--- | :--- |
| **HTTP/1.1** | 默认开启持久连接（`Connection: keep-alive`）。规范（RFC 2616 / RFC 7230）其实定义了**请求管线化（HTTP Pipelining）**，允许客户端在收到前一个响应前连续发出多个幂等请求。 | **为什么仍有应用层队头阻塞？**<br>1. **FIFO 响应顺序铁律**：因为 HTTP/1.1 报文没有流编号（Stream ID），服务端**必须严格按照请求到达的先后顺序依次返回响应**。只要第 1 个请求在服务端查库耗时 2 秒，第 2、3 个请求哪怕在服务端 1 毫秒就算完了，其响应也必须排在第 1 个响应后面干等！<br>2. **浏览器实践边界**：由于许多老旧代理服务器（Middleboxes）无法正确处理管线化且无法识别非幂等请求边界，**现代主流浏览器默认禁用了 Pipelining**——在单条 HTTP/1.1 连接上退化为串行一问一答，并通过**对同一域名开启最多 6 条并发 TCP 连接**来缓解阻塞。 |
| **HTTP/2** | **二进制分帧（Binary Framing）+ 多路复用（Multiplexing）+ HPACK 头部压缩**：同域名收敛为 **1 条 TCP 连接**，每个请求/响应拆分为携带 `Stream ID` 的 `HEADERS` 帧和 `DATA` 帧交错发送，服务端谁先算完谁先回，彻底解决了 HTTP 应用层排队。 | **为什么又引入了传输层（TCP）队头阻塞？**<br>操作系统内核中的 TCP 协议栈根本感知不到上层有多个独立的 HTTP/2 Stream，它只负责维护**单条严格按字节序号（Sequence Number）连续交付的字节流**（详见 👉 [概念 16](../02-概念/16-TCP三次握手与队头阻塞.md)）。<br>**反例场景**：在丢包率 `> 2%` 的移动弱网下，单条 TCP 连接既承受了所有并发流的丢包重传停顿，又因为丢包触发 TCP 拥塞窗口减半，此时 **1 条连接的 HTTP/2 实际吞吐量甚至可能跑不过开启 6 条独立 TCP 连接的 HTTP/1.1**！ |
| **HTTP/3 (QUIC)** | 基于 UDP 在用户态实现 **QUIC 协议**：将可靠重传与有序交付的粒度从“整条连接”下沉到**“每个独立的 Stream 内部”**，并使用独立的连接标识符（`Connection ID`）支持 Wi-Fi/5G 切换不断连。 | **QUIC 消灭了什么，又没消灭什么？（边界说明）**<br>1. ✅ **消除了“跨流队头阻塞”**：`Stream 1 (app.js)` 发生丢包重传时，已到达的 `Stream 2 (style.css)` 无需陪绑等待，可立即交付给浏览器渲染；<br>2. ⚠️ **并未消除“单流内部阻塞”与拥塞控制**：`Stream 1` 自身缺失的包重传到达前，`Stream 1` 后续的数据依然要按序等待；同时整条连接仍共享拥塞控制窗口，并非魔法般忽略物理带宽限制；<br>3. ⚠️ **部署边界**：部分企业防火墙或运营商设备会对 UDP 443 端口限速或拦截，因此生产环境浏览器必须实现 **HTTP/3 失败自动回退 HTTP/2（Fallback）** 机制。 |

---

## 4. 联动概念与动手实验

- 🔍 **本讲关联概念**：
  - 👉 [概念 15｜同源策略、CORS 预检与 CSP](../02-概念/15-同源策略CORS预检与CSP.md)
  - 👉 [概念 16｜TCP 三次握手、字节流与队头阻塞](../02-概念/16-TCP三次握手与队头阻塞.md)
  - 👉 [概念 17｜TLS 1.3 握手与数字证书信任链](../02-概念/17-TLS握手与数字证书信任链.md)
- 🧪 **本讲配套动手沙盒**：
  - 👉 [实验 11｜用 net/http 手造原始 TCP 与 304 缓存](../03-实验/实验11-用net与http手造TCP与304缓存.md)

## 5. 思考题与架构决策训练

1. **为什么 `Cache-Control: no-cache` 的真实意思不是“不准缓存”，而是“走协商缓存”？真正禁止在磁盘和内存中保存任何副本的指令叫什么？**
2. **【架构决策场景】你的团队正在优化海外弱网环境（平均 RTT = 220ms，丢包率 2.5%）下的电商首屏加载。目前站点仍沿用 HTTP/1.1 时代的“静态资源拆分为 4 个 CDN 子域名（域名分片 Domain Sharding）”策略。升级到 HTTP/2 与 HTTP/3 后，你应该如何重构域名与连接预热方案？如果启用 TLS 1.3 `0-RTT` 数据传输，必须防范什么安全风险？**

<details>
<summary>💡 点击展开本讲思考题与架构决策参考解析</summary>

1. **`no-cache` vs `no-store`**：HTTP 规范中，`no-cache` 表示“客户端可以缓存该响应，但每次直接使用前必须向源站发送条件请求（如 `If-None-Match`）验证有效性”，非常适合单页应用的入口 `index.html`；而 `no-store` 才是真正禁止浏览器与任何中间代理存储请求或响应的任何字节。
2. **海外弱网的协议升级与安全边界决策**：
   - **收敛域名分片**：在 HTTP/2 和 HTTP/3 下应废弃人为拆分的 4 个 CDN 子域名，收敛到统一静态域名（或与主站同源并开启连接合并 Connection Coalescing），省去额外 3 个域名的 DNS 解析、TCP 握手与 TLS 握手开销，并提高 HPACK/QPACK 头部压缩字典复用率；
   - **连接预热**：对核心 API 与静态域名注入 `<link rel="preconnect">`，在 HTML 解析初期提前消化建连 RTT；
   - **TLS 1.3 `0-RTT`（Early Data）的安全边界**：`0-RTT` 允许客户端在第一个握手包里直接夹带加密的 HTTP 请求，但**如果攻击者截获并重放这第一个数据包（Replay Attack 重放攻击），服务端会执行两次**！因此架构铁律是：**`0-RTT` 仅允许用于无副作用的幂等查询请求（如 `GET` 静态资源或公开商品列表），严禁用于扣款、下单等非幂等状态修改接口**。

</details>

> 👉 **下一讲**：请求穿过了公网，终于到达了后端机房的大门。门口站着哪四位守门神？为什么你会收到 `502`、`503`、`504`、`429`？请看 **[第 15 讲｜请求进机房：CDN、负载均衡、网关限流与 BFF](./第15讲-请求进机房CDN负载均衡网关限流与BFF.md)**。

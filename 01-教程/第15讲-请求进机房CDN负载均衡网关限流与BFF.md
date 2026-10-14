---
title: 第 15 讲 · 请求进机房：CDN、负载均衡、网关限流与 BFF
---

# 第 15 讲｜请求进机房：CDN、负载均衡、网关限流与 BFF

> **本讲在主线的位置**：第四卷第 2 讲。揭开服务端入口基础设施的面纱，搞懂一个请求在真正碰到业务代码之前經歷的**“四层漏斗防线”**，并掌握前端团队能直接主导的 **BFF（服务于前端的后端）** 架构。

## 1. 场景与核心问题

为什么大厂的系统架构图里，浏览器从来不直接连业务服务器，中间非要垫上 **CDN → 负载均衡（LB）→ 反向代理（Nginx）→ API 网关 → BFF** 这么多层？
还有：线上出了故障，监控报警一会儿报 `502 Bad Gateway`、一会儿报 `503 Service Unavailable`、一会儿报 `504 Gateway Timeout`、一会儿报 `429 Too Many Requests`——作为架构师，你如何只看一眼状态码，3 秒内断定是哪一层出了什么问题？

## 2. 从零推导：层层挡子弹的“漏斗架构”

整个服务端入口的设计哲学只有一句话：**“用越靠外、越便宜的地方，挡掉越多的流量，拼死保护最里面昂贵脆弱的数据库。”**

```text
用户请求
  │
  ▼ 【第 1 层：CDN 边缘节点】 ──► 静态资源（JS/CSS/图）直接在家门口返回，90% 流量根本进不了机房！
  │ (未命中的动态 API 请求回源进机房)
  ▼ 【第 2 层：负载均衡 LB / Nginx】 ──► 把流量均匀分给多台无状态机器，挂了一台自动摘除（健康检查）！
  │
  ▼ 【第 3 层：API 网关】 ──► 统一验票（鉴权 JWT）、限流（令牌桶挡住超额洪峰 429）、熔断降级！
  │
  ▼ 【第 4 层：BFF 聚合层】 ──► 在机房内网并发调 5 个微服务拼好前端所需 JSON，省掉手机公网 5 次往返！
```

### 2.1 CDN 的缓存键陷阱：为什么加了时间戳或乱带 Query 会让 CDN 彻底失效？
CDN 默认用**完整的 URL（含 `?` 后面的所有 query 参数）**作为[哈希表](../02-概念/05-哈希表与冲突拉链.md)的缓存键（Cache Key）。
如果你的静态资源 URL 后面跟了每次都变的随机参数（如 `logo.png?t=1710001`、`logo.png?from=wechat`），CDN 会以为它们是成千上万个完全不同的新文件，每次都穿透回源站去拉取！
- **正确规矩**：静态资源用内容指纹文件名（`app.8f9a1b.js`）配 `Cache-Control: public, max-age=31536000, immutable`；CDN 开启“忽略无关 query 参数”。

### 2.2 负载均衡与“无状态铁律”
当 1 台业务机器扩成 10 台时，负载均衡器（如 Nginx）怎么分派流量？
- **轮询 / 最少连接**：适合无状态 API 服务（前提：**应用服务器内存里绝不能独自保存用户的登录 Session**，否则下次请求分给隔壁机器用户就掉线了！登录态必须外置到 Redis 或用签名 Token）；
- **一致性哈希**：适合带本地缓存的节点，加减机器时只搬迁极少部分数据（详见 👉 **[概念 19：一致性哈希圆环与令牌桶限流](../02-概念/19-一致性哈希与令牌桶限流.md)**）。

### 2.3 BFF（Backend For Frontend）：前端架构师向后端延伸的最佳抓手
假设渲染一个电商首页需要拿“用户信息、购物车数量、猜你喜欢、优惠券、秒杀倒计时” 5 个微服务的数据。
- **没有 BFF**：手机在弱网下发 5 个公网请求，串行等待或挤占带宽，还要在前端写一堆适配脏字段的逻辑；
- **有 Node.js BFF 层**：手机只向 BFF 发 **1 个请求**；BFF 在机房高速内网（延迟仅 0.2ms）用 `Promise.allSettled` 并发调 5 个下游微服务，裁掉多余字段、做好兜底降级（哪怕“优惠券服务”挂了，只让优惠券区块显示为空，绝不让整个首页白屏！）。

### 2.4 示例代码：20 行写出一个带“超时控制 + 部分失败降级”的高可用 BFF 聚合接口
```js
// bff-aggregator.js —— 用 Promise.allSettled + 超时保护，绝不因为一个非核心下游挂掉而让首页白屏！
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Upstream Timeout')), ms))
  ])
}

export async function getHomePageData(userId) {
  // 机房内网并发请求 3 个下游微服务，每个限时 800ms
  const [userRes, cartRes, couponRes] = await Promise.allSettled([
    withTimeout(fetchUserService(userId), 800),
    withTimeout(fetchCartService(userId), 800),
    withTimeout(fetchCouponService(userId), 800) // 非核心服务：哪怕超时报错也不崩全局！
  ])

  if (userRes.status === 'rejected') throw new Error('核心用户服务不可用') // 核心失败才报错

  return {
    user: userRes.value,
    cartCount: cartRes.status === 'fulfilled' ? cartRes.value.count : 0,        // 降级兜底为 0
    coupons: couponRes.status === 'fulfilled' ? couponRes.value.list : []       // 降级兜底为空数组
  }
}
```

### 2.5 一张表秒懂网关 4 大错误状态码

| 状态码 | 英文名 | 物理真相（到底谁出事了？） |
| :--- | :--- | :--- |
| **`429`** | Too Many Requests | **被网关令牌桶限流拦住了！** 请求太猛把桶里令牌拿光了，前端应读 `Retry-After` 退避 |
| **`502`** | Bad Gateway | **上游业务进程崩了或拒接！** 网关连过去时被对方直接重置（RST）或进程刚闪退 |
| **`503`** | Service Unavailable | **没有健康的可用机器了！** 所有上游实例健康检查全挂，或触发了网关主动熔断保护 |
| **`504`** | Gateway Timeout | **上游太慢等不起了！** 请求进了业务机器，但卡在慢 SQL 或死锁上，超过了网关等待时限 |

## 3. 联动概念与动手实验

- 🔍 **本讲关联概念**：
  - 👉 [概念 19｜一致性哈希圆环与令牌桶限流](../02-概念/19-一致性哈希与令牌桶限流.md)
- 🧪 **本讲配套动手沙盒**：
  - 👉 [实验 12｜手写反向代理、健康检查与令牌桶限流（亲手制造 429/502/503/504）](../03-实验/实验12-手写反向代理与令牌桶限流.md)

## 4. 思考题

1. **为什么在 BFF 层并行请求多个下游服务时，强烈推荐用 `Promise.allSettled` 而不是 `Promise.all`？**
2. **如果前端 Axios 设置的超时时间是 5 秒，Nginx 网关的 `proxy_read_timeout` 是 60 秒，而后端某个慢接口跑了 15 秒才算完，这期间会发生什么隐患？超时时间应该怎么对齐？**

<details>
<summary>💡 点击展开本讲思考题完整参考答案</summary>

1. **`Promise.allSettled` 防级联雪崩**：`Promise.all` 采用“一损俱损（短路）”逻辑——只要 5 个下游里最不重要的那个“猜你喜欢”接口挂了，整个 `Promise.all` 直接抛错，导致已经成功拿回来的核心用户信息和订单数据全部作废，页面整屏报错！而 `Promise.allSettled` 会等待所有分支走完并分别标记 `fulfilled / rejected`，允许核心数据正常渲染、非核心区块优雅降级。
2. **超时倒挂隐患与漏斗对齐原则**：前端在 5 秒时就已经主动断开连接给用户报错了（Nginx 日志记为 `499 Client Closed Request`），但 Nginx 和后端并不知道用户已经走了，还在继续白白消耗数据库连接和 CPU 算那剩下的 10 秒！如果用户此时点重试，后端就会叠加双倍的慢查询直接雪崩。**超时对齐原则**：越靠近用户的外层超时应略长于内层（或通过 Context 传递剩余超时预算），绝不能让内层还在盲目死算一个外层早已放弃的请求。

</details>

---

> 👉 **下一讲**：请求穿过了网关和 BFF，终于来到了整个后端最昂贵、最核心的命脉——**数据库、缓存与分布式共识**！请看 **[第 16 讲｜数据落盘与分布式：B+ 树、事务、Redis 与 Raft](./第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md)**。

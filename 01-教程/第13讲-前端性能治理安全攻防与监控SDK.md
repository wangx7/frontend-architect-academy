---
title: 第 13 讲 · 前端性能治理、安全攻防与监控 SDK
---

# 第 13 讲｜前端性能治理、安全攻防与监控 SDK

> **本讲在主线的位置**：第三卷收官课。没有度量就没有优化，没有防线就没有稳定。本讲带你建立完整的 **Core Web Vitals 性能归因体系**、**XSS/CSRF/CSP 纵深安全防线**，并亲手写出一个生产级 **前端监控 SDK**。

## 1. 场景与核心问题

老板在群里发了一张截图：“有客户投诉咱们页面打开是白屏，还有人说点按钮反应特别慢！你们赶紧查查怎么回事！”
如果你没有前端可观测性（监控 SDK），你只能尴尬地回复：“我本地电脑上好好的呀，要不让客户清下缓存或者录个屏？”
一个成熟的前端架构师，必须在用户投诉之前，就能在监控大盘上看到：**哪个地区的哪个浏览器报错了、报错对应源码第几行、首屏 LCP 慢在哪个阶段、以及页面是不是真的白屏了！**

## 2. 从零推导：性能三大核心指标、安全双防线与监控探针

### 2.1 性能治理：Google Core Web Vitals 三大指标到底在量什么？
别背英文缩写，直接把它们挂回我们在[第 04 讲（渲染管线）](./第04讲-字节是怎么变成屏幕像素的.md)和[第 05 讲（事件循环）](./第05讲-JS单线程与事件循环调度.md)学过的流水线上：

| 指标名称 | 人话定义（它在量什么体验？） | 合格线 | 慢了去哪一层抓凶手？ |
| :--- | :--- | :--- | :--- |
| **LCP (最大内容绘制)** | 首屏最大的那张主图或大标题**真正画上屏幕**花了多久（代表“加载速度”） | **≤ 2.5 秒** | 1. 查服务端 TTFB 是否过慢；<br>2. 查是否有阻塞 `<head>` 的同步 JS/大 CSS；<br>3. 主图禁止懒加载，加 `<link rel="preload" fetchpriority="high">` |
| **INP (交互到下一帧绘制)** | 用户点击按钮后，到浏览器**画出反馈画面**卡了多久（代表“交互流畅度”） | **≤ 200 毫秒** | 90% 是第 05 讲的**主线程长任务（Long Task > 50ms）**或第 07 讲的大范围组件重渲染堵住了渲染机会！用时间切片或 Worker 拆解 |
| **CLS (累积布局位移)** | 页面加载过程中，已经画出来的文字按钮**突然乱跳了多少距离**（代表“视觉稳定性”） | **≤ 0.1** | 1. `<img>` 没写 `width/height` 宽高属性；<br>2. 异步广告或顶部通知条突然插进来把下面内容顶走（必须提前预留骨架占位高度！） |

### 2.2 安全攻防：一张图分清 XSS（家贼）与 CSRF（借刀杀人）
配合 👉 **[概念 15：同源策略、CORS 预检与 CSP](../02-概念/15-同源策略CORS预检与CSP.md)**，前端安全的两大头号公敌及其铁壁防线如下：

```text
【攻击 1：XSS 跨站脚本攻击（引狼入室：黑客把恶意 JS 代码塞进了你的网页里执行！）】
  常见漏洞：把用户输入的评论 `<img src=x onerror="偷cookie()">` 直接塞进 `v-html` 或 `innerHTML`！
  三道铁壁：① 绝不裸用 v-html（富文本必过 DOMPurify 白名单过滤）；
            ② 敏感登录 Cookie 一律加 `HttpOnly`（禁止 JS `document.cookie` 读取！）；
            ③ 响应头配 `Content-Security-Policy (CSP)` 禁止执行内联脚本与外域脚本！

【攻击 2：CSRF 跨站请求伪造（借刀杀人：黑客诱骗已登录用户在钓鱼网站向你家接口发转账请求！）】
  为什么能成：因为浏览器向 `bank.com` 发请求时，默认会自动把 `bank.com` 的 Cookie 捎带上！
  三道铁壁：① Cookie 开启 `SameSite=Lax` 或 `Strict`（跨站请求严禁自动捎带 Cookie！）；
            ② 核心写接口改用自定义 Header `Authorization: Bearer <token>`（钓鱼网站跨域加不了自定义头！）；
            ③ 关键操作校验 `Origin / Referer` 头或一次性 CSRF Token。
```

### 2.3 示例代码：30 行手写一个“错误捕获 + 十字采样白屏检测 + 性能采集”监控 SDK
怎么用代码判断用户的屏幕是不是真的白屏了？最稳妥的工业级算法是 **“屏幕十字采样点检测法（`document.elementsFromPoint`）”**——在屏幕正中央画一个十字，取 9 个坐标点，看看这 9 个点最顶上盖着的元素是不是全都是空的 `<html>`、`<body`> 或 `#app` 外壳！

```js
// mini-monitor-sdk.js —— 30 行浓缩生产级前端监控 SDK 三大核心探针！
export function initMonitor(reportUrl) {
  const send = (type, data) => navigator.sendBeacon?.(reportUrl, JSON.stringify({ type, data, ts: Date.now() }))

  // 1. 捕获同步运行时错误、资源 404 错误与未处理的 Promise 拒绝
  window.addEventListener('error', e => {
    const isResource = e.target && e.target !== window
    send('error', isResource ? { tag: e.target.tagName, src: e.target.src } : { msg: e.message, stack: e.error?.stack })
  }, true) // 注意：必须开启 true（捕获阶段）才能抓到 <img>/<script> 加载 404 错误！

  window.addEventListener('unhandledrejection', e => send('promise_err', { reason: String(e.reason) }))

  // 2. 十字采样白屏检测：检查屏幕中心横竖 9 个坐标点是否全部只落在了 body/#app 空壳上
  window.addEventListener('load', () => {
    setTimeout(() => {
      const shells = new Set(['HTML', 'BODY', '#app'])
      let emptyCount = 0
      for (let i = 1; i <= 9; i++) {
        const el = document.elementsFromPoint((window.innerWidth * i) / 10, window.innerHeight / 2)[0]
        if (!el || shells.has(el.tagName) || shells.has('#' + el.id)) emptyCount++
      }
      if (emptyCount === 9) send('white_screen', { url: location.href })
    }, 2000)
  })
}
```

## 3. 联动概念与动手实验

- 🔍 **本讲关联概念**：
  - 👉 [概念 13｜GPU 合成层与 BFC 布局边界](../02-概念/13-合成层与BFC布局边界.md)
  - 👉 [概念 15｜同源策略、CORS 预检与 CSP](../02-概念/15-同源策略CORS预检与CSP.md)
- 🧪 **本讲配套动手沙盒**：
  - 👉 [实验 10｜手写前端错误捕获、白屏与性能探针](../03-实验/实验10-手写前端错误与性能监控探针.md)

## 4. 思考题

1. **为什么在监控 SDK 里监听 `window.addEventListener('error', fn, true)` 时，第三个参数必须传 `true`（在捕获阶段监听）？如果传默认的 `false`（冒泡阶段）会漏掉哪类极其关键的线上故障？**
2. **为什么上报监控数据时，优先推荐使用 `navigator.sendBeacon()` 而不是普通的 `axios.post()`？**

<details>
<summary>💡 点击展开本讲思考题完整参考答案</summary>

1. **为什么必须用捕获阶段（`true`）**：因为 `<script src="chunk.js">`、`<img>`、`<link>` 等静态资源加载失败（如发版后 chunk 404 白屏）触发的 `error` 事件**不会冒泡（does not bubble）**！如果在冒泡阶段（`false`）监听 `window`，所有的静态资源 404 报错都会漏网；只有在从上往下传播的捕获阶段（`true`）才能在 `window` 上一把抓全。
2. **为什么用 `sendBeacon`**：很多关键埋点和错误发生在用户关闭标签页或跳转离开页面的瞬间（`visibilitychange / pagehide`）。此时如果发普通的异步 `fetch / XHR`，浏览器在销毁页面时会直接把未完成的网络请求强制掐断（Cancel），导致最关键的崩溃日志报不上去；而 `navigator.sendBeacon` 会把数据移交给浏览器主进程在后台可靠发送，即使当前页面已经关闭也绝不丢包。

</details>

---

> 👉 **下一讲**：恭喜你完成前三卷，彻底拿下了前端架构师的核心武装！从下一讲开始进入 **第四卷：网络、数据库与分布式底座**，把你的视野从浏览器内部一路打通到后端机房与分布式集群：**[第 14 讲｜一次请求出门：DNS、TCP、TLS 与 HTTP 演进](./第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)**。

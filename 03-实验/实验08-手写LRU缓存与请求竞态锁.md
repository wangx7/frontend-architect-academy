---
title: 实验 08 · 手写 LRU 缓存与异步请求竞态锁
---

# 实验 08｜手写 LRU 缓存与异步请求竞态锁

> 📖 **关联教程**：[第 11 讲：大型前端架构与状态分层](../01-教程/第11讲-大型前端架构状态分层防腐蚀层与插件内核.md)  
> 🔍 **关联概念**：[概念 03：双向链表](../02-概念/03-单向链表与双向链表.md) ｜ [概念 09：LRU 缓存淘汰算法](../02-概念/09-LRU缓存淘汰算法.md)

## 1. 实验目标

1. 手写一个基于 **哈希表 + 双向链表思想** 的 **LRU 缓存器**；
2. 复现前端最容易踩坑的 **“Tab 快速切换异步请求竞态覆盖 Bug”**（先发的慢请求后返回，把后发的快请求数据覆盖成错的），并用请求版本号锁将它彻底治愈！

## 2. 复制即跑代码

新建 `lab08-lru-race.mjs`，运行 `node lab08-lru-race.mjs`：

```js
// lab08-lru-race.mjs —— 亲手实现 LRU 缓存淘汰 + 治愈异步请求竞态覆盖 Bug
class LRUCache {
  constructor(max = 2) { this.max = max; this.map = new Map() }
  get(k) {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k); this.map.delete(k); this.map.set(k, v) // 提鲜至队尾
    return v
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k)
    this.map.set(k, v)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value) // 踢掉队头最老项
  }
}

const cache = new LRUCache(2)
cache.set('Tab1', '订单数据'); cache.set('Tab2', '账单数据')
cache.get('Tab1')              // 访问 Tab1 使其变成最新，Tab2 变成最老
cache.set('Tab3', '报表数据')  // 超出容量 2，踢掉最老的 Tab2
console.log('1. [LRU验证] Tab2被踢:', cache.get('Tab2'), '| Tab1保留:', cache.get('Tab1'))

// 2. [异步竞态锁验证] 用户先点 TabA(慢:100ms)，立刻又点 TabB(快:20ms)
let latestReqId = 0
let currentViewData = ''

async function switchTab(tabName, networkDelayMs) {
  const myReqId = ++latestReqId // 领一张递增的请求号牌！
  await new Promise(r => setTimeout(r, networkDelayMs))
  // 回来时核对号牌：如果已经有更新的请求发出了，我这份过期响应直接作废丢弃！
  if (myReqId !== latestReqId) {
    console.log(`🛡️ [竞态拦截] ${tabName} 的过期响应已丢弃 (号牌 ${myReqId} < 最新 ${latestReqId})`)
    return
  }
  currentViewData = `${tabName} 的正确内容`
}

await Promise.all([switchTab('TabA(慢请求)', 100), switchTab('TabB(最后点的快请求)', 20)])
console.log('2. [最终页面显示]:', currentViewData) // 稳稳停在 TabB 的正确内容！
```

## 3. 破坏性实验：去掉竞态号牌检查会发生什么？

把上面第 28～31 行的 `if (myReqId !== latestReqId) return` 注释掉再跑：
你会看到虽然用户最后点击的是 `TabB`，但 100ms 后姗姗来迟的 `TabA(慢请求)` 把 `currentViewData` 错误地覆盖成了 **`TabA(慢请求) 的正确内容`**——这就是无数线上“页面标题是 B、列表内容却是 A”的灵异 Bug 根源！

## 4. 思考题

1. **除了用递增请求号牌 `latestReqId` 丢弃过期响应外，浏览器原生还提供了哪个 API 可以直接把在途的旧 HTTP 请求掐断？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

使用浏览器原生的 **`AbortController`**：每次发起新 `fetch(url, { signal: controller.signal })` 前，先调用上一次请求的 `prevController.abort()`，浏览器网络层会直接中止旧请求并抛出 `AbortError`，既防止了脏数据覆盖，又节省了浏览器解析响应的开销。

</details>

---

> 🔙 **返回教程**：[第 11 讲：大型前端架构与状态分层](../01-教程/第11讲-大型前端架构状态分层防腐蚀层与插件内核.md) ｜ 👉 **下一个实验**：[实验 09：30 行手写微前端 Proxy 隔离沙箱](./实验09-30行手写微前端Proxy沙箱.md)

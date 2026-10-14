---
title: 概念 09 · LRU 缓存淘汰算法（哈希表+双向链表）
---

# 概念 09｜LRU 缓存淘汰算法（Least Recently Used）

> **一句话人话定义**：内存空间是有限的，当缓存装满要塞入新数据时，**踢掉那个“最久没被任何人访问过的老古董”**，就叫 LRU；它的底层是 **[哈希表（负责 1 步找到人）](./05-哈希表与冲突拉链.md)** 与 **[双向链表（负责按新旧排队、1 步挪位置）](./03-单向链表与双向链表.md)** 的完美合体！

## 1. 它被什么痛点逼出来的？

无论是前端 Vue 的 `<KeepAlive :max="3">` 缓存已打开过的标签页组件，还是后端 Redis 内存满了要自动清理冷数据，都必须同时做到以下**三件事全部是 $O(1)$（1 步完成）**：
1. **查得快**：给你一个 `key`，1 步拿出缓存数据；
2. **提鲜快**：一旦某个缓存被访问了，1 步把它从原位置抽出来，挪到“最新鲜”的队头；
3. **淘汰快**：一旦缓存超容了，1 步把排在队尾“最久没碰过”的老数据踢掉。

为什么单一数据结构全都做不到？
- 只用 **[哈希表](./05-哈希表与冲突拉链.md)**：第 1 条（查）是 $O(1)$，但哈希表是乱序搅拌机，根本不知道谁最新、谁最老！
- 只用 **[双向链表](./03-单向链表与双向链表.md)**：第 2、3 条（头尾挪动和踢除）是 $O(1)$，但想在链表里找到某个 `key` 得从头跑腿 $O(n)$！

## 2. 内存门牌号合体慢放图：哈希表指路 + 双向链表排队

把两者合二为一：**让所有节点用双向链表按“最老 ──► 最新”排好队，同时用哈希表记下每个 `key` 对应的双向链表节点门牌号！**

```text
【哈希表 Map（负责 1 步指路）】
  "页面A" ──► #101
  "页面B" ──► #205
  "页面C" ──► #309

【双向链表（负责按活跃时间排队：左边最老，右边最新）】
  最老 (head)                                                   最新 (tail)
     ▼                                                             ▼
  #101 { key:"页面A" }  <===>  #205 { key:"页面B" }  <===>  #309 { key:"页面C" }
```

现在看两个关键动作有多丝滑：
1. **用户访问了 `"页面A"`（`get("页面A")`）**：
   - 先查哈希表，1 步拿到门牌号 `#101`；
   - 利用双向链表 `prev/next` 纸条，1 步把 `#101` 从最左边摘下来，挂到最右边 `#309` 后面（现在 `"页面A"` 成了最新，`#205 "页面B"` 变成了最老）！
2. **新打开了 `"页面D"`，但容量上限只有 3 个（`set("页面D", ...)`）**：
   - 1 步直接砍掉最左边的队头 `#205 ("页面B")`，同时在哈希表里删掉 `"页面B"`；
   - 把新节点 `#410 ("页面D")` 挂到最右边队尾！

## 3. 25 行极简代码原型：利用 JS `Map` 实现工业级 LRU

JavaScript 内置的 `Map` 底层在 C++ 引擎里已经帮你把“哈希表 + 双向链表”合体好了（`Map` 会严格维护插入顺序，`map.keys().next().value` 永远是队头最老的 key）：

```js
class LRUCache {
  constructor(max = 3) {
    this.max = max
    this.cache = new Map() // 内置哈希表 + 双向链表顺序
  }
  get(key) {
    if (!this.cache.has(key)) return undefined
    const val = this.cache.get(key)
    // 提鲜：先删再插，把它挪到队尾（最新鲜位置）
    this.cache.delete(key)
    this.cache.set(key, val)
    return val
  }
  set(key, val) {
    if (this.cache.has(key)) this.cache.delete(key)
    this.cache.set(key, val)
    // 超出容量上限：1 步踢掉队头（最久没被访问过的老家伙）
    if (this.cache.size > this.max) {
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }
  }
}

const keepAlive = new LRUCache(2)
keepAlive.set('Home', '首页组件'); keepAlive.set('List', '列表组件')
keepAlive.get('Home')              // 访问了 Home，Home 变最新，List 变最老
keepAlive.set('Detail', '详情组件') // 满员！踢掉最老的 List
console.log('List 还在吗:', keepAlive.get('List'), '| Home 还在吗:', keepAlive.get('Home'))
```

## 4. 前后端架构双视角落地

| 维度 | 前端架构中的体现 | 后端与系统架构中的体现 |
| :--- | :--- | :--- |
| **直接源码应用** | **Vue 3 `<KeepAlive :max="10">` 组件实例缓存**（源码 `packages/runtime-core/src/components/KeepAlive.ts` 核心就是上面这套逻辑）；前端接口内存缓存层、图片纹理缓存池 | **Redis `allkeys-lru` 内存淘汰策略**、MySQL InnoDB **Buffer Pool（缓冲池热页管理）**、Nginx 代理缓存淘汰 |

---

> 🔙 **返回主线教程**：[第 11 讲：大型前端架构与状态分层](../01-教程/第11讲-大型前端架构状态分层防腐蚀层与插件内核.md) ｜ [第 16 讲：数据落盘与分布式](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md)  
> 🧪 **亲手验证本概念**：[实验 08：手写 LRU 缓存与异步请求竞态锁](../03-实验/实验08-手写LRU缓存与请求竞态锁.md)  
> 👉 **下一篇概念（A 辑压轴：Vue3 快速 Diff 的秘密武器）**：[概念 10｜最长递增子序列 LIS](./10-最长递增子序列LIS.md)

---
title: 概念 09 · LRU 缓存淘汰算法（哈希表+双向链表）
---

# 概念 09｜LRU 缓存淘汰算法（Least Recently Used）

> **一句话人话定义**：内存空间是寸土寸金的，当缓存盒子装满、又要塞入新数据时，**优先踢掉那个“最久没被任何人访问过的老古董”**，这套家规就叫 **LRU（最近最少使用淘汰算法）**；它的底层并不是什么新奇结构，而是把我们在前面刚学过的 **[哈希表（负责 1 步找人）](./05-哈希表与冲突拉链.md)** 和 **[双向链表（负责按新旧排队、1 步挪位置）](./03-单向链表与双向链表.md)** 合体组装起来的经典杰作！

## 1. 它被什么痛点逼出来的？

无论是前端 Vue 的 `<KeepAlive :max="3">` 缓存用户切换过的页面组件，还是后端 Redis 内存满了自动清理冷数据，一个合格的缓存管家必须同时做到**以下三个动作全部在 1 步之内（`O(1)`）完成**：
1. **查得快（`get`）**：给你一个名字 `"Home"`，1 步拿出缓存的页面组件；
2. **提鲜快（`拧到队头`）**：一旦 `"Home"` 刚刚被用户访问了，它就成了“最新鲜”的红人，必须 1 步把它从原来的排队位置抽出来，挪到“最新鲜”的排头；
3. **淘汰快（`踢掉队尾`）**：一旦缓存满了（比如规定最多存 3 个，现在来了第 4 个），必须 1 步找到那个“最久没被翻牌子”的老家伙，把它踢出内存。

请用前面学过的知识考考自己：**为什么单靠某一种数据结构，绝对做不到这三点？**
- 如果只用 **[数组](./02-数组与连号房间.md)** 或 **[链表](./03-单向链表与双向链表.md)**：虽然能按新旧顺序排队，但想在 1 万个缓存里按名字找到 `"Home"`，得从头挨个翻找（`O(n)`），第 1 条直接不及格！
- 如果只用 **[哈希表](./05-哈希表与冲突拉链.md)**：虽然按名字找 `"Home"` 是 1 步直达（`O(1)`），但哈希表的取余数公式是个搅拌机，里面根本没有先后顺序，缓存满了你根本不知道谁最老，第 2、3 条直接不及格！

怎么破局？
**既然哈希表擅长“1 步找人”，双向链表擅长“排队和 1 步挪位置”，那就让它俩结婚合体！**

---

## 2. 内存格子逐帧慢放：哈希表指路 + 双向链表排队

我们规定缓存盒子的最大容量 `max = 2`（最多只准住 2 个页面），并且规定双向链表**左边靠近 `HEAD` 的是最老的冷门数据，右边靠近 `TAIL` 的是最新鲜的热门数据**。
请顺着下面 3 帧慢放镜头，看一次完整的“入住 ──► 访问提鲜 ──► 满员踢人”全过程：

### 镜头一：依次存入 `"Home"` 和 `"List"`（容量 2/2 刚好满员）

每个页面住进双向链表的一个房间里，同时在顶上的哈希表里登记一张**“页面名 ──► 房间门牌号”**的纸条：

```text
【哈希表 Map（只管 1 步指路：名字 ──► 链表房间门牌号）】
  "Home" ──► 纸条 #101
  "List" ──► 纸条 #205

【双向链表（只管按活跃时间排队：最左边最老，最右边最新）】
  (最老淘汰端)                                                 (最新鲜活跃端)
  [假头 HEAD] ◄══► #101 { key:"Home" } ◄══► #205 { key:"List" } ◄══► [假尾 TAIL]
```

### 镜头二：用户突然访问了 `"Home"`（执行 `get("Home")` ──► 原地抽出并挪到最新端！）

重点来了！本来 `#101 ("Home")` 排在最左边，眼看下次满员就要被踢掉了。但现在用户点开了 `"Home"`！
电脑怎么在 **1 步（`O(1)`）** 内帮 `"Home"` 完成“续命提鲜”？
1. **查哈希表**：拿 `"Home"` 去查哈希表，1 步拿到它的房间门牌号 **`#101`**（根本不用遍历链表！）；
2. **原地摘除**：利用 [概念 03：双向链表](./03-单向链表与双向链表.md) 的两行代码（`#101.prev.next = #101.next` 等），1 步把 `#101` 从左边摘下来；
3. **挂到最新端**：1 步把 `#101` 插到最右边 `#205` 和 `[假尾 TAIL]` 之间！

```text
【get("Home") 提鲜后的双向链表状态】
  (最老淘汰端：变成了 List！)                                  (最新鲜活跃端：Home 成功续命！)
  [假头 HEAD] ◄══► #205 { key:"List" } ◄══► #101 { key:"Home" } ◄══► [假尾 TAIL]
```

### 镜头三：新打开了 `"Detail"`，触发超容淘汰（执行 `set("Detail", ...)`）

现在用户又打开了新页面 `"Detail"`，但容量上限只有 2 个！必须先踢掉 1 个老古董。
需要满世界找谁最老吗？完全不需要！**顺着最左边 `HEAD.next` 一摸，排在最左边的 `#205 ("List")` 铁定就是最久没人碰过的老家伙！**
1. **1 步踢出链表**：把 `HEAD.next` 指向的 `#205` 从链表里摘除；
2. **1 步踢出哈希表**：读取 `#205` 房间里存的 `key: "List"`，执行 `map.delete("List")` 撕掉哈希表里的纸条；*(💡 思考细节：这就是为什么双向链表节点里除了存 `val`，还必须存一份 `key`——因为淘汰最老节点时，你要靠节点里的 `key` 去哈希表里销户！)*
3. **1 步迎进新人**：开新房间 `#309 ("Detail")` 挂到最右边最新鲜的位置，并在哈希表登记 `"Detail" -> #309`！

```text
【set("Detail") 淘汰 #205(List) 后的最终状态】
  哈希表 Map ： "Home" ──► #101  |  "Detail" ──► #309  （"List" 已被彻底销户！）

  双向链表   ： [假头 HEAD] ◄══► #101 { key:"Home" } ◄══► #309 { key:"Detail" } ◄══► [假尾 TAIL]
```

---

## 3. 代码逐行带入走读：手写双向链表版 vs JS `Map` 工业捷径版

### 写法一：手写“哈希表 + 双向链表”完整内核（看清每一根指针的交接）

```js
class HandMadeLRU {
  constructor(capacity = 2) {
    this.cap = capacity
    this.map = new Map() // 哈希表：key -> 双向链表节点门牌号
    // 双向链表首尾假门卫（靠近 head 是最老，靠近 tail 是最新）
    this.head = { prev: null, next: null }
    this.tail = { prev: null, next: null }
    this.head.next = this.tail
    this.tail.prev = this.head
  }

  // 内部小工具 1：把节点从双向链表当前位置原地摘除 O(1)
  _remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
  }

  // 内部小工具 2：把节点挂到最右边（靠近假尾 tail 的最新鲜位置）O(1)
  _appendToNewest(node) {
    const oldLast = this.tail.prev
    oldLast.next = node
    node.prev = oldLast
    node.next = this.tail
    this.tail.prev = node
  }

  get(key) {
    if (!this.map.has(key)) return undefined
    const node = this.map.get(key) // ① 哈希表 1 步找到房间
    this._remove(node)             // ② 从原排队位置摘下
    this._appendToNewest(node)     // ③ 挪到最右边最新鲜位置
    return node.val
  }

  set(key, val) {
    if (this.map.has(key)) {
      const node = this.map.get(key)
      node.val = val
      this._remove(node)
      this._appendToNewest(node)
      return
    }
    // 如果已满员：1 步摘掉最左边的老古董（head.next），并在哈希表里销户
    if (this.map.size >= this.cap) {
      const oldest = this.head.next
      this._remove(oldest)
      this.map.delete(oldest.key) // 靠节点里存的 key 去哈希表销户！
    }
    const newNode = { key, val, prev: null, next: null }
    this._appendToNewest(newNode)
    this.map.set(key, newNode)
  }
}

const lru = new HandMadeLRU(2)
lru.set('Home', '首页'); lru.set('List', '列表')
lru.get('Home')          // 访问 Home 提鲜，此时 List 变成最老
lru.set('Detail', '详情') // 满员！踢掉最老的 List
console.log('List:', lru.get('List'), '| Home:', lru.get('Home')) // undefined | 首页
```

### 写法二：前端工程实战捷径——直接利用 JS `Map` 内置顺序（Vue 3 源码同款）

在 JavaScript 里，ES6 的 `Map` 在 V8 引擎底层 C++ 实现中，**天生就已经是一张“哈希表 + 保持插入顺序的双向链表”**！每次 `delete(key)` 再重新 `set(key, val)`，就会自动把该键挪到链表末尾（最新鲜端），而 `map.keys().next().value` 永远能在 `O(1)` 拿到排在队头最老的那个键：

```js
// Vue 3 <KeepAlive> 源码采用的就是这套极简写法
class FastLRU {
  constructor(max = 2) { this.max = max; this.cache = new Map() }
  get(key) {
    if (!this.cache.has(key)) return undefined
    const val = this.cache.get(key)
    this.cache.delete(key); this.cache.set(key, val) // 先删后插 = 挪到队尾最新端
    return val
  }
  set(key, val) {
    if (this.cache.has(key)) this.cache.delete(key)
    this.cache.set(key, val)
    if (this.cache.size > this.max) {
      this.cache.delete(this.cache.keys().next().value) // 1 步删掉队头最老的 key
    }
  }
}
```

---

## 4. 前后端架构双视角落地

| 场景维度 | 前端架构中的核心体现 | 后端与系统架构中的核心体现 |
| :--- | :--- | :--- |
| **组件与数据缓存** | 1. **Vue 3 `<KeepAlive :max="10">` 组件缓存**：在 `packages/runtime-core/src/components/KeepAlive.ts` 中，Vue 用一个 `Set/Map` 记录缓存组件的 key，每次渲染命中时执行 `keys.delete(key); keys.add(key)` 提鲜，超出 `max` 时调用 `pruneCacheEntry(keys.values().next().value)` 销毁最久未访问的组件实例；<br>2. **前端请求缓存与大图纹理池**：在地图瓦片加载、海量富文本表情包渲染中，用 LRU 限制内存最多只留最近看过的 200 张图片，彻底杜绝前端页面挂机几小时后内存溢出（OOM）崩溃。 | 1. **Redis 内存淘汰策略（`allkeys-lru`）**：当 Redis 内存达到 `maxmemory` 上限时，采用近似 LRU 算法淘汰冷键；<br>2. **MySQL InnoDB Buffer Pool（缓冲池）**：把从硬盘读上来的 16KB 数据页放在内存双向链表中按改进版 LRU（分冷热两段防止全表扫描污染热数据）管理，保证高频访问的数据页永远留在内存里！ |

> 🔙 **返回主线教程**：[第 11 讲：大型前端架构与状态分层](../01-教程/第11讲-大型前端架构状态分层防腐蚀层与插件内核.md) ｜ [第 16 讲：数据落盘与分布式](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md)  
> 🧪 **亲手验证本概念**：[实验 08：手写 LRU 缓存与异步请求竞态锁](../03-实验/实验08-手写LRU缓存与请求竞态锁.md)  
> 👉 **下一篇概念（数据结构与算法压轴：彻底看懂 Vue 3 快速 Diff）**：[概念 10｜最长递增子序列 LIS](./10-最长递增子序列LIS.md)

---
title: 概念 12 · WeakMap 与 Vue3 响应式依赖图
---

# 概念 12｜WeakMap 与 Vue3 响应式依赖图

> **一句话人话定义**：
> - **`WeakMap`（弱引用哈希表）**：一种**“绝不耽误垃圾回收（GC）”**的特殊[哈希表](./05-哈希表与冲突拉链.md)——它手里拿的门牌号纸条是“透明虚线”画的；一旦作为 key 的对象在外面已经没人要了，`WeakMap` 会自动松手，让 GC 把该对象连同字典里的记录一起收走；
> - **Vue 3 响应式依赖图**：用 **`WeakMap（找对象） ──► Map（找属性） ──► Set（存去重更新函数）`** 三层容器，把“哪个组件读取了哪个对象的哪个属性”记成一张零内存泄漏的精准通信录！

## 1. 它们被什么痛点逼出来的？

在刚学完的 [概念 11：闭包与垃圾回收 GC](./11-闭包背包Context与垃圾回收GC.md) 最后，我们提到了一个让所有框架作者头疼的死结：
假设你在写 Vue 3 框架。一个大型单页应用里，用户不断在“首页”、“商品页”、“订单页”之间来回切换，先后创建了 1,000 个响应式对象（比如 `const user = reactive({ name: '张三', age: 28 })`）。

为了让 `user.age = 29` 修改时能自动刷新页面，Vue 必须在全局维护一张大总管名单 `targetMap`，把 `#500 (user对象)` 和它的监听函数登记在册。
但请想一想：
1. **如果这张全局总管名单用的是普通 `Map`（强引用）**：
   当用户切走页面、订单页组件已经卸载销毁了，按理说 `#500 (user对象)` 应该被 GC 当成孤岛回收掉。
   **可是全局的 `targetMap` 是一棵永远活着的全局根（GC Root）！** 普通 `Map` 死死攥着 `#500` 的门牌号纸条不撒手，导致 GC 每次点名都以为 `#500` 还在被使用——用户每切一次页面，内存里就多留下一具永远清不掉的组件僵尸（严重内存泄漏）！
2. **颗粒度问题**：
   同一个 `#500 (user)` 对象里有 `name` 和 `age` 两个属性。组件 A 只用了 `name`，组件 B 用了 `age`（而且组件 B 的模板里写了三次 `user.age`）。怎么做到改 `age` 时**只通知组件 B、绝不打扰组件 A，而且组件 B 只刷新 1 次而不是 3 次**？

---

## 2. 内存格子逐帧慢放：强引用 `Map` vs 弱引用 `WeakMap` + 三层通信录

### 镜头一：普通 `Map`（铁链强引用） vs `WeakMap`（蛛丝弱引用）

在 V8 的垃圾回收器眼里，门牌号纸条分为两种：
- **强引用（Strong Reference，铁链）**：普通变量、`Array`、普通 `Map` 里的纸条。只要还有一根铁链拴着 `#500` 房间，GC 绝对不敢拆房！
- **弱引用（Weak Reference，蛛丝）**：`WeakMap` 的 **键（Key）** 所使用的特殊纸条。GC 巡逻点名时，**直接无视蛛丝**！只要外面没有铁链拴着 `#500` 了，GC 当场把 `#500` 拆掉回收，同时 `WeakMap` 里对应的那一行记录也自动人间蒸发！

```text
【普通 Map：铁链栓死，组件卸载后沦为内存钉子户！】
  组件变量 user = null (外部铁链已断开)
  但全局 Map ────(粗铁链：强引用)────► 堆房间 #500 { name: '张三' }
  结果：GC 顺着全局 Map 摸到了 #500，不敢回收！内存永久泄漏！

══════════════════════════════════════════════════════════════════════════

【WeakMap：蛛丝虚线，外部一断自动销户！】
  组件变量 user = null (外部铁链已断开)
  全局 WeakMap ┈┈(细蛛丝：弱引用)┈┈► 堆房间 #500 { name: '张三' }
  结果：GC 点名时无视蛛丝，发现 #500 没有任何铁链相连 ──► 当场回收 #500，WeakMap 条目自动抹除！
```
*(💡 注意：正因为 `WeakMap` 里的 key 随时可能被 GC 悄悄收走，所以 `WeakMap` 的 key 必须是对象，且不支持遍历 `.keys()` 或查看 `.size`——因为下一毫秒剩几个谁也说不准！)*

---

### 镜头二：Vue 3 响应式三层通信录（`WeakMap -> Map -> Set`）全景解剖

现在我们把 `WeakMap`、[哈希表 `Map`](./05-哈希表与冲突拉链.md) 和去重集合 `Set` 组装起来，看看 Vue 3 是怎么在内存里画出那张精密的订阅通信录的：

```text
【第一层：全局 targetMap (类型：WeakMap)】
  作用：以【响应式对象的房间门牌号】为 Key。组件一卸载，对象自动被 GC 回收！
  │
  ├── Key: #500 (user 对象) ┈┈(弱引用)┈┈► Value: depsMap_500 (一张普通 Map)
  │                                               │
  │     【第二层：depsMap (类型：Map 哈希表)】     │
  │       作用：以对象的【属性名字符串】为 Key，精准区分改的是 name 还是 age！
  │       ├── Key: "name" ──► Value: Set [ effect_组件A ]
  │       └── Key: "age"  ──► Value: Set [ effect_组件A, effect_组件B ]
  │                                        ▲
  │                             【第三层：dep (类型：Set 去重集合)】
  │                               作用：存放读过该属性的更新函数。
  │                               哪怕组件 B 模板里读了 10 次 user.age，Set 天生自动去重，只存 1 份！
  │
  └── Key: #600 (cart 对象) ┈┈(弱引用)┈┈► Value: depsMap_600 ...
```

对照这张图，顺着走一遍读取（`track`）和修改（`trigger`）的全过程：
1. **当组件 B 渲染读取 `user.age` 时（触发 `Proxy get` ──► `track(user, 'age')`）**：
   - 先去第一层 `targetMap` 找 `#500 (user)`；
   - 再去第二层 `depsMap` 找 `"age"`；
   - 把组件 B 的更新函数 `effect_组件B` 塞进第三层 `Set` 里！
2. **当代码执行 `user.age = 29` 时（触发 `Proxy set` ──► `trigger(user, 'age')`）**：
   - 顺着 `targetMap.get(#500) ──► depsMap.get("age")`，精准掏出那个 `Set`；
   - 依次调用 `Set` 里的更新函数（只刷新用了 `age` 的组件，只用了 `name` 的组件纹丝不动！）。

---

## 3. 代码逐行带入走读：30 行手写完整 Vue 3 `reactive + effect` 引擎

```js
const targetMap = new WeakMap() // 第一层：弱引用对象表（防内存泄漏）
let activeEffect = null         // 当前正在运行的组件更新函数

// 1. 依赖收集（读属性时触发）：往三层通信录里登记
function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map())) // 第二层：属性名哈希表
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))              // 第三层：Set 自动去重集合
  dep.add(activeEffect)
}

// 2. 派发更新（改属性时触发）：从三层通信录里精准找出订阅者执行
function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key)
  if (dep) [...dep].forEach(effectFn => effectFn())
}

// 3. 用 Proxy 拦截对象的读和写
function reactive(obj) {
  return new Proxy(obj, {
    get(target, key) { track(target, key); return target[key] },
    set(target, key, val) { target[key] = val; trigger(target, key); return true }
  })
}

function effect(fn) {
  activeEffect = fn
  fn() // 立即执行一次，执行过程中读到的所有属性都会自动触发 get -> track！
  activeEffect = null
}

// 走读测试：
const user = reactive({ name: '张三', age: 28 })
effect(() => {
  // 故意在同一个组件里读两次 user.age，验证 Set 是否自动去重！
  console.log(`渲染卡片：年龄是 ${user.age}，确认年龄 ${user.age}`)
})

user.name = '李四' // 改了没人在乎的 name -> 安安静静，绝不触发打印！
user.age = 29      // 改了有人订阅的 age  -> 精准触发打印 1 次！
```

---

## 4. 前后端架构双视角落地

| 场景维度 | 前端架构中的核心体现 | 后端与系统架构中的核心体现 |
| :--- | :--- | :--- |
| **零泄漏元数据挂载** | 1. **给 DOM 节点或第三方对象偷挂私有缓存**：当你在写一个图表库或指令插件，需要给传入的 DOM 元素 `el` 绑定实例数据，千万别直接写 `el._myPluginData = ...`（会污染 DOM 且易泄漏），而是用 `const instanceMap = new WeakMap(); instanceMap.set(el, data)`——当该 DOM 节点从页面移除被回收时，缓存数据自动销毁！<br>2. **深拷贝循环引用检测**：手写 `deepClone(obj, visited = new WeakMap())` 时，用 `WeakMap` 记录已拷贝过的原对象门牌号，防止 `a.self = a` 死循环爆栈。 | 1. **发布-订阅中心（Pub/Sub）与配置中心路由表**：如 Nacos / Apollo 配置中心内部维护的 `Namespace -> ConfigKey -> ClientSubscriberSet` 三层订阅结构，与 Vue 3 的 `WeakMap -> Map -> Set` 完全同构；<br>2. **JVM `WeakHashMap` 与 `ThreadLocal`**：Java 线程本地变量底层使用弱引用 Entry 防止线程池复用时外部对象无法回收。 |

> 🔙 **返回主线教程**：[第 07 讲：Vue 响应式、编译优化与快速 Diff](../01-教程/第07讲-Vue响应式编译优化与快速Diff.md)  
> 🧪 **亲手验证本概念**：[实验 05：手写 Vue3 响应式与分支依赖清理](../03-实验/实验05-手写Vue3响应式与动态清理.md)  
> 👉 **下一篇概念**：[概念 13｜GPU 合成层与 BFC 布局边界](./13-合成层与BFC布局边界.md)

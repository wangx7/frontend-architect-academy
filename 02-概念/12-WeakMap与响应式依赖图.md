---
title: 概念 12 · WeakMap 与 Vue3 响应式依赖图
---

# 概念 12｜WeakMap 与 Vue3 响应式依赖图

> **一句话人话定义**：
> - **`WeakMap`（弱引用字典）**：一种**“不耽误垃圾回收”**的特殊[哈希表](./05-哈希表与冲突拉链.md)——如果作为 key 的对象在外面已经没人要了，`WeakMap` 会自动松手让 GC 把该对象连同字典里的记录一起收走；
> - **Vue 3 响应式依赖图**：用 **`WeakMap（找对象） -> Map（找属性） -> Set（存去重更新函数）`** 三层容器，把“谁读了哪个对象的哪个属性”记成一张精准通信录！

## 1. 它被什么痛点逼出来的？

在 Vue 3 里，页面上可能有 500 个响应式对象，每个对象有 10 个属性，每个属性被 3 个组件读取。
1. 当你写 `user.age = 29` 时，怎样做到**不通知读了 `user.name` 的组件，只精准通知读了 `user.age` 的那几个组件**？
2. 当某个页面组件被路由切换销毁后，它的响应式对象 `user` 本该被[垃圾回收 GC](./11-闭包背包Context与垃圾回收GC.md) 收走；如果全局依赖表用的是普通 `Map`，普通 `Map` 会死死拽住 `user` 的门牌号不放，导致**每切一次页面就永久泄漏一块内存**！

## 2. 内存门牌号三层嵌套图解

Vue 3 用三层各司其职的容器解决了这两个难题：

```text
全局 targetMap (第一层：WeakMap —— 以【对象门牌号 #500】为 key，组件死后自动松手回收！)
  │
  └──► #500 (user 对象)
         │
         ▼
       depsMap (第二层：哈希表 Map —— 以【属性名字符串】为 key，区分不同字段！)
         ├── "name" ──► Set [ 组件A更新函数 ]
         └── "age"  ──► Set [ 组件A更新函数, 组件B更新函数 ]  (第三层：Set —— 自动去重！)
```

为什么每一层都换不得？
- **第一层必须用 `WeakMap`**：key 是 `#500 (user)` 对象。当组件卸载、外部没有任何变量再持有 `#500` 时，GC 直接回收 `#500`，`targetMap` 里的对应条目也自动消失，**零内存泄漏**！
- **第二层必须用 `Map`**：区分同一个 `#500` 对象上的 `"name"` 和 `"age"` 属性。
- **第三层必须用 `Set`**：如果组件 A 的模板里写了两次 `{{ user.age }}`，渲染时会触发两次读取（`track`）；`Set` 天生不允许重复元素，保证组件 A 的更新函数只登记 **1 次**！

## 3. 25 行极简代码原型：亲手搭起三层响应式订阅表

```js
const targetMap = new WeakMap() // 第一层：弱引用对象表
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map())) // 第二层：属性表
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))              // 第三层：去重集合
  dep.add(activeEffect)
}

function trigger(target, key) {
  const effects = targetMap.get(target)?.get(key)
  if (effects) [...effects].forEach(fn => fn())
}

const rawUser = { name: '张三', age: 28 }
activeEffect = () => console.log('检测到 age 变化:', rawUser.age)
track(rawUser, 'age')
track(rawUser, 'age') // 故意重复收集两次，Set 会自动去重！
activeEffect = null

rawUser.age = 29
trigger(rawUser, 'age') // 只打印 1 次！
```

## 4. 前后端架构双视角落地

| 维度 | 前端架构中的体现 | 后端与系统架构中的体现 |
| :--- | :--- | :--- |
| **核心应用场景** | 1. **Vue 3 `reactivity` 源码核心**；<br>2. 给第三方 DOM 节点或组件对象附加私有缓存元数据（如 `domPrivateDataWeakMap.set(el, meta)`），DOM 移除后缓存自动销毁 | 发布-订阅模式（Pub/Sub）中的主题订阅表（`Topic -> Partition -> ConsumerGroup Set`）、Java `WeakHashMap` 缓存 |

---

> 🔙 **返回主线教程**：[第 07 讲：Vue 响应式、编译优化与快速 Diff](../01-教程/第07讲-Vue响应式编译优化与快速Diff.md)  
> 🧪 **亲手验证本概念**：[实验 05：手写 Vue3 响应式与分支依赖清理](../03-实验/实验05-手写Vue3响应式与动态清理.md)  
> 👉 **下一篇概念**：[概念 13｜GPU 合成层与 BFC 布局边界](./13-合成层与BFC布局边界.md)

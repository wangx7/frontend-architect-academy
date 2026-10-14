---
title: 第 08 讲 · React Fiber 架构与双框架设计权衡
---

# 第 08 讲｜React Fiber 架构与双框架设计权衡

> **本讲在主线的位置**：第二卷收官之作。一个成熟的前端架构师不会停留在“Vue 和 React 谁更好用”的争论上，而是能从**第一层直观模型、第二层真实调度机制、第三层边界与反例**三个层次看清：这两大框架分别在“编译期静态分析 vs 运行时灵活调度”的光谱上做出了怎样的工程取舍。

## 1. 场景与核心问题

在 [第 07 讲](./第07讲-Vue响应式编译优化与快速Diff.md) 里我们看到，Vue 3 通过 **`Proxy` 细粒度响应式订阅 + 模板编译期 `PatchFlags / Block Tree` 靶向标记**，尽量在更新之初就缩小比对范围。
这自然引出了三个架构追问：
1. **为什么 React 默认不在运行时用 `Proxy` 自动追踪每个属性的读取，而是要求显式调用 `setState` 并从当前组件向下重跑子树？**
2. **当一棵包含数千个节点的组件树需要协调（Reconciliation）时，React 15 的函数递归为什么会卡死主线程？React 16+ 的 Fiber 架构又是怎样用链表和 `Scheduler` 优先级调度器实现“时间切片与高优插队”的？**
3. **如果简单把两者概括成“Vue 减少工作，React 让工作可中断”，这个直观模型在什么真实工程场景下会失效？**

---

## 2. 第一层（直观模型）与第二层（真实机制）：从递归调用栈到 Fiber 链表与 Scheduler

### 2.1 根源取舍：受约束的模板（Template）vs 完全自由的 JS 表达式（JSX）

- **Vue 的设计重心（重编译期约定 + 运行时自动追踪）**：`<template>` 是受约束的领域特定语法（DSL），编译器在打包阶段就能静态区分哪些标签是永远不变的静态节点、哪些绑定了动态变量，从而生成 `Block Tree`；配合 `Proxy` 拦截，天然适合做组件级乃至节点级的精确制导更新。
- **React 的设计重心（重运行时语义一致性 + 不可变快照）**：在 React 眼里，`UI = f(state)`，JSX 只是 `React.createElement` 的语法糖，开发者可以在渲染函数里任意使用 `if/else`、`map`、高阶函数甚至动态拼装子组件。这种极致的运行时自由度带来了一个代价：**在不借助额外编译器（如 React Compiler）或手动 `memo` 的默认情况下，当父组件状态变化时，React 无法事先断定子组件是否受影响，默认需要自顶向下重新调用子树渲染函数进行协调（Reconciliation）**。

### 2.2 React 15 的瓶颈：为什么“函数递归遍历树”无法在 5ms 时中途暂停？

如果一棵大型组件树有 3,000 个节点，每个节点的组件函数执行与 Diff 比对耗时 `0.03ms`，整棵树同步递归跑完需要 **`90ms`**。
结合我们在 [第 02 讲](./第02讲-变量和数据住在哪个格子里.md) 和 [第 05 讲](./第05讲-JS单线程与事件循环调度.md) 学过的底层原理：
- 传统的树遍历依赖 **JS 引擎函数调用栈（Call Stack）**（`reconcile(App)` 压栈 ──► `reconcile(Layout)` 压栈 ──► `reconcile(Table)` 压栈……）；
- 在单线程浏览器里，**只要调用栈还没清空，主线程就被死死霸占**，期间用户敲键盘、点按钮或浏览器重绘帧（16.6ms 一帧）全部被阻塞；
- 更致命的是：**你没法在 JS 语言层面把正在执行的 30 层函数调用栈“拍个快照暂停、先退出去让浏览器画一帧、5ms 后再恢复这 30 层调用栈”！**

### 2.3 Fiber 的数据结构破局：把“调用栈隐式记路”变成“堆内存三指针链表显式记路”

既然不能靠引擎的调用栈记路，React 团队干脆把调用栈搬到了堆内存里——利用我们在 👉 **[概念 03：单向链表与双向链表](../02-概念/03-单向链表与双向链表.md)** 学过的门牌号纸条，让每个虚拟节点（**Fiber 节点**）身上显式携带 **三张门牌号纸条**：
1. **`child`（大儿子指针）**：指向第一个子 Fiber 节点；
2. **`sibling`（亲弟弟指针）**：指向下一个兄弟 Fiber 节点；
3. **`return`（父节点指针）**：指回父级 Fiber 节点（之所以叫 `return`，正是因为它替代了原来函数执行完 `return` 返回上一层栈帧的动作！）。

```text
                ┌─── Fiber #100 (App) ───┐
                │ child  : #201          │
                │ sibling: null          │
                │ return : null          │
                └──────┬─────────────────┘
                       │ child (下潜到大儿子)
                       ▼
       ┌─── Fiber #201 (Header) ──┐                  ┌─── Fiber #202 (OrderList) ──┐
       │ child  : null            │  sibling (横移)   │ child  : #301 (Row_1)       │
       │ sibling: #202            ├─────────────────►│ sibling: null               │
       │ return : #100 (指回 App) │                  │ return : #100 (指回 App)    │
       └──────────────────────────┘                  └──────────────┬──────────────┘
                                                                    │ child
                                                                    ▼
                                                     ┌─── Fiber #301 (Row_1) ──────┐
                                                     │ child: null, sibling: null  │
                                                     │ return: #202 (指回OrderList)│
                                                     └─────────────────────────────┘
```

一旦树被连成了这张单向链表网，遍历整棵树就**彻底摆脱了递归调用栈**，变成了只有 1 层函数的 `while (workInProgress !== null)` 循环！
- **想暂停？** 只需把下一个要处理的 Fiber 节点门牌号保存在全局变量 `workInProgress` 里，直接 `return` 退出 `workLoop` 函数，主线程瞬间空闲！
- **想恢复？** 等浏览器处理完高优用户输入或绘制完当前帧后，再次调用 `workLoop`，直接从 `workInProgress` 保存的门牌号继续往下走！

### 2.4 真实机制校准：React `Scheduler` 是怎么实现时间切片的？（为什么不用 `requestIdleCallback`？）

很多入门文章为了简化，会用 `requestIdleCallback` 演示 Fiber 时间切片。但**在 React 真实源码（`packages/scheduler`）中，React 并没有使用 `requestIdleCallback`**，原因有三：
1. **触发时机太不可控**：`requestIdleCallback` 只在浏览器彻底空闲时才触发，在高频滚动或动画期间可能几十毫秒都不执行一次，且不同浏览器兼容性存在差异；
2. **默认切片预算（5ms）**：React `Scheduler` 内部规定每个时间片默认预算为 **`frameInterval = 5ms`**。每处理完一个 Fiber 节点，都会调用 `shouldYieldToHost()` 检查 `performance.now() - startTime >= 5`——一旦满 5ms（或者检测到更高优先级的任务插队），立刻让出主线程；
3. **用 `MessageChannel` 触发下一宏任务切片**：为了在让出主线程后尽快启动下一个 5ms 切片，React 优先使用 **`MessageChannel`（通过 `port.postMessage` 派发 0 延迟宏任务）**，在不支持的环境中才降级为 `setTimeout(fn, 0)`。同时，`Scheduler` 内部用一棵**最小堆（Min-Heap）优先级队列**管理不同紧急程度的任务（对应 React 18 的 **Lane 模型**：如同步输入优先级 `SyncLane` > 过渡更新优先级 `TransitionLane`）。

### 2.5 完整可独立运行代码：带双缓冲与 `MessageChannel` 5ms 切片的迷你 Fiber 引擎

下面这段代码**没有任何未定义变量**，你可以直接复制到 Node.js 或浏览器控制台独立运行，亲眼观察一棵 6 节点 Fiber 树是如何被切成多个 5ms 时间片分段协调、并在最后一次性 Commit 的：

```js
// mini-fiber-scheduler.mjs —— 直接用 node 运行，观察 Fiber 链表遍历、5ms 时间切片中断与双缓冲提交
import { performance } from 'node:perf_hooks'

// 1. 将嵌套虚拟节点树链接为携带 child / sibling / return 三张纸条的 Fiber 链表树
function buildFiberTree(vnode, returnFiber = null) {
  const fiber = {
    type: vnode.type,
    child: null,
    sibling: null,
    return: returnFiber,
    effectTag: 'UPDATE'
  }
  if (vnode.children && vnode.children.length > 0) {
    let prevChild = null
    for (const childVNode of vnode.children) {
      const childFiber = buildFiberTree(childVNode, fiber)
      if (!prevChild) {
        fiber.child = childFiber      // 长子挂在父亲的 child 纸条上
      } else {
        prevChild.sibling = childFiber // 其余孩子依次挂在哥哥的 sibling 纸条上
      }
      prevChild = childFiber
    }
  }
  return fiber
}

// 2. 模拟每个组件耗时 3ms 的协调计算，并顺着 child -> sibling -> return 寻找下一工作单元
function performUnitOfWork(fiber, workLog) {
  const busyUntil = performance.now() + 3 // 模拟该节点计算耗时 3ms
  while (performance.now() < busyUntil) {}
  workLog.push(fiber.type)

  // 深度优先指针寻路：有大儿子走大儿子 -> 没儿子走亲弟弟 -> 没弟弟顺着 return 回溯找叔叔
  if (fiber.child) return fiber.child
  let cur = fiber
  while (cur) {
    if (cur.sibling) return cur.sibling
    cur = cur.return
  }
  return null
}

// 3. 复刻 React Scheduler：基于 MessageChannel 宏任务切片 + 5ms 帧预算让出机制
export function runConcurrentRender(vnodeTree, frameYieldMs = 5) {
  return new Promise(resolve => {
    const workInProgressRoot = buildFiberTree(vnodeTree)
    let workInProgress = workInProgressRoot
    const sliceHistory = []
    let currentSliceNodes = []

    const channel = new MessageChannel()
    channel.port1.onmessage = () => workLoop()

    function workLoop() {
      const sliceStart = performance.now()
      currentSliceNodes = []

      // 只要还有 Fiber 节点未完成，且当前切片耗时未达到 5ms 预算，就继续推进
      while (workInProgress !== null && (performance.now() - sliceStart) < frameYieldMs) {
        workInProgress = performUnitOfWork(workInProgress, currentSliceNodes)
      }
      sliceHistory.push([...currentSliceNodes])

      if (workInProgress !== null) {
        // 时间片耗尽但树尚未协调完：通过 MessageChannel 让出主线程，排队下一宏任务切片！
        channel.port2.postMessage(null)
      } else {
        // Render 阶段全部完成：关闭通道，进入不可中断的 Commit 阶段一次性切换双缓冲指针！
        channel.port1.close()
        resolve({ committedRoot: workInProgressRoot.type, slices: sliceHistory })
      }
    }

    // 启动首个时间片
    channel.port2.postMessage(null)
  })
}

// 构造一棵 6 个节点的组件树运行测试（每个节点耗时 3ms，总计 18ms，按 5ms 预算会被自动切成多片）
const sampleApp = {
  type: 'App',
  children: [
    { type: 'Header', children: [{ type: 'Logo' }] },
    { type: 'Dashboard', children: [{ type: 'Chart' }, { type: 'Table' }] }
  ]
}

runConcurrentRender(sampleApp, 5).then(result => {
  console.log('⚡ 分片协调记录 (每片 <= 5ms 预算):', JSON.stringify(result.slices))
  console.log('✅ 双缓冲 Commit 完成，根节点:', result.committedRoot)
})
```

---

## 3. 第三层（边界与反例）：打破“Vue 省工作 vs React 可中断”的刻板二分法

在初级面试中，把 Vue 和 React 总结为“Vue 靠细粒度响应式减少工作量，React 靠 Fiber 时间切片让大工作量可中断”有助于快速建立宏观印象。但作为架构师，你必须看清这个简化模型背后的**三大边界与反例**：

| 常见简化认知 | 真实工程边界与反例（架构师必须掌握的真相） |
| :--- | :--- |
| **误区 1：“Vue 有细粒度追踪，所以永远不会有长任务卡顿，不需要切片”** | **反例与边界**：<br>1. **大组件树首次挂载（Mount）或路由全量切换**：当页面一次性渲染含 5,000 个复杂单元格的报表时，Vue 同样需要同步创建 VNode、创建真实 DOM 并建立响应式依赖，主线程照样会阻塞上百毫秒；<br>2. **粗粒度状态污染**：如果开发者把一个包含万级节点的巨型数组放进深层 `reactive()` 并整体替换，Vue 的 Diff 和 DOM 操作依然昂贵。此时 Vue 同样需要依靠 **`shallowRef`（浅层响应）**、**`v-memo`（跳过子树比对）** 以及**虚拟滚动（Virtual List）**来控制单帧负载。 |
| **误区 2：“React 每次更新都会傻乎乎重跑整棵子树，只能靠时间切片硬扛”** | **反例与边界**：<br>1. ** Bailout（提前退出剪枝机制）**：在 React 源码的 `beginWork` 中，如果父组件满足 `oldProps === newProps` 且当前 Fiber 没有待处理的更新优先级（`Lanes`），React 会直接调用 `bailoutOnAlreadyFinishedWork` **跳过整棵子树的重渲染**（这也是 `React.memo`、`useMemo` 以及 **React Compiler (React Forget)** 在编译期自动插入记忆化代码的核心目的）；<br>2. **时间切片不是免费的午餐**：时间切片只发生在启用并发特性（如 `startTransition`、`useDeferredValue`）的更新中；普通的同步受控输入默认仍以最高优先级同步执行，且如果是单个函数内部的 100ms 死循环纯计算，Fiber 也无法在单个函数内部腰斩，必须配合 Web Worker。 |
| **误区 3：“时间切片能让总渲染耗时变短”** | **反例与边界**：<br>恰恰相反！因为时间切片需要维护双缓冲 Fiber 树、检查时间戳、通过 `MessageChannel` 跨宏任务切换并可能因为高优任务插队而作废重算低优任务，**它的 CPU 总耗时反而比同步一口气跑完略多一点**。它换取的不是“总耗时变短（Throughput）”，而是**“单次霸占主线程的时间不超过 5ms，保证用户输入与动画响应延迟极低（Responsiveness / INP 指标优秀）”**！ |

---

## 4. 联动概念与动手实验

- 🔍 **本讲关联概念**：
  - 👉 [概念 03｜单向链表与双向链表（Fiber `child / sibling / return` 链表底座）](../02-概念/03-单向链表与双向链表.md)
  - 👉 [概念 04｜栈与队列（理解为什么递归调用栈无法中途挂起恢复）](../02-概念/04-栈与队列.md)
  - 👉 [概念 11｜闭包背包 Context（理解 React Hooks 每次渲染独立闭包快照与陈旧值边界）](../02-概念/11-闭包背包Context与垃圾回收GC.md)
- 🧪 **本讲配套动手沙盒**：
  - 👉 [实验 04｜事件循环宏微任务与时间切片调度器](../03-实验/实验04-事件循环与时间切片.md)

## 5. 思考题与架构决策训练

1. **为什么 React Hooks（如 `useState`、`useEffect`）严禁写在 `if (condition)` 或 `for` 循环里，而 Vue 3 的 `ref()` 理论上在函数任意位置创建都不会弄乱其他变量？** 请从底层数据结构差异回答。
2. **【架构决策场景】假设你要重构公司核心的“实时行情交易工作台”（每秒推送 200 次盘口价格跳动，同屏有 K 线图、深度表与下单面板），如果团队技术栈分别是 Vue 3 或 React 18，你各自会制定哪两条核心性能防线？**

<details>
<summary>💡 点击展开本讲思考题与架构决策参考解析</summary>

1. **Hooks 链表槽位寻址 vs Vue 闭包引用寻址**：
   - React 函数组件每次重渲染都会重新执行整段函数，React 在该组件的 Fiber 节点上挂载了一条无名字 Key 的**单向链表（`fiber.memoizedState`）**，完全靠函数执行时第 1 次、第 2 次、第 3 次调用 Hook 的**先后顺序下标**去认领链表节点。一旦某个 `useState` 放进 `if` 分支被跳过，后续所有 Hook 的链表指针都会错位认领到别人的状态！
   - Vue 3 的 `setup()` 在组件一生中**只执行 1 次**，每个 `ref()` 都是堆内存里一个独立的响应式对象实例，模板或 `computed` 直接通过对象门牌号引用它，因此不依赖每次渲染的调用顺序。
2. **高频行情工作台的双框架架构防线**：
   - **若采用 Vue 3**：① 行情大数组严禁用深层 `reactive()`，强制使用 **`shallowRef` + 批量节流合并（每帧 `requestAnimationFrame` 最多触发 1 次赋值）**，避免每秒成千上万次深层 `Proxy` 依赖触发；② 高频跳动的盘口表格行使用 **`v-memo="[row.price, row.volume]"`** 精准锁死重渲染边界。
   - **若采用 React 18**：① 将高频但非紧急的大盘列表更新包裹在 **`startTransition(() => setMarketList(next))`** 中，降级为可中断的并发过渡任务，确保交易员在下单输入框打字（高优 `SyncLane`）时零卡顿；② 使用细粒度外部状态订阅（`useSyncExternalStore` / Zustand selector）只让订阅了特定股票代码的叶子单元格组件重渲染，或启用 React Compiler 配合虚拟列表阻断整树级联重跑。

</details>

> 👉 **下一讲**：第二卷浏览器与框架内核已经圆满通关！接下来进入 **第三卷：前端工程化与大型架构**，先从每天都在敲却很少有人懂底层的包管理与模块化拓扑开始：**[第 09 讲｜模块化、包管理与 pnpm 硬链接拓扑](./第09讲-模块化包管理与pnpm硬链接拓扑.md)**。

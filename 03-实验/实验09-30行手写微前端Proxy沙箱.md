---
title: 实验 09 · 30 行手写微前端 Proxy 隔离沙箱
---

# 实验 09｜30 行手写微前端 Proxy 隔离沙箱

> 📖 **关联教程**：[第 12 讲：微前端架构：JS 沙箱、样式隔离与模块联邦](../01-教程/第12讲-微前端架构JS沙箱样式隔离与模块联邦.md)  
> 🔍 **关联概念**：[概念 01：内存门牌号与指针引用](../02-概念/01-内存门牌号与指针引用.md)

## 1. 实验目标

用 30 行纯 JS 亲手实现一个支持 **多子应用同时运行互不污染 `globalThis / window`**、且在子应用卸载时**自动清理未清除定时器的完整微前端沙箱**！

## 2. 复制即跑代码

新建 `lab09-sandbox.mjs`，运行 `node lab09-sandbox.mjs`：

```js
// lab09-sandbox.mjs —— 30 行手写带定时器自动回收的微前端 Proxy 沙箱
class MicroAppSandbox {
  constructor(name) {
    this.name = name
    this.active = false
    this.timers = new Set()            // 记录子应用注册的所有定时器 ID，卸载时自动清扫！
    const fakeWindow = Object.create(null)

    this.sandboxWindow = new Proxy(fakeWindow, {
      set: (target, key, val) => {
        if (this.active) target[key] = val
        return true
      },
      get: (target, key) => {
        if (key === 'setInterval') {   // 劫持定时器：登记 ID 防止子应用卸载后残留泄漏！
          return (fn, ms) => {
            const id = setInterval(fn, ms)
            this.timers.add(id)
            return id
          }
        }
        return key in target ? target[key] : globalThis[key]
      }
    })
  }
  mount(codeRunner) {
    this.active = true
    codeRunner(this.sandboxWindow)
  }
  unmount() {
    this.active = false
    for (const id of this.timers) clearInterval(id) // 自动清扫所有残留定时器！
    this.timers.clear()
    console.log(`🧹 [${this.name}] 已卸载并自动清理全部残留定时器`)
  }
}

const app1 = new MicroAppSandbox('CRM子应用')
const app2 = new MicroAppSandbox('ERP子应用')
app1.mount(window => { window.theme = 'dark'; window.setInterval(() => {}, 1000) })
app2.mount(window => { window.theme = 'light' })

console.log('CRM 看到的 theme:', app1.sandboxWindow.theme) // dark
console.log('ERP 看到的 theme:', app2.sandboxWindow.theme) // light
console.log('宿主真实全局 theme:', globalThis.theme)       // undefined
app1.unmount() // 自动清理定时器，进程正常退出不挂起！
```

## 3. 破坏性实验：如果不劫持 `setInterval` 会发生什么？

把上面第 32 行的 `for (const id of this.timers) clearInterval(id)` 注释掉再跑：
你会发现即使调用了 `app1.unmount()`，**你的 Node 终端进程也永远退不出来（一直卡住挂起）**——因为子应用里忘关的 `setInterval` 还在后台永久空转！

## 4. 思考题

1. **微前端框架（如 qiankun）在加载子应用的 JS 字符串后，是怎么让子应用代码里写的全局变量 `window.xxx` 自动指向我们上面造出来的 `sandboxWindow` 的？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

通过将子应用的脚本包裹在 `(function(window, self, globalThis) { with(window) { /* 子应用代码 */ } }).call(sandboxWindow, sandboxWindow, sandboxWindow, sandboxWindow)` 中执行！通过函数参数遮蔽与 `with` 作用域拦截，子应用代码里读写的所有 `window.xxx` 或裸全局变量都会自动落入 `sandboxWindow` 的 `Proxy` 拦截器中。

</details>

---

> 🔙 **返回教程**：[第 12 讲：微前端架构：JS 沙箱、样式隔离与模块联邦](../01-教程/第12讲-微前端架构JS沙箱样式隔离与模块联邦.md) ｜ 👉 **下一个实验**：[实验 10：手写前端错误捕获、白屏与性能探针](./实验10-手写前端错误与性能监控探针.md)

---
title: 实验 06 · 手写 Vue3 快速 Diff 与 LIS 索引算法
---

# 实验 06｜手写 Vue3 快速 Diff 与 LIS 索引算法

> 📖 **关联教程**：[第 07 讲：Vue 响应式、编译优化与快速 Diff](../01-教程/第07讲-Vue响应式编译优化与快速Diff.md)  
> 🔍 **关联概念**：[概念 10：最长递增子序列 LIS（Vue3 Diff 专用）](../02-概念/10-最长递增子序列LIS.md)

## 1. 实验目标

亲手跑通 Vue 3 快速 Diff 的完整三阶段（**① 掐头 → ② 去尾 → ③ 乱序区间求最长递增子序列 LIS**），精确打印出哪些节点原地不动、哪些节点需要移动、哪些节点需要新建挂载。

## 2. 复制即跑代码

新建 `lab06-vue-diff.mjs`，运行 `node lab06-vue-diff.mjs`：

```js
// lab06-vue-diff.mjs —— 亲手跑通 Vue 3 快速 Diff：掐头、去尾、LIS 最小移动决策
function getSequence(arr) {
  const p = arr.slice(), result = [0]
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i]
    if (val === 0) continue
    const last = result[result.length - 1]
    if (arr[last] < val) { p[i] = last; result.push(i); continue }
    let u = 0, v = result.length - 1
    while (u < v) {
      const c = (u + v) >> 1
      if (arr[result[c]] < val) u = c + 1; else v = c
    }
    if (val < arr[result[u]]) { if (u > 0) p[i] = result[u - 1]; result[u] = i }
  }
  let len = result.length, cur = result[len - 1]
  while (len-- > 0) { result[len] = cur; cur = p[cur] }
  return result
}

function quickDiff(oldList, newList) {
  let i = 0, e1 = oldList.length - 1, e2 = newList.length - 1
  // 1. 掐头
  while (i <= e1 && i <= e2 && oldList[i] === newList[i]) {
    console.log(`✅ [头部复用] 节点 ${newList[i]} 原地不动`)
    i++
  }
  // 2. 去尾
  while (i <= e1 && i <= e2 && oldList[e1] === newList[e2]) {
    console.log(`✅ [尾部复用] 节点 ${newList[e2]} 原地不动`)
    e1--; e2--
  }
  // 3. 中间乱序区间用 LIS 找出保持原顺序的最大不动子集
  const oldMiddle = oldList.slice(i, e1 + 1)
  const newMiddle = newList.slice(i, e2 + 1)
  const source = newMiddle.map(key => {
    const oldIdx = oldMiddle.indexOf(key)
    return oldIdx === -1 ? 0 : oldIdx + 1 // 0 代表全新节点
  })
  const lisSet = new Set(getSequence(source))
  newMiddle.forEach((key, idx) => {
    if (source[idx] === 0) console.log(`➕ [新建挂载] 节点 ${key}`)
    else if (lisSet.has(idx)) console.log(`⚓ [LIS稳坐不动] 节点 ${key}`)
    else console.log(`🚚 [移动DOM] 节点 ${key} 需要调用 insertBefore 移动位置`)
  })
}

quickDiff(['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['A', 'B', 'E', 'C', 'D', 'H', 'F', 'G'])
```

## 3. 破坏性实验：如果把新列表完全倒序会怎样？

把最后一行的第二个数组改成完全颠倒的 `['A', 'B', 'E', 'D', 'C', 'F', 'G']` 再跑一次：
你会看到 `source` 变成了递减的 `[3, 2, 1]`，此时最长递增子序列长度只有 1（只有 1 个节点能原地不动，其余 2 个节点必须移动）。

## 4. 思考题

1. **为什么在构建 `source` 映射数组时，旧下标要写成 `oldIdx + 1`（从 1 开始编号），而把 `0` 专门留给新节点？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

因为旧列表的第一个元素下标本身就是 `0`！如果不加 1 偏移，下标为 `0` 的旧节点就会和“代表全新未挂载节点的标记 `0`”撞车混淆。统一加 1 后，`0` 唯一代表全新节点，`>= 1` 代表在旧列表中存在的可复用节点。

</details>

---

> 🔙 **返回教程**：[第 07 讲：Vue 响应式、编译优化与快速 Diff](../01-教程/第07讲-Vue响应式编译优化与快速Diff.md) ｜ 👉 **下一个实验**：[实验 07：手写迷你 AST 代码转换器 (Codemod)](./实验07-手写迷你AST代码转换器.md)

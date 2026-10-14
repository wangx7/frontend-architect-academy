---
title: 概念 14 · AST 抽象语法树与模块依赖图
---

# 概念 14｜AST 抽象语法树与模块依赖图

> **一句话人话定义**：
> - **AST（抽象语法树）**：你写的代码只是一串死板字符串（`"const a = 1 + 2"`），编译器先把它拆成一棵**用普通 JS 对象表示的树状积木**，这样 Babel、Vite、Vue 编译器、ESLint 就能像改普通对象一样自动检查和改写你的代码；
> - **模块依赖图（Module Graph）**：顺着每个文件顶部的 `import` 语句画出的**文件引用关系网**，是打包、按需分包和 Tree Shaking（摇树删死代码）的唯一地图！

## 1. 它们被什么痛点逼出来的？

想想你每天习以为常的四个工程奇迹：
1. 你写了浏览器根本不认识的 `.vue` 模板和 TypeScript 类型，为什么打包后变成了浏览器认识的纯 `.js`？
2. 你在一个工具文件里写了 10 个函数，只 `import` 用了其中 1 个，为什么打包时另外 9 个没用的函数能被自动删掉（Tree Shaking）？
3. 团队要把全项目 500 个文件里的 `console.log(...)` 自动删掉，或者把旧组件 API 自动升级成新 API（Codemod），靠正则表达式替換为什么一遇到嵌套括号就翻车？

因为**正则表达式看不懂代码的嵌套结构**！必须先把代码文本变成一棵结构化的树（**AST**）！

## 2. 从 0 到 1 慢放图：一行代码是怎么变成 AST 树的？

看这行最简单的代码：`const a = 1 + 2`，编译器分三步把它改造成新代码：

```text
【第 1 步：词法切块 Tokenizer（把字符串切成单词积木）】
  "const a = 1 + 2"  ──►  [ 关键字:const, 标识符:a, 符号:=, 数字:1, 符号:+, 数字:2 ]

【第 2 步：语法建树 Parser（按语法规则拼成 AST 对象树）】
  VariableDeclaration (kind: "const")
    └── VariableDeclarator
          ├── id: Identifier (name: "a")
          └── init: BinaryExpression (operator: "+")
                      ├── left:  Literal (value: 1)
                      └── right: Literal (value: 2)

【第 3 步：遍历改造 Transform & 重新生成代码 Codegen】
  顺着这棵树做深度优先遍历（DFS）：比如把 operator "+" 改成 "*"，或把 const 改成 var
    ──► 重新拼回字符串："var a = 1 * 2"！
```

### 模块依赖图（Module Graph）又长什么样？
当 Vite 或 Rollup 从入口 `main.js` 出发，解析每个文件的 AST 找到所有的 `import` 语句，就会在内存里建出一张**有向图**：

```text
main.js ──(import)──► Home.vue ──(import)──► utils.js (導出了 add 和 unusedFn)
   │                                            ▲
   └──────(动态 import())──► Order.vue ─────────┘
```
有了这张图：
- **Tree Shaking（摇树优化）**：顺着图标记谁被真用到了，发现 `utils.js` 里的 `unusedFn` 没有任何箭头指向它，直接从最终产物里剪掉！（这也是为什么必须用静态的 ES Module `import/export`，因为 `require(动态变量)` 在运行前画不出确定的箭头！）。
- **Code Splitting（代码分割）**：发现 `Order.vue` 是通过动态 `import('./Order.vue')` 引入的，直接从那条虚线剪开，单独打包成一个异步按需加载的 `.js` 文件！

## 3. 25 行极简代码原型：亲手写一个迷你 AST 转换器

```js
// 模拟 Babel / Vite 插件的工作原理：解析成 AST -> 遍历修改 AST 节点 -> 重新生成代码
const ast = {
  type: 'VariableDeclaration',
  kind: 'const',
  id: { type: 'Identifier', name: 'price' },
  init: {
    type: 'BinaryExpression',
    operator: '+',
    left: { type: 'Literal', value: 100 },
    right: { type: 'Literal', value: 20 }
  }
}

// 1. 插件转换器：把 const 降级为 var，并预先算出常量加法（编译期常量折叠优化！）
function transformAST(node) {
  if (node.type === 'VariableDeclaration' && node.kind === 'const') {
    node.kind = 'var'
  }
  if (node.init?.type === 'BinaryExpression' && node.init.operator === '+') {
    node.init = { type: 'Literal', value: node.init.left.value + node.init.right.value }
  }
}

// 2. 代码生成器（Codegen）：把 AST 树还原回代码文本
function generateCode(node) {
  return `${node.kind} ${node.id.name} = ${node.init.value};`
}

transformAST(ast)
console.log('编译优化后的代码:', generateCode(ast)) // 输出: var price = 120;
```

## 4. 前后端架构双视角落地

| 维度 | 前端架构中的体现 | 后端与系统架构中的体现 |
| :--- | :--- | :--- |
| **编译与工程化** | Vue 模板编译器（把 `<template>` 转成带 `PatchFlags` 的 `render` 函数）、Babel 语法降级、ESLint 架构边界检查规则、Codemod 大规模自动化重构 | 数据库 SQL 解析器（把 SQL 字符串转成 AST 再生成执行计划）、网关规则表达式引擎 |

---

> 🔙 **返回主线教程**：[第 09 讲：模块化与 pnpm 拓扑](../01-教程/第09讲-模块化包管理与pnpm硬链接拓扑.md) ｜ [第 10 讲：构建引擎原理 Vite、Rollup 与 AST 插件](../01-教程/第10讲-构建引擎原理Vite-Rollup与AST插件.md)  
> 🧪 **亲手验证本概念**：[实验 07：手写迷你 AST 代码转换器 (Codemod)](../03-实验/实验07-手写迷你AST代码转换器.md)  
> 👉 **下一篇概念**：[概念 15｜同源策略、CORS 预检与 CSP](./15-同源策略CORS预检与CSP.md)

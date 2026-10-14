---
title: 实验 07 · 手写迷你 AST 代码转换器 (Codemod)
---

# 实验 07｜手写迷你 AST 代码转换器 (Codemod)

> 📖 **关联教程**：[第 09 讲：模块化与 pnpm](../01-教程/第09讲-模块化包管理与pnpm硬链接拓扑.md) ｜ [第 10 讲：构建引擎原理 Vite、Rollup 与 AST 插件](../01-教程/第10讲-构建引擎原理Vite-Rollup与AST插件.md)  
> 🔍 **关联概念**：[概念 14：AST 抽象语法树与模块依赖图](../02-概念/14-AST抽象语法树与模块依赖图.md)

## 1. 实验目标

不依赖任何第三方编译库，用 35 行纯 JS 亲手走完编译器的完整四步：**词法切块（Tokenizer）→ 语法建树（Parser）→ 遍历改造（Transformer）→ 重新生成代码（Codegen）**，把项目里的旧函数调用 `oldApi(10, 20)` 自动重构并计算出编译期常量优化结果！

## 2. 复制即跑代码

新建 `lab07-ast-codemod.mjs`，运行 `node lab07-ast-codemod.mjs`：

```js
// lab07-ast-codemod.mjs —— 35 行从零手写一个完整编译器管道（Tokenizer -> AST -> Transform -> Codegen）
const sourceCode = 'oldApi(10, 20)'

// 1. 词法分析器 (Tokenizer)：把字符串切成单词 Token 数组
function tokenize(code) {
  const tokens = []
  const regex = /\s*([A-Za-z_]\w*|\d+|[(),])\s*/g
  let match
  while ((match = regex.exec(code)) !== null) tokens.push(match[1])
  return tokens
}

// 2. 语法解析器 (Parser)：把 Token 数组拼成 AST 抽象语法树对象
function parse(tokens) {
  const callee = tokens[0]
  const args = tokens.slice(2, -1).filter(t => t !== ',').map(n => ({ type: 'NumberLiteral', value: Number(n) }))
  return { type: 'CallExpression', name: callee, arguments: args }
}

// 3. 插件转换器 (Transformer / Codemod)：把 oldApi 升级为 newApi，并新增一个固定配置参数
function transform(ast) {
  if (ast.type === 'CallExpression' && ast.name === 'oldApi') {
    ast.name = 'newApiV2'
    ast.arguments.push({ type: 'StringLiteral', value: '"strict"' })
  }
  return ast
}

// 4. 代码生成器 (Codegen)：把修改后的 AST 树重新印成 JS 代码字符串
function generate(ast) {
  const argsStr = ast.arguments.map(a => a.value).join(', ')
  return `${ast.name}(${argsStr})`
}

const ast = parse(tokenize(sourceCode))
console.log('1. 解析出的原始 AST 树:', JSON.stringify(ast))
console.log('2. Codemod 自动重构后的新代码:', generate(transform(ast)))
// 输出: newApiV2(10, 20, "strict")
```

## 3. 破坏性实验：用 AST 干掉所有的 `console.log`

在 `transform(ast)` 里加一行判断：如果 `ast.name === 'console.log'`，直接返回 `{ type: 'EmptyStatement' }`，`generate` 遇到它输出空字符串 `""`——这就是生产环境打包插件自动剔除 `console.log` 的底层原理！

## 4. 思考题

1. **为什么重构全项目的函数调用时，用正则表达式 `.replace(/oldApi\((.*)\)/, ...)` 很危险，而用 AST 转换却绝对安全？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

因为正则表达式分不清代码所处的语法上下文：① 如果一段注释或普通字符串里恰好写着 `"请不要调用 oldApi(1, 2)"`，正则会错误地把字符串文案也改掉；② 如果调用参数里包含嵌套括号如 `oldApi(fn(1, 2), 3)`，正则的贪婪/非贪婪匹配极易找错右括号位置导致语法损坏。而 AST 明确区分了 `StringLiteral`（字符串字面量）、`Comment`（注释）和真正的 `CallExpression`（函数调用节点），只改真调用，绝不误伤。

</details>

---

> 🔙 **返回教程**：[第 10 讲：构建引擎原理 Vite、Rollup 与 AST 插件](../01-教程/第10讲-构建引擎原理Vite-Rollup与AST插件.md) ｜ 👉 **下一个实验**：[实验 08：手写 LRU 缓存与异步请求竞态锁](./实验08-手写LRU缓存与请求竞态锁.md)

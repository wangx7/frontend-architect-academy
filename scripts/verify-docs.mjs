#!/usr/bin/env node
/**
 * scripts/verify-docs.mjs
 * 全站教学文档自动化校验门禁：
 * 1. 检查所有 Markdown 内部相对链接与根路径链接是否 100% 存在；
 * 2. 检查 .vitepress/config.mts 导航与侧边栏配置中的所有链接是否有效；
 * 3. 检查每个 Markdown 文件的代码围栏（```）闭合状态与一级标题（# ）唯一性；
 * 4. 提取全站所有 JavaScript (```js / ```javascript) 代码块并调用 `node --check` 校验语法正确性。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const IGNORE_DIRS = new Set(['node_modules', '.git', '.vitepress', 'dist', 'labs', 'scripts', 'public'])

function collectMarkdownFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        collectMarkdownFiles(path.join(dir, entry.name), list)
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      list.push(path.join(dir, entry.name))
    }
  }
  return list.sort()
}

const mdFiles = collectMarkdownFiles(ROOT)
const errors = []
let checkedLinks = 0
let checkedJsBlocks = 0

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-academy-verify-'))

for (const filePath of mdFiles) {
  const relPath = path.relative(ROOT, filePath)
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  // 1. Check code fences & H1 count
  let inFence = false
  let h1Count = 0
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
    } else if (!inFence && line.startsWith('# ')) {
      h1Count++
    }
  }
  if (inFence) {
    errors.push(`[未闭合代码块] ${relPath}`)
  }
  if (relPath !== 'index.md' && h1Count !== 1) {
    errors.push(`[H1标题数量异常(${h1Count})] ${relPath}`)
  }

  // Check repeated numeric sub-section numbering outside fenced code blocks.
  const seenHeadingNumbers = new Set()
  let inHeadingFence = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inHeadingFence = !inHeadingFence
      continue
    }
    if (inHeadingFence) continue
    const numberedHeading = line.match(/^(#{2,6})\\s+((?:\\d+\\.)+\\d+)\\s+/)
    if (!numberedHeading) continue
    const key = `${numberedHeading[1].length}:${numberedHeading[2]}`
    if (seenHeadingNumbers.has(key)) {
      errors.push(`[重复小节编号 ${numberedHeading[2]}] ${relPath}: ${line}`)
    }
    seenHeadingNumbers.add(key)
  }

  // 2. Check internal Markdown links
  const withoutCode = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '')
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  while ((match = linkRegex.exec(withoutCode)) !== null) {
    const rawHref = match[2].split('#')[0].trim()
    if (!rawHref || rawHref.startsWith('http://') || rawHref.startsWith('https://') || rawHref.startsWith('mailto:')) {
      continue
    }
    checkedLinks++
    const resolvedBase = rawHref.startsWith('/')
      ? path.join(ROOT, rawHref.replace(/^\/+/, ''))
      : path.resolve(path.dirname(filePath), rawHref)

    let targetMd = resolvedBase
    if (rawHref.endsWith('/')) {
      targetMd = path.join(resolvedBase, 'index.md')
    } else if (!targetMd.endsWith('.md')) {
      if (fs.existsSync(targetMd + '.md')) {
        targetMd = targetMd + '.md'
      } else if (fs.existsSync(targetMd) && fs.statSync(targetMd).isDirectory()) {
        targetMd = path.join(targetMd, 'index.md')
      } else {
        targetMd = targetMd + '.md'
      }
    }

    if (!fs.existsSync(targetMd)) {
      errors.push(`[死链] ${relPath} 中的链接 ${match[0]} -> 找不到目标文件 ${path.relative(ROOT, targetMd)}`)
    }
  }

  // 3. Syntax-check JS code blocks via `node --check`
  const jsBlockRegex = /```(?:js|javascript)\r?\n([\s\S]*?)```/g
  let blockIdx = 0
  while ((match = jsBlockRegex.exec(content)) !== null) {
    blockIdx++
    checkedJsBlocks++
    const code = match[1]
    const tmpFile = path.join(tmpDir, `block-${checkedJsBlocks}.mjs`)
    fs.writeFileSync(tmpFile, code, 'utf8')
    const checkRes = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' })
    if (checkRes.status !== 0) {
      errors.push(`[JS代码块语法错误] ${relPath} (第 ${blockIdx} 个代码块):\n${checkRes.stderr}`)
    }
  }
}

// 4. Check .vitepress/config.mts links
const configPath = path.join(ROOT, '.vitepress', 'config.mts')
if (fs.existsSync(configPath)) {
  const cfgContent = fs.readFileSync(configPath, 'utf8')
  const cfgLinkRegex = /link:\s*['"]([^'"]+)['"]/g
  let m
  while ((m = cfgLinkRegex.exec(cfgContent)) !== null) {
    const link = m[1]
    if (link.startsWith('http://') || link.startsWith('https://')) continue
    checkedLinks++
    const target = link.endsWith('/')
      ? path.join(ROOT, link.replace(/^\/+/, ''), 'index.md')
      : path.join(ROOT, link.replace(/^\/+/, '') + '.md')
    if (!fs.existsSync(target)) {
      errors.push(`[VitePress配置死链] .vitepress/config.mts -> ${link} (找不到 ${path.relative(ROOT, target)})`)
    }
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`✅ 文档自动化扫描完成：`)
console.log(`   - 扫描 Markdown 文档总数 : ${mdFiles.length} 篇`)
console.log(`   - 校验内部超链接与导航数 : ${checkedLinks} 处`)
console.log(`   - 校验 JS 代码块语法总数 : ${checkedJsBlocks} 个`)

if (errors.length > 0) {
  console.error(`\n❌ 发现 ${errors.length} 处错误：`)
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  process.exit(1)
} else {
  console.log(`   - 发现错误数量           : 0 处 🎉\n`)
}

/**
 * Minimal cooperative Fiber-like scheduler for teaching and tests.
 *
 * It demonstrates:
 * - child/sibling/return traversal;
 * - yielding between non-preemptible work units;
 * - keeping current and work-in-progress tree references separate;
 * - switching the current tree reference after all work is complete.
 *
 * It is not React's implementation: there are no Lanes, cancellation,
 * reconciliation, DOM mutations, or real React Commit effects.
 */
import { performance } from 'node:perf_hooks'
import { MessageChannel } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'

function buildFiberTree(vnode, returnFiber = null) {
  const fiber = {
    type: vnode.type,
    child: null,
    sibling: null,
    return: returnFiber
  }
  let previousChild = null
  for (const childVNode of vnode.children ?? []) {
    const childFiber = buildFiberTree(childVNode, fiber)
    if (previousChild) previousChild.sibling = childFiber
    else fiber.child = childFiber
    previousChild = childFiber
  }
  return fiber
}

function cloneFiberTree(source, returnFiber = null) {
  const clone = {
    type: source.type,
    child: null,
    sibling: null,
    return: returnFiber
  }
  let previousChild = null
  for (let child = source.child; child; child = child.sibling) {
    const childClone = cloneFiberTree(child, clone)
    if (previousChild) previousChild.sibling = childClone
    else clone.child = childClone
    previousChild = childClone
  }
  return clone
}

function performUnitOfWork(fiber, visited, unitWorkMs) {
  const finishAt = performance.now() + unitWorkMs
  while (performance.now() < finishAt) {
    // Simulate a non-preemptible unit of CPU work.
  }
  visited.push(fiber.type)

  if (fiber.child) return fiber.child
  let current = fiber
  while (current) {
    if (current.sibling) return current.sibling
    current = current.return
  }
  return null
}

/**
 * @param {{type:string, children?:Array<object>}} vnodeTree
 * @param {{frameYieldMs?:number, unitWorkMs?:number}} options
 */
export function runConcurrentRender(vnodeTree, options = {}) {
  const frameYieldMs = Math.max(1, Number(options.frameYieldMs ?? 5))
  const unitWorkMs = Math.max(0, Number(options.unitWorkMs ?? 3))

  return new Promise((resolve, reject) => {
    let currentRoot = buildFiberTree(vnodeTree)
    const workInProgressRoot = cloneFiberTree(currentRoot)
    let workInProgress = workInProgressRoot
    const visited = []
    const slices = []
    const sliceDurationsMs = []
    const channel = new MessageChannel()
    let finished = false

    const finish = (error, result) => {
      if (finished) return
      finished = true
      channel.port1.close()
      channel.port2.close()
      if (error) reject(error)
      else resolve(result)
    }

    const scheduleNextSlice = () => channel.port2.postMessage('continue')

    const workLoop = () => {
      try {
        const start = performance.now()
        const currentSlice = []

        // Check time between units; an already-running unit cannot be preempted.
        while (workInProgress !== null && performance.now() - start < frameYieldMs) {
          workInProgress = performUnitOfWork(workInProgress, currentSlice, unitWorkMs)
        }

        slices.push(currentSlice)
        visited.push(...currentSlice)
        sliceDurationsMs.push(Number((performance.now() - start).toFixed(3)))

        if (workInProgress !== null) {
          scheduleNextSlice()
          return
        }

        // Teaching-model Commit: swap the current tree reference after render work finishes.
        currentRoot = workInProgressRoot
        finish(null, {
          committed: true,
          treeSwapped: currentRoot === workInProgressRoot,
          committedRoot: currentRoot.type,
          slices,
          sliceDurationsMs,
          visited
        })
      } catch (error) {
        finish(error)
      }
    }

    channel.port1.on('message', workLoop)
    scheduleNextSlice()
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sampleApp = {
    type: 'App',
    children: [
      { type: 'Header', children: [{ type: 'Logo' }] },
      { type: 'Dashboard', children: [{ type: 'Chart' }, { type: 'Table' }] }
    ]
  }

  runConcurrentRender(sampleApp).then(result => {
    console.log('每个任务片处理的节点：', JSON.stringify(result.slices))
    console.log('每片实测耗时(ms)：', JSON.stringify(result.sliceDurationsMs))
    console.log('提交状态：', result.committed ? '完成（切换树引用）' : '未完成')
  }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

/**
 * xterm.js 输入补丁（IME 丢字符 + Option 组合键 dead-key 泄漏）
 *
 * 本文件打两个补丁，都通过替换 xterm 内部 _inputEvent 实现：
 *
 * === 补丁 1：IME keyCode=229 丢字符 ===
 * 问题：macOS 下任何"活动 IME"（系统拼音、豆包、搜狗等）的英文模式，WKWebView 会对
 * 所有 keydown 报告 keyCode=229，且把 insertText 事件的 composed 标记为 true。
 * xterm.js 的 _inputEvent 用 `(!e.composed || !this._keyDownSeen)` 做 gate，
 * 在 composed=true 且 _keyDownSeen=true 时丢弃字符，导致快速输入时随机字符丢失
 * （如 docker 的 r、grep 的 e、mysql 的 s）。
 * 上游 issue（截至 2026-07 仍 Open，官方零回应）：
 * https://github.com/xtermjs/xterm.js/issues/5887
 *
 * === 补丁 2：Option 组合键 dead-key 字符泄漏进 PTY ===
 * 问题：macOptionIsMeta 下 Option+字母（如 Option+H=˙）会被 macOS 字符化成 dead-key
 * 字符，经 textarea 的 beforeinput（insertText）写进 PTY。attachCustomKeyEventHandler
 * 返回 false 只能让 _keyDown 提前退出，但 _keyDown 的提前退出反而让 _unprocessedDeadKey
 * 没机会被置位（customKeyEventHandler 的 return 在 _unprocessedDeadKey=!0 之前），
 * 于是随后的 _inputEvent 不受 dead-key gate 保护，照常把字符送进 PTY。
 * 上游 issue #2831 至今 Open，6.0.0 最新版未修：
 * https://github.com/xtermjs/xterm.js/issues/2831
 *
 * 修复策略：在替换后的 _inputEvent 里独立跟踪「上一个 keydown 是否为 dead-key」。
 * 若上一个 keydown 的 e.key === 'Dead'（或 altKey，覆盖 macOptionIsMeta 下 Option 组合），
 * 则紧随其后的 insertText 视为 dead-key 字符化结果，拦截不送 PTY。
 * 真实 IME 组合期间 inputType 是 insertCompositionText（不是 insertText），不受影响。
 *
 * 注意：依赖 xterm 内部 _core API（非公开），xterm 升级时需重新适配。
 * applyXtermImePatch 内含结构守卫，检测到 _core 或 _inputEvent 不存在时静默跳过，
 * 避免升级后崩溃。
 */
import type { Terminal as XTerm } from '@xterm/xterm'

let patchWarned = false

export function applyXtermImePatch(terminal: XTerm): void {
  // 通过非公开 API 拿到内部 CoreBrowserTerminal 实例
  const core = (terminal as unknown as { _core?: any })._core
  if (!core) {
    if (!patchWarned) {
      console.warn('[xtermImePatch] terminal._core 不可访问，xterm 版本可能已变更，跳过 IME 补丁')
      patchWarned = true
    }
    return
  }

  const originalInputEvent = core._inputEvent
  if (typeof originalInputEvent !== 'function') {
    if (!patchWarned) {
      console.warn('[xtermImePatch] _inputEvent 不存在或非函数，跳过 IME 补丁')
      patchWarned = true
    }
    return
  }

  // 独立跟踪上一个 keydown 是否为 dead-key 来源。
  // 监听 textarea 的 keydown（capture，早于 xterm 内部处理）记录状态，
  // 供 _inputEvent 判断「这个 insertText 是不是 dead-key 字符化结果」。
  const textarea = terminal.textarea
  let lastKeyWasDeadKey = false
  if (textarea) {
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      // 仅在 macOptionIsMeta 开启时跟踪 Option 组合键：此模式下 Option 当 Meta 用，
      // 系统字符化出的 dead-key（如 ˙）是泄漏，该拦。
      // macOptionIsMeta 关闭时 Option 是第三层 shift（输入 © € 等特殊字符），不该拦。
      const opts = (core as any).optionsService?.rawOptions
      if (opts?.macOptionIsMeta && e.altKey && e.key !== 'Alt' && !e.ctrlKey && !e.metaKey) {
        lastKeyWasDeadKey = true
      } else if (e.key === 'Dead') {
        lastKeyWasDeadKey = true
      } else {
        lastKeyWasDeadKey = false
      }
    }, true)
  }

  core._inputEvent = function (e: InputEvent): boolean {
    if (
      e.data &&
      e.inputType === 'insertText' &&
      !(this as any).optionsService.rawOptions.screenReaderMode
    ) {
      // 补丁 2：拦截 Option 组合键 / Dead 键产生的 dead-key 字符，不送 PTY。
      // 真实 IME 组合走 insertCompositionText，不会进到这里。
      if (lastKeyWasDeadKey) {
        lastKeyWasDeadKey = false
        ;(this as any).cancel(e)
        return true
      }
      // 补丁 1：对 insertText 类型事件，忽略 composed 与 _keyDownSeen gate。
      if ((this as any)._keyPressHandled) return false
      ;(this as any)._unprocessedDeadKey = false
      const text = e.data
      ;(this as any).coreService.triggerDataEvent(text, true)
      ;(this as any).cancel(e)
      return true
    }
    // 其他情况（insertCompositionText、deleteContentBackward 等）走原实现，
    // 保持 dead-key、composition 等逻辑
    return originalInputEvent.call(this, e)
  }
}

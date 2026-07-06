/**
 * xterm.js IME keyCode=229 丢字符补丁
 *
 * 问题：macOS 下任何"活动 IME"（系统拼音、豆包、搜狗等）的英文模式，WKWebView 会对
 * 所有 keydown 报告 keyCode=229，且把 insertText 事件的 composed 标记为 true。
 * xterm.js 的 _inputEvent 用 `(!e.composed || !this._keyDownSeen)` 做 gate，
 * 在 composed=true 且 _keyDownSeen=true 时丢弃字符，导致快速输入时随机字符丢失
 * （如 docker 的 r、grep 的 e、mysql 的 s）。
 *
 * 上游 issue（截至 2026-07 仍 Open，官方零回应）：
 * https://github.com/xtermjs/xterm.js/issues/5887
 *
 * 修复策略（issue 报告者验证可行的 monkey-patch）：
 * 对 insertText 类型的 input 事件，完全忽略 composed 与 _keyDownSeen gate，
 * 只靠 inputType 判断。真实 IME 组合期间 inputType 是 insertCompositionText
 * 而非 insertText，天然不会进入此分支，因此不影响中文输入。
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

  // 替换 _inputEvent：对 insertText 类型事件，忽略 composed 与 _keyDownSeen gate。
  // 真实 IME 组合期间 inputType 是 insertCompositionText（不是 insertText），
  // 不会进入此分支，因此中文输入不受影响。
  core._inputEvent = function (e: InputEvent): boolean {
    if (
      e.data &&
      e.inputType === 'insertText' &&
      !(this as any).optionsService.rawOptions.screenReaderMode
    ) {
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

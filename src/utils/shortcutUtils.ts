/**
 * 匹配快捷键
 * @param event 键盘事件
 * @param shortcut 快捷键字符串，如 "Ctrl+Shift+F"
 * @param strict 严格模式：未声明的修饰键必须未按下（用于 attachCustomKeyEventHandler，防止误拦截普通按键）
 */
export function matchShortcut(
  event: KeyboardEvent,
  shortcut: string,
  strict: boolean = false
): boolean {
  if (!shortcut) return false

  const parts = shortcut.toUpperCase().split('+')
  const modifiers = ['CTRL', 'CMD', 'SHIFT', 'ALT', 'META']
  const hasModifiers = parts.some(p => modifiers.includes(p))

  const hasCtrl = parts.includes('CTRL')
  const hasCmd = parts.includes('CMD')
  const hasShift = parts.includes('SHIFT')
  const hasAlt = parts.includes('ALT')
  const hasMeta = parts.includes('META')
  const keyPart = parts.find(p => !modifiers.includes(p))

  let ctrlMatch: boolean
  let cmdMatch: boolean
  let shiftMatch: boolean
  let altMatch: boolean
  let metaMatch: boolean

  if (strict) {
    ctrlMatch = hasCtrl ? event.ctrlKey : !event.ctrlKey
    cmdMatch = hasCmd ? event.metaKey : !event.metaKey
    shiftMatch = hasShift ? event.shiftKey : !event.shiftKey
    altMatch = hasAlt ? event.altKey : !event.altKey
    metaMatch = hasMeta ? event.metaKey : (hasCmd ? true : !event.metaKey)
  } else {
    ctrlMatch = hasCtrl ? event.ctrlKey : (!hasModifiers ? !event.ctrlKey : true)
    cmdMatch = hasCmd ? event.metaKey : (!hasModifiers ? !event.metaKey : true)
    shiftMatch = hasShift ? event.shiftKey : (!hasModifiers ? !event.shiftKey : true)
    altMatch = hasAlt ? event.altKey : (!hasModifiers ? !event.altKey : true)
    metaMatch = hasMeta ? event.metaKey : (hasCmd ? true : (!hasModifiers ? !event.metaKey : true))
  }

  let keyMatch = false
  if (keyPart) {
    const eventKey = event.key.toUpperCase()
    const eventCode = event.code.toUpperCase()

    keyMatch = eventKey === keyPart ||
      eventCode === 'KEY' + keyPart ||
      eventCode === keyPart ||
      (keyPart === 'ENTER' && (eventKey === 'ENTER' || eventCode === 'ENTER')) ||
      ((keyPart === 'ARROWRIGHT' || keyPart === 'RIGHT') && (eventKey === 'ARROWRIGHT' || eventCode === 'ARROWRIGHT')) ||
      ((keyPart === 'ARROWLEFT' || keyPart === 'LEFT') && (eventKey === 'ARROWLEFT' || eventCode === 'ARROWLEFT')) ||
      ((keyPart === 'ARROWUP' || keyPart === 'UP') && (eventKey === 'ARROWUP' || eventCode === 'ARROWUP')) ||
      ((keyPart === 'ARROWDOWN' || keyPart === 'DOWN') && (eventKey === 'ARROWDOWN' || eventCode === 'ARROWDOWN')) ||
      (keyPart === 'SPACE' && (eventKey === ' ' || eventCode === 'SPACE')) ||
      (keyPart === 'TAB' && (eventKey === 'TAB' || eventCode === 'TAB')) ||
      (keyPart === 'ESCAPE' && (eventKey === 'ESCAPE' || eventCode === 'ESCAPE')) ||
      (keyPart === 'BACKSPACE' && (eventKey === 'BACKSPACE' || eventCode === 'BACKSPACE')) ||
      (keyPart === 'DELETE' && (eventKey === 'DELETE' || eventCode === 'DELETE')) ||
      (keyPart === 'F1' && eventCode === 'F1') ||
      (keyPart === 'F2' && eventCode === 'F2') ||
      (keyPart === 'F3' && eventCode === 'F3') ||
      (keyPart === 'F4' && eventCode === 'F4') ||
      (keyPart === 'F5' && eventCode === 'F5') ||
      (keyPart === 'F6' && eventCode === 'F6') ||
      (keyPart === 'F7' && eventCode === 'F7') ||
      (keyPart === 'F8' && eventCode === 'F8') ||
      (keyPart === 'F9' && eventCode === 'F9') ||
      (keyPart === 'F10' && eventCode === 'F10') ||
      (keyPart === 'F11' && eventCode === 'F11') ||
      (keyPart === 'F12' && eventCode === 'F12')
  }

  return ctrlMatch && cmdMatch && shiftMatch && altMatch && metaMatch && keyMatch
}

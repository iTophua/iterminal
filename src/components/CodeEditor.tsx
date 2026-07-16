import { useEffect, useRef, useMemo } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, foldGutter, indentUnit } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete'
import {
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  dropCursor,
} from '@codemirror/view'
import { lintGutter } from '@codemirror/lint'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'

// 语言包
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { php } from '@codemirror/lang-php'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { toml } from '@codemirror/legacy-modes/mode/toml'

// 主题
import { oneDark } from '@codemirror/theme-one-dark'
import { useThemeStore } from '../stores/themeStore'

export interface CodeEditorHandle {
  view: EditorView | null
}

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  /** 文件名或扩展名，用于自动选择语法高亮 */
  language?: string
  readOnly?: boolean
  /** Cmd/Ctrl+S 回调 */
  onSave?: () => void
  style?: React.CSSProperties
}

/** 根据文件扩展名返回 CodeMirror 语言扩展 */
function getLanguageExtension(filename?: string): Extension[] {
  if (!filename) return []
  const ext = filename.includes('.')
    ? filename.split('.').pop()!.toLowerCase()
    : filename.toLowerCase()

  // StreamLanguage 封装的遗留模式
  const legacyMap: Record<string, () => Extension> = {
    sh: () => StreamLanguage.define(shell),
    bash: () => StreamLanguage.define(shell),
    zsh: () => StreamLanguage.define(shell),
    dockerfile: () => StreamLanguage.define(dockerFile),
    ini: () => StreamLanguage.define(properties),
    conf: () => StreamLanguage.define(properties),
    cfg: () => StreamLanguage.define(properties),
    properties: () => StreamLanguage.define(properties),
    env: () => StreamLanguage.define(properties),
    nginx: () => StreamLanguage.define(nginx),
    diff: () => StreamLanguage.define(diff),
    patch: () => StreamLanguage.define(diff),
    toml: () => StreamLanguage.define(toml),
  }

  // 原生语言包
  switch (ext) {
    case 'json':
      return [json()]
    case 'yaml':
    case 'yml':
      return [yaml()]
    case 'html':
    case 'htm':
    case 'xml':
    case 'svg':
      return ext === 'xml' || ext === 'svg' ? [xml()] : [html()]
    case 'css':
    case 'scss':
    case 'less':
      return [css()]
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: true })]
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })]
    case 'py':
      return [python()]
    case 'sql':
      return [sql()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'php':
      return [php()]
    case 'java':
      return [java()]
    case 'rs':
      return [rust()]
    case 'go':
      return [go()]
    default:
      if (legacyMap[ext]) return [legacyMap[ext]() ]
      return []
  }
}

/** 亮色主题：用项目 CSS 变量 */
const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-bg-container)',
    color: 'var(--color-text)',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-content': {
    caretColor: 'var(--color-primary)',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-bg-container)',
    color: 'var(--color-text-quaternary)',
    border: 'none',
    borderRight: '1px solid var(--color-border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-fill, rgba(128,128,128,0.06))',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-fill, rgba(128,128,128,0.06))',
    color: 'var(--color-text-secondary)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-primary)',
    opacity: '0.15',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-primary)',
    opacity: '0.2',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-primary)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--color-fill, rgba(128,128,128,0.15))',
    outline: '1px solid var(--color-border)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255, 213, 0, 0.3)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255, 165, 0, 0.5)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--color-fill, rgba(128,128,128,0.1))',
    border: 'none',
    color: 'var(--color-text-tertiary)',
  },
})

export default function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  onSave,
  style,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 用 ref 存最新的 onChange/onSave，避免重建 editor
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const appTheme = useThemeStore(s => s.appTheme)
  const isDark = appTheme === 'dark'

  const langExtensions = useMemo(() => getLanguageExtension(language), [language])

  // 自定义快捷键：Cmd/Ctrl+S 保存
  // 用 ref 读最新 onSave，keymap 只建一次避免 editor 重建
  const saveKeymap = useMemo(() => {
    return [
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current?.()
            return true
          },
        },
      ]),
    ]
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      highlightSpecialChars(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...langExtensions,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      // 更新监听：内容变化时回调
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString())
        }
      }),
      // 快捷键
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
      ]),
      ...saveKeymap,
      history(),
      lintGutter(),
    ]

    // 主题
    if (isDark) {
      extensions.push(oneDark)
    } else {
      extensions.push(lightTheme)
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只在 language/readOnly/isDark 变化时重建 editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, isDark, langExtensions, saveKeymap])

  // 外部 value 变化时同步到 editor（避免光标跳动：只在内容真正不同时更新）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentValue = view.state.doc.toString()
    if (currentValue !== value) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      })
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        ...style,
      }}
    />
  )
}

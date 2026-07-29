import { useEffect, useRef, useState, useMemo } from 'react'
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
import { oneDark } from '@codemirror/theme-one-dark'
import { useThemeStore } from '../stores/themeStore'

// 语言包按需加载：启动时不 import 任何语言包，打开文件时按扩展名动态 import。
// 这样 vite 会把每个语言包拆成独立 chunk，降低 WebContent 空闲内存。
type LangLoader = () => Promise<Extension[]>
const langCache = new Map<string, Extension[]>()

// legacy 模式（StreamLanguage 封装）：每个模式显式 import，便于 vite 拆分 chunk
async function legacyLoad(mode: string): Promise<Extension[]> {
  const [{ StreamLanguage }, mod] = await Promise.all([
    import('@codemirror/language'),
    (async () => {
      switch (mode) {
        case 'shell': return (await import('@codemirror/legacy-modes/mode/shell')).shell
        case 'dockerFile': return (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile
        case 'properties': return (await import('@codemirror/legacy-modes/mode/properties')).properties
        case 'nginx': return (await import('@codemirror/legacy-modes/mode/nginx')).nginx
        case 'diff': return (await import('@codemirror/legacy-modes/mode/diff')).diff
        case 'toml': return (await import('@codemirror/legacy-modes/mode/toml')).toml
        default: return null
      }
    })(),
  ])
  if (!mod) return []
  return [StreamLanguage.define(mod as any)]
}

// 扩展名 → 动态加载函数 的映射表
const LANG_LOADERS: Record<string, LangLoader> = {
  // 原生语言包
  json: async () => [await import('@codemirror/lang-json').then(m => m.json())],
  yaml: async () => [await import('@codemirror/lang-yaml').then(m => m.yaml())],
  yml: async () => [await import('@codemirror/lang-yaml').then(m => m.yaml())],
  html: async () => [await import('@codemirror/lang-html').then(m => m.html())],
  htm: async () => [await import('@codemirror/lang-html').then(m => m.html())],
  css: async () => [await import('@codemirror/lang-css').then(m => m.css())],
  scss: async () => [await import('@codemirror/lang-css').then(m => m.css())],
  less: async () => [await import('@codemirror/lang-css').then(m => m.css())],
  js: async () => [await import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true }))],
  jsx: async () => [await import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true }))],
  mjs: async () => [await import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true }))],
  cjs: async () => [await import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true }))],
  ts: async () => [await import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true }))],
  tsx: async () => [await import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true }))],
  py: async () => [await import('@codemirror/lang-python').then(m => m.python())],
  sql: async () => [await import('@codemirror/lang-sql').then(m => m.sql())],
  md: async () => [await import('@codemirror/lang-markdown').then(m => m.markdown())],
  markdown: async () => [await import('@codemirror/lang-markdown').then(m => m.markdown())],
  php: async () => [await import('@codemirror/lang-php').then(m => m.php())],
  java: async () => [await import('@codemirror/lang-java').then(m => m.java())],
  rs: async () => [await import('@codemirror/lang-rust').then(m => m.rust())],
  go: async () => [await import('@codemirror/lang-go').then(m => m.go())],
  xml: async () => [await import('@codemirror/lang-xml').then(m => m.xml())],
  svg: async () => [await import('@codemirror/lang-xml').then(m => m.xml())],
  // legacy 模式（StreamLanguage 封装）
  sh: async () => legacyLoad('shell'),
  bash: async () => legacyLoad('shell'),
  zsh: async () => legacyLoad('shell'),
  dockerfile: async () => legacyLoad('dockerFile'),
  ini: async () => legacyLoad('properties'),
  conf: async () => legacyLoad('properties'),
  cfg: async () => legacyLoad('properties'),
  properties: async () => legacyLoad('properties'),
  env: async () => legacyLoad('properties'),
  nginx: async () => legacyLoad('nginx'),
  diff: async () => legacyLoad('diff'),
  patch: async () => legacyLoad('diff'),
  toml: async () => legacyLoad('toml'),
}

/** 根据文件名异步加载对应的 CodeMirror 语言扩展（带缓存） */
async function loadLanguageExtension(filename?: string): Promise<Extension[]> {
  if (!filename) return []
  const ext = filename.includes('.')
    ? filename.split('.').pop()!.toLowerCase()
    : filename.toLowerCase()
  if (langCache.has(ext)) return langCache.get(ext)!
  const loader = LANG_LOADERS[ext]
  if (!loader) return []
  const result = await loader()
  langCache.set(ext, result)
  return result
}

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

  // 语言扩展异步加载：打开文件时按扩展名动态 import 对应语言包（首次 <50ms，带缓存）
  const [langExtensions, setLangExtensions] = useState<Extension[]>([])
  useEffect(() => {
    let cancelled = false
    loadLanguageExtension(language).then(exts => {
      if (!cancelled) setLangExtensions(exts)
    })
    return () => { cancelled = true }
  }, [language])

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

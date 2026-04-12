import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { initDatabase, migrateFromLocalStorage, getConnections } from '../services/database'
import { useTerminalStore } from '../stores/terminalStore'
import { useTransferStore } from '../stores/transferStore'
import { setupNightlyCleanup } from '../utils/transferCleanup'
import type { InitStep } from '../components/SplashScreen'

interface InitializationState {
  steps: InitStep[]
  progress: number
  displayProgress: number
  isComplete: boolean
  hasError: boolean
}

const DEFAULT_STEPS: InitStep[] = [
  { key: 'database', label: '初始化数据库', status: 'pending' },
  { key: 'fonts', label: '加载系统字体', status: 'pending' },
  { key: 'migrate', label: '迁移历史数据', status: 'pending' },
  { key: 'loadConnections', label: '加载连接列表', status: 'pending' },
  { key: 'cleanup', label: '清理过期记录', status: 'pending' },
]

const DEFAULT_FONTS = ['Menlo', 'Monaco', 'Courier New', 'Consolas', 'SF Mono']

// 最小展示时间（毫秒），确保用户能感受到启动过程
const MIN_DISPLAY_TIME = 1800

export function useAppInitialization() {
  const [state, setState] = useState<InitializationState>({
    steps: DEFAULT_STEPS,
    progress: 0,
    displayProgress: 0, // 用于平滑动画的显示进度
    isComplete: false,
    hasError: false,
  })
  const startTimeRef = useRef(Date.now())
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const setAvailableFonts = useTerminalStore(s => s.setAvailableFonts)
  const setFontsLoading = useTerminalStore(s => s.setFontsLoading)
  const setAllConnections = useTerminalStore(s => s.setAllConnections)
  const setConnectionsLoading = useTerminalStore(s => s.setConnectionsLoading)

  const updateStep = useCallback((key: string, status: InitStep['status']) => {
    setState(prev => ({
      ...prev,
      steps: prev.steps.map(step =>
        step.key === key ? { ...step, status } : step
      ),
    }))
  }, [])

  const updateProgress = useCallback((progress: number) => {
    setState(prev => ({ ...prev, progress }))
  }, [])

  // 平滑进度条动画 - 从当前显示进度渐变到目标进度
  const animateDisplayProgress = useCallback((targetProgress: number) => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)

    progressTimerRef.current = setInterval(() => {
      setState(prev => {
        const diff = targetProgress - prev.displayProgress
        if (Math.abs(diff) < 0.5) {
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          return { ...prev, displayProgress: targetProgress }
        }
        return { ...prev, displayProgress: prev.displayProgress + diff * 0.15 }
      })
    }, 16) as unknown as ReturnType<typeof setInterval>
  }, [])

  useEffect(() => {
    let cancelled = false

    const runInitialization = async () => {
      const totalSteps = DEFAULT_STEPS.length
      let completedSteps = 0
      startTimeRef.current = Date.now()

      // 初始动画 - 从 0 平滑到 5%
      animateDisplayProgress(5)

      if (cancelled) return
      updateStep('database', 'loading')
      updateProgress(10)
      animateDisplayProgress(15)

      try {
        await initDatabase()
        if (cancelled) return
        updateStep('database', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } catch (error) {
        console.error('Database initialization failed:', error)
        updateStep('database', 'error')
        setState(prev => ({ ...prev, hasError: true }))
        return
      }

      if (cancelled) return
      updateStep('fonts', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      setFontsLoading(true)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        let fontsLoaded = false
        const cached = localStorage.getItem('iterminal_cached_fonts')
        if (cached) {
          try {
            const fonts = JSON.parse(cached)
            if (Array.isArray(fonts) && fonts.length > 0) {
              setAvailableFonts(fonts)
              updateStep('fonts', 'done')
              completedSteps++
              updateProgress((completedSteps / totalSteps) * 100)
              animateDisplayProgress((completedSteps / totalSteps) * 100)
              fontsLoaded = true
            }
          } catch {}
        }

        if (!fontsLoaded) {
          const fonts = await invoke<string[]>('get_monospace_fonts')
          if (cancelled) return
          if (fonts.length > 0) {
            setAvailableFonts(fonts)
            localStorage.setItem('iterminal_cached_fonts', JSON.stringify(fonts))
          } else {
            setAvailableFonts(DEFAULT_FONTS)
          }
          updateStep('fonts', 'done')
          completedSteps++
          updateProgress((completedSteps / totalSteps) * 100)
          animateDisplayProgress((completedSteps / totalSteps) * 100)
        }
      } catch (error) {
        console.error('Font loading failed:', error)
        setAvailableFonts(DEFAULT_FONTS)
        updateStep('fonts', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } finally {
        setFontsLoading(false)
      }

      if (cancelled) return
      updateStep('migrate', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        const migratedCount = await migrateFromLocalStorage()
        if (cancelled) return
        if (migratedCount > 0) {
          console.log(`Migrated ${migratedCount} connections from localStorage`)
        }
        updateStep('migrate', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } catch (error) {
        console.error('Migration failed:', error)
        updateStep('migrate', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      }

      if (cancelled) return
      updateStep('loadConnections', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      setConnectionsLoading(true)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        const connections = await getConnections()
        if (cancelled) return
        setAllConnections(connections)
        updateStep('loadConnections', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } catch (error) {
        console.error('Load connections failed:', error)
        setAllConnections([])
        updateStep('loadConnections', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      }

      if (cancelled) return
      updateStep('cleanup', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        useTransferStore.getState().cleanupExpiredRecords()
        setupNightlyCleanup()
        if (cancelled) return
        updateStep('cleanup', 'done')
        completedSteps++
        updateProgress(100)
        animateDisplayProgress(100)
      } catch (error) {
        console.error('Cleanup failed:', error)
        updateStep('cleanup', 'done')
        completedSteps++
        updateProgress(100)
        animateDisplayProgress(100)
      }

      if (!cancelled) {
        // 确保最小展示时间
        const elapsed = Date.now() - startTimeRef.current
        const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsed)

        setTimeout(() => {
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          setState(prev => ({ ...prev, isComplete: true, displayProgress: 100 }))
        }, 200 + remainingTime)
      }
    }

    runInitialization()

    return () => {
      cancelled = true
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [updateStep, updateProgress, setAvailableFonts, setFontsLoading, setAllConnections, setConnectionsLoading, animateDisplayProgress])

  return state
}
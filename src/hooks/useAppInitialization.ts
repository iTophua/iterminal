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
    displayProgress: 0,
    isComplete: false,
    hasError: false,
  })
  const startTimeRef = useRef(Date.now())
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  const setAvailableFonts = useTerminalStore(s => s.setAvailableFonts)
  const setFontsLoading = useTerminalStore(s => s.setFontsLoading)
  const setAllConnections = useTerminalStore(s => s.setAllConnections)
  const setConnectionsLoading = useTerminalStore(s => s.setConnectionsLoading)

  const updateStep = useCallback((key: string, status: InitStep['status']) => {
    if (cancelledRef.current) return
    setState(prev => ({
      ...prev,
      steps: prev.steps.map(step =>
        step.key === key ? { ...step, status } : step
      ),
    }))
  }, [])

  const updateProgress = useCallback((progress: number) => {
    if (cancelledRef.current) return
    setState(prev => ({ ...prev, progress }))
  }, [])

  // 平滑进度条动画 - 从当前显示进度渐变到目标进度
  const animateDisplayProgress = useCallback((targetProgress: number) => {
    if (cancelledRef.current) return
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)

    progressTimerRef.current = setInterval(() => {
      if (cancelledRef.current) {
        if (progressTimerRef.current) clearInterval(progressTimerRef.current)
        return
      }
      setState(prev => {
        if (cancelledRef.current) return prev
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
    cancelledRef.current = false

    const runInitialization = async () => {
      const totalSteps = DEFAULT_STEPS.length
      let completedSteps = 0
      startTimeRef.current = Date.now()

      // 初始动画 - 从 0 平滑到 5%
      animateDisplayProgress(5)

      if (cancelledRef.current) return
      updateStep('database', 'loading')
      updateProgress(10)
      animateDisplayProgress(15)

      try {
        await initDatabase()
        if (cancelledRef.current) return
        updateStep('database', 'done')
      } catch (error) {
        console.error('Database initialization failed:', error)
        updateStep('database', 'error')
        if (!cancelledRef.current) {
          setState(prev => ({ ...prev, hasError: true }))
        }
        // 数据库初始化失败，后续步骤均依赖数据库，直接结束
        const elapsed = Date.now() - startTimeRef.current
        const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsed)
        setTimeout(() => {
          if (cancelledRef.current) return
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          setState(prev => ({ ...prev, isComplete: true, displayProgress: 100 }))
        }, remainingTime)
        return
      }
      completedSteps++
      updateProgress((completedSteps / totalSteps) * 100)
      animateDisplayProgress((completedSteps / totalSteps) * 100)

      if (cancelledRef.current) return
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
          if (cancelledRef.current) return
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
        updateStep('fonts', 'error')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } finally {
        setFontsLoading(false)
      }

      if (cancelledRef.current) return
      updateStep('migrate', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        const migratedCount = await migrateFromLocalStorage()
        if (cancelledRef.current) return
        if (migratedCount > 0) {
          console.log(`Migrated ${migratedCount} connections from localStorage`)
        }
        updateStep('migrate', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } catch (error) {
        console.error('Migration failed:', error)
        updateStep('migrate', 'error')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      }

      if (cancelledRef.current) return
      updateStep('loadConnections', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      setConnectionsLoading(true)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        const connections = await getConnections()
        if (cancelledRef.current) return
        setAllConnections(connections)
        updateStep('loadConnections', 'done')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } catch (error) {
        console.error('Load connections failed:', error)
        setAllConnections([])
        updateStep('loadConnections', 'error')
        completedSteps++
        updateProgress((completedSteps / totalSteps) * 100)
        animateDisplayProgress((completedSteps / totalSteps) * 100)
      } finally {
        setConnectionsLoading(false)
      }

      if (cancelledRef.current) return
      updateStep('cleanup', 'loading')
      updateProgress(completedSteps / totalSteps * 100 + 10)
      animateDisplayProgress(completedSteps / totalSteps * 100 + 15)

      try {
        useTransferStore.getState().cleanupExpiredRecords()
        setupNightlyCleanup()
        if (cancelledRef.current) return
        updateStep('cleanup', 'done')
        completedSteps++
        updateProgress(100)
        animateDisplayProgress(100)
      } catch (error) {
        console.error('Cleanup failed:', error)
        updateStep('cleanup', 'error')
        completedSteps++
        updateProgress(100)
        animateDisplayProgress(100)
      }

      if (!cancelledRef.current) {
        // 确保最小展示时间
        const elapsed = Date.now() - startTimeRef.current
        const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsed)

        setTimeout(() => {
          if (cancelledRef.current) return
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          setState(prev => ({ ...prev, isComplete: true, displayProgress: 100 }))
        }, 200 + remainingTime)
      }
    }

    runInitialization()

    return () => {
      cancelledRef.current = true
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [updateStep, updateProgress, setAvailableFonts, setFontsLoading, setAllConnections, setConnectionsLoading, animateDisplayProgress])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (cancelledRef.current) return
      setState(prev => {
        if (prev.isComplete) return prev
        console.warn('[Init] Initialization timeout, forcing completion')
        cancelledRef.current = true
        return { ...prev, isComplete: true, displayProgress: 100, hasError: true }
      })
    }, 15000)
    return () => clearTimeout(timer)
  }, [])

  return state
}

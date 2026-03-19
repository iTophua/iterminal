/**
 * 文件管理工具函数
 */

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 判断是否为压缩文件
 */
export function isCompressedFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  return (
    lowerName.endsWith('.tar.gz') ||
    lowerName.endsWith('.tgz') ||
    lowerName.endsWith('.tar.bz2') ||
    lowerName.endsWith('.tbz2') ||
    lowerName.endsWith('.tar.xz') ||
    lowerName.endsWith('.txz') ||
    lowerName.endsWith('.tar') ||
    lowerName.endsWith('.zip') ||
    lowerName.endsWith('.gz') ||
    lowerName.endsWith('.bz2') ||
    lowerName.endsWith('.xz')
  )
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return ''
  return fileName.substring(lastDot + 1).toLowerCase()
}

/**
 * 获取父目录路径
 */
export function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return path.substring(0, lastSlash)
}

/**
 * 获取文件名
 */
export function getFileName(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return path.substring(lastSlash + 1)
}

/**
 * 拼接路径
 */
export function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/, '')
      }
      return part.replace(/^\/+|\/+$/g, '')
    })
    .filter(Boolean)
    .join('/')
}

/**
 * 生成唯一任务 ID
 */
export function generateTaskId(): string {
  return Date.now().toString() + Math.random().toString(36).substring(2, 11)
}
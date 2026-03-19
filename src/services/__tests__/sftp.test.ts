import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockInvoke } from '../../test/setup'
import {
  readFileContent,
  writeFileContent,
  listDirectory,
  fileExists,
  formatSize,
  extractFile,
  FileContent,
} from '../sftp'

describe('sftp service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readFileContent', () => {
    it('should call read_file_content with default max size', async () => {
      const mockContent: FileContent = {
        content: 'test content',
        size: 12,
        truncated: false,
        encoding: 'text',
      }
      mockInvoke.mockResolvedValueOnce(mockContent)

      const result = await readFileContent('conn-1', '/path/to/file.txt')

      expect(mockInvoke).toHaveBeenCalledWith('read_file_content', {
        connectionId: 'conn-1',
        path: '/path/to/file.txt',
        maxSize: 1024 * 1024,
      })
      expect(result).toEqual(mockContent)
    })

    it('should call read_file_content with custom max size', async () => {
      const mockContent: FileContent = {
        content: 'large content',
        size: 10_000_000,
        truncated: true,
        encoding: 'text',
      }
      mockInvoke.mockResolvedValueOnce(mockContent)

      const result = await readFileContent('conn-1', '/path/to/large.txt', 10 * 1024 * 1024)

      expect(mockInvoke).toHaveBeenCalledWith('read_file_content', {
        connectionId: 'conn-1',
        path: '/path/to/large.txt',
        maxSize: 10 * 1024 * 1024,
      })
      expect(result.truncated).toBe(true)
    })

    it('should handle binary files', async () => {
      const mockContent: FileContent = {
        content: '00 01 02 03',
        size: 100,
        truncated: false,
        encoding: 'binary',
      }
      mockInvoke.mockResolvedValueOnce(mockContent)

      const result = await readFileContent('conn-1', '/path/to/binary.bin')

      expect(result.encoding).toBe('binary')
    })
  })

  describe('writeFileContent', () => {
    it('should call write_file_content', async () => {
      mockInvoke.mockResolvedValueOnce(true)

      const result = await writeFileContent('conn-1', '/path/to/file.txt', 'new content')

      expect(mockInvoke).toHaveBeenCalledWith('write_file_content', {
        connectionId: 'conn-1',
        path: '/path/to/file.txt',
        content: 'new content',
      })
      expect(result).toBe(true)
    })
  })

  describe('listDirectory', () => {
    it('should return list of files', async () => {
      const mockFiles = [
        {
          name: 'file1.txt',
          path: '/home/user/file1.txt',
          is_directory: false,
          size: 1024,
          modified: '2024-01-01',
          permissions: '644',
        },
        {
          name: 'folder1',
          path: '/home/user/folder1',
          is_directory: true,
          size: 0,
          modified: '2024-01-02',
          permissions: '755',
        },
      ]
      mockInvoke.mockResolvedValueOnce(mockFiles)

      const result = await listDirectory('conn-1', '/home/user')

      expect(mockInvoke).toHaveBeenCalledWith('list_directory', {
        connectionId: 'conn-1',
        path: '/home/user',
      })
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('file1.txt')
      expect(result[1].is_directory).toBe(true)
    })
  })

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      mockInvoke.mockResolvedValueOnce(true)

      const result = await fileExists('conn-1', '/path/to/file.txt')

      expect(mockInvoke).toHaveBeenCalledWith('file_exists', {
        connectionId: 'conn-1',
        path: '/path/to/file.txt',
      })
      expect(result).toBe(true)
    })

    it('should return false when file does not exist', async () => {
      mockInvoke.mockResolvedValueOnce(false)

      const result = await fileExists('conn-1', '/nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('formatSize', () => {
    it('should format bytes', () => {
      expect(formatSize(512)).toBe('512 B')
    })

    it('should format kilobytes', () => {
      expect(formatSize(1024)).toBe('1 KB')
      expect(formatSize(1536)).toBe('1.5 KB')
    })

    it('should format megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1 MB')
      expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
    })

    it('should format gigabytes', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('should return dash for zero', () => {
      expect(formatSize(0)).toBe('-')
    })

    it('should handle large files', () => {
      const tb = 1024 * 1024 * 1024 * 1024
      expect(formatSize(tb)).toBe('1 TB')
      expect(formatSize(2.5 * tb)).toBe('2.5 TB')
    })
  })

  describe('searchFiles', () => {
    it('should call search_files command', async () => {
      const mockResults = [
        { name: 'test.txt', path: '/home/user/test.txt', is_directory: false, size: 100, modified: '2024-01-01' },
        { name: 'testdir', path: '/home/user/testdir', is_directory: true, size: 0, modified: '2024-01-02' },
      ]
      mockInvoke.mockResolvedValueOnce(mockResults)

      const { searchFiles } = await import('../sftp')
      const result = await searchFiles('conn-1', '/home/user', 'test')

      expect(mockInvoke).toHaveBeenCalledWith('search_files', {
        connectionId: 'conn-1',
        path: '/home/user',
        pattern: 'test',
        maxResults: 100,
      })
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('test.txt')
      expect(result[1].is_directory).toBe(true)
    })

    it('should use custom max results', async () => {
      mockInvoke.mockResolvedValueOnce([])

      const { searchFiles } = await import('../sftp')
      await searchFiles('conn-1', '/home', 'query', 50)

      expect(mockInvoke).toHaveBeenCalledWith('search_files', {
        connectionId: 'conn-1',
        path: '/home',
        pattern: 'query',
        maxResults: 50,
      })
    })
  })

  describe('extractFile', () => {
    it('should call extract_file command', async () => {
      mockInvoke.mockResolvedValueOnce(true)

      const result = await extractFile('conn-1', '/home/user/archive.tar.gz', '/home/user')

      expect(mockInvoke).toHaveBeenCalledWith('extract_file', {
        connectionId: 'conn-1',
        filePath: '/home/user/archive.tar.gz',
        targetDir: '/home/user',
      })
      expect(result).toBe(true)
    })

    it('should handle different archive formats', async () => {
      mockInvoke.mockResolvedValueOnce(true)

      await extractFile('conn-1', '/home/user/data.zip', '/home/user/output')

      expect(mockInvoke).toHaveBeenCalledWith('extract_file', {
        connectionId: 'conn-1',
        filePath: '/home/user/data.zip',
        targetDir: '/home/user/output',
      })
    })
  })
})
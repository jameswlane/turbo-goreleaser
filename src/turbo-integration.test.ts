import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { TurboIntegration } from './turbo-integration'
import type { Package } from './types'

// Mock dependencies
vi.mock('@actions/core')
vi.mock('@actions/exec')
vi.mock('node:fs/promises')
vi.mock('node:path')

const mockedCore = vi.mocked(core)
const mockedExec = vi.mocked(exec)
const mockedFs = vi.mocked(fs)
const mockedPath = vi.mocked(path)

describe('TurboIntegration', () => {
  let turboIntegration: TurboIntegration

  beforeEach(() => {
    vi.clearAllMocks()
    turboIntegration = new TurboIntegration({ workingDirectory: '/workspace' })
  })

  describe('constructor', () => {
    it('should initialize with working directory', () => {
      expect(turboIntegration).toBeInstanceOf(TurboIntegration)
    })
  })

  describe('getChangedPackages', () => {
    it('should return packages based on release type', async () => {
      // Mock the internal methods for a basic test
      const mockPackages: Package[] = [
        {
          name: '@myorg/app',
          path: 'apps/myapp',
          version: '1.0.0'
        }
      ]

      // Mock turbo.json exists
      mockedFs.access.mockResolvedValue(undefined)
      // Mock package discovery
      mockedFs.stat.mockResolvedValue({ isDirectory: () => true } as any)
      mockedFs.readdir.mockResolvedValue([{ name: 'myapp', isDirectory: () => true }] as any)
      mockedFs.readFile.mockResolvedValue(JSON.stringify({ name: '@myorg/app', version: '1.0.0' }))

      // Mock turbo command
      mockedExec.exec.mockResolvedValue(0)

      const result = await turboIntegration.getChangedPackages('all')

      expect(result).toEqual([])
    })
  })
})

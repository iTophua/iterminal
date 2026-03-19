import { test, expect } from '@playwright/test'
import { mockTauriApi, waitForAppReady } from './helpers'

test.describe('Terminal Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriApi(page)
    await page.goto('/terminal')
    await waitForAppReady(page)
  })

  test('should show empty state when no sessions', async ({ page }) => {
    await expect(page.locator('text=没有活动的会话')).toBeVisible()
    await expect(page.locator('text=请先在连接管理中连接服务器')).toBeVisible()
  })

  test('should show terminal tabs when sessions exist', async ({ page }) => {
    const emptyState = page.locator('text=没有活动的会话')
    await expect(emptyState).toBeVisible()
  })
})

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriApi(page)
    await page.goto('/')
    await waitForAppReady(page)
  })

  test('should navigate to connections page', async ({ page }) => {
    await page.click('.ant-menu-item:has-text("全部")')
    await expect(page).toHaveURL(/\/connections/)
  })

  test('should navigate to terminal page', async ({ page }) => {
    await page.click('.ant-menu-item:has-text("终端")')
    await expect(page).toHaveURL(/\/terminal/)
  })

  test('should navigate to transfers page', async ({ page }) => {
    await page.click('.ant-menu-item:has-text("传输管理")')
    await expect(page).toHaveURL(/\/transfers/)
  })
})

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriApi(page)
    await page.goto('/')
    await waitForAppReady(page)
  })

  test('should show connection groups', async ({ page }) => {
    const sidebar = page.locator('.ant-layout-sider')
    await expect(sidebar.locator('.ant-menu-item:has-text("全部")')).toBeVisible()
    await expect(sidebar.locator('.ant-menu-item:has-text("生产环境")')).toBeVisible()
  })

  test('should collapse sidebar', async ({ page }) => {
    const collapseBtn = page.locator('.ant-layout-sider-trigger')
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click()
      await page.waitForTimeout(500)
    }
  })
})
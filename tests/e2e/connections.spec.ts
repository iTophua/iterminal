import { test, expect } from '@playwright/test'
import { mockTauriApi, waitForAppReady } from './helpers'

test.describe('Connections Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriApi(page)
    await page.goto('/connections')
    await waitForAppReady(page)
  })

  test('should display connection list', async ({ page }) => {
    await expect(page.locator('text=Test Server 1')).toBeVisible()
    await expect(page.locator('text=Test Server 2')).toBeVisible()
  })

  test('should filter connections by search', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="搜索连接..."]')
    await searchInput.fill('Server 1')
    
    await expect(page.locator('text=Test Server 1')).toBeVisible()
    await expect(page.locator('text=Test Server 2')).not.toBeVisible()
  })

  test('should open add connection modal', async ({ page }) => {
    await page.click('text=新建连接')
    
    await expect(page.locator('.ant-modal')).toBeVisible()
    await expect(page.locator('.ant-modal input[id="name"]')).toBeVisible()
    await expect(page.locator('.ant-modal input[id="host"]')).toBeVisible()
  })

  test('should create new connection', async ({ page }) => {
    await page.click('text=新建连接')
    await page.waitForSelector('.ant-modal', { state: 'visible' })
    
    await page.fill('.ant-modal input[id="name"]', 'New Server')
    await page.fill('.ant-modal input[id="host"]', '10.0.0.1')
    await page.fill('.ant-modal input[id="username"]', 'admin')
    await page.fill('.ant-modal input[id="password"]', 'secret123')
    
    await page.click('.ant-modal .ant-btn-primary')
    
    await expect(page.locator('.ant-card:has-text("New Server")')).toBeVisible({ timeout: 5000 })
  })

  test('should open edit modal', async ({ page }) => {
    await page.hover('text=Test Server 1')
    await page.click('button:has-text("编辑")')
    
    await expect(page.locator('.ant-modal')).toBeVisible()
    await expect(page.locator('.ant-modal input[id="name"]')).toHaveValue('Test Server 1')
  })

  test('should delete connection with confirmation', async ({ page }) => {
    await page.hover('text=Test Server 1')
    await page.click('button:has-text("删除")')
    
    await expect(page.locator('.ant-modal-confirm')).toBeVisible()
    await page.click('.ant-modal-confirm .ant-btn-dangerous')
    
    await expect(page.locator('text=Test Server 1')).not.toBeVisible({ timeout: 5000 })
  })

  test('should open quick import modal', async ({ page }) => {
    await page.click('text=快速导入')
    
    await expect(page.locator('.ant-modal')).toBeVisible()
    await expect(page.locator('.ant-modal textarea')).toBeVisible()
  })

  test('should show connection group tags', async ({ page }) => {
    const card = page.locator('.ant-card:has-text("Test Server 1")')
    await expect(card.locator('text=Production')).toBeVisible()
    await expect(card.locator('text=web')).toBeVisible()
  })
})

test.describe('Connections Page Layout', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauriApi(page)
    await page.goto('/connections')
    await waitForAppReady(page)
  })

  test('should have proper card grid layout', async ({ page }) => {
    const cards = page.locator('.ant-card')
    await expect(cards).toHaveCount(2)
    
    const firstCard = cards.first()
    const box = await firstCard.boundingBox()
    expect(box?.width).toBeGreaterThan(300)
  })

  test('should show sidebar', async ({ page }) => {
    const sidebar = page.locator('.ant-layout-sider')
    await expect(sidebar).toBeVisible()
  })

  test('should have action buttons in header', async ({ page }) => {
    await expect(page.locator('button:has-text("新建连接")')).toBeVisible()
    await expect(page.locator('button:has-text("快速导入")')).toBeVisible()
    await expect(page.locator('button:has-text("导出")')).toBeVisible()
  })
})
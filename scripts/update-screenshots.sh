#!/bin/bash
# 截图上传和 README 更新脚本
# 使用方法: ./scripts/update-screenshots.sh screenshot1.png screenshot2.png screenshot3.png screenshot4.png

set -e

if [ $# -lt 1 ]; then
  echo "使用方法: $0 <截图1> [截图2] [截图3] [截图4]"
  echo "示例: $0 screenshots/connections.png screenshots/terminal.png screenshots/files.png screenshots/monitor.png"
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "📦 仓库: $REPO"

# 创建临时 Issue 用于上传图片
echo "📤 创建临时 Issue 用于上传图片..."
ISSUE_URL=$(gh issue create --title "[临时] 截图上传" --body "上传 README 截图")
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -o '[0-9]*$')
echo "✅ Issue #$ISSUE_NUMBER 已创建: $ISSUE_URL"

echo ""
echo "🖼️  请手动上传图片到 Issue 中:"
echo "   1. 打开: $ISSUE_URL"
echo "   2. 拖拽以下截图文件到评论区"
echo ""

# 检查文件是否存在
for screenshot in "$@"; do
  if [ ! -f "$screenshot" ]; then
    echo "❌ 文件不存在: $screenshot"
    exit 1
  fi
  echo "   📷 $screenshot"
done

echo ""
echo "⏳ 等待图片上传完成后按回车继续..."
read -r

# 获取 Issue 评论中的图片链接
echo ""
echo "🔍 获取图片链接..."
COMMENTS=$(gh issue view "$ISSUE_NUMBER" --json comments -q '.comments[].body')

# 提取图片 URL
IMAGE_URLS=$(echo "$COMMENTS" | grep -o 'https://github\.com/user-attachments/assets/[a-f0-9-]*' | sort -u)

if [ -z "$IMAGE_URLS" ]; then
  echo "❌ 未找到图片链接，请确认已上传图片"
  exit 1
fi

echo "✅ 找到 $(echo "$IMAGE_URLS" | wc -l | tr -d ' ') 张图片"

# 生成新的 README 图片 HTML
IMAGE_HTML='<div style="display: flex; overflow-x: auto; gap: 10px; white-space: nowrap;">'
COUNT=0
ALT_TEXTS=("连接管理" "终端分屏" "文件管理" "系统监控")

while IFS= read -r url; do
  COUNT=$((COUNT + 1))
  ALT="${ALT_TEXTS[$((COUNT-1))]:-image}"
  IMAGE_HTML="$IMAGE_HTML
  <img src=\"$url\" alt=\"$ALT\" style=\"height: 300px; width: auto; flex-shrink: 0;\" />"
done <<< "$IMAGE_URLS"

IMAGE_HTML="$IMAGE_HTML
</div>"

echo ""
echo "📝 新的 README 图片 HTML:"
echo "$IMAGE_HTML"

# 更新 README
echo ""
echo "✏️  更新 README.md..."

# 备份原文件
cp README.md README.md.bak

# 使用 sed 替换图片部分
python3 << PYTHON_SCRIPT
import re

with open('README.md', 'r', encoding='utf-8') as f:
    content = f.read()

new_html = '''$IMAGE_HTML'''

# 替换应用图片部分
pattern = r'## 应用图片\n\n<div style="display: flex.*?</div>'
content = re.sub(pattern, f'## 应用图片\n\n{new_html}', content, flags=re.DOTALL)

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ README.md 已更新")
PYTHON_SCRIPT

# 清理临时 Issue
echo ""
echo "🗑️  是否删除临时 Issue? (y/n)"
read -r answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  gh issue delete "$ISSUE_NUMBER" --yes
  echo "✅ 临时 Issue 已删除"
else
  echo "⚠️  临时 Issue 保留，可稍后手动删除"
fi

echo ""
echo "🎉 完成！请检查 README.md 中的截图是否正确显示"
echo "📌 提交更改: git add README.md && git commit -m '更新截图'"

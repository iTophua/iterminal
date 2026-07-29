#!/usr/bin/env bash
# iTerminal 内存泄漏检测脚本
# 用法：./scripts/mem_check.sh
# 配合手动操作 App 界面（连接/断开 SSH）来量化内存变化

set -e

PID=$(pgrep -x iterminal | head -1)
if [ -z "$PID" ]; then
  echo "❌ 未找到 iTerminal 进程，请先启动应用"
  exit 1
fi

mb() { echo $(( $1 / 1024 )); }

RSS=$(ps -o rss= -p "$PID" | tr -d ' ')
echo "========================================"
echo "  iTerminal 内存检测  (PID $PID)"
echo "========================================"
echo ""
echo "当前占用: $(mb "$RSS") M"
echo ""
echo "请按以下步骤操作，每步完成后回到这里按回车采样："
echo ""

read -p "① 应用刚启动（空闲态）—— 按 [回车] 采样" _
S1=$(ps -o rss= -p "$PID" | tr -d ' ')
echo "   空闲: $(mb "$S1") M"

echo ""
read -p "② 打开 1 个 SSH 连接（连上即可，不用做什么）—— 按 [回车] 采样" _
S2=$(ps -o rss= -p "$PID" | tr -d ' ')
echo "   连接后: $(mb "$S2") M  (连接成本 +$(mb $((S2-S1))) M)"

echo ""
read -p "③ 在终端里随便跑几条命令(ls/top/日志输出等) —— 按 [回车] 采样" _
S3=$(ps -o rss= -p "$PID" | tr -d ' ')
echo "   使用后: $(mb "$S3") M"

echo ""
echo "④ 现在关闭那个 SSH 连接（点 × 或右键断开）"
echo "   关闭后等 ~10 秒让 GC 回收，然后按 [回车] 采样"
read -p _
S4=$(ps -o rss= -p "$PID" | tr -d ' ')
echo "   关闭后: $(mb "$S4") M"

echo ""
echo "⑤ 再等 20 秒做最后一次采样（确保完全回收）"
sleep 20
S5=$(ps -o rss= -p "$PID" | tr -d ' ')
echo "   最终: $(mb "$S5") M"

echo ""
echo "========================================"
echo "  结果分析"
echo "========================================"
echo "空闲基线:        $(mb "$S1") M"
echo "连接+使用峰值:   $(mb "$S3") M"
echo "关闭后稳定值:    $(mb "$S5") M"
echo ""
LEAK=$(( S5 - S1 ))
if [ "$LEAK" -lt 30000 ]; then
  echo "✅ 泄漏仅 +$(mb "$LEAK") M —— 在正常范围内（WKWebView 渲染缓存）"
elif [ "$LEAK" -lt 80000 ]; then
  echo "⚠️  残留 +$(mb "$LEAK") M —— 偏高，建议多测几轮（连接/关闭 3 次）看是否累积"
else
  echo "❌ 残留 +$(mb "$LEAK") M —— 仍有明显泄漏，连接关闭未充分释放"
fi
echo ""
echo "更严格的判断：重复 ②→④ 三次，若每次都 +$(mb "$LEAK") M 线性增长 → 确认泄漏"

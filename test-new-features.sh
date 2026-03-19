#!/bin/bash

echo "=== iTerminal v1.6.0 新功能测试 ==="
echo ""
echo "测试服务器: 127.0.0.1:2222"
echo "用户: root"
echo ""

echo "1. 编译检查..."
cd /Users/itophua/AI/AiProjects/i-terminal/iterminal/src-tauri && cargo check 2>&1 | tail -3

echo ""
echo "2. 运行测试..."
cd /Users/itophua/AI/AiProjects/i-terminal/iterminal && npm run test:run 2>&1 | tail -5

echo ""
echo "3. 后端测试..."
cd /Users/itophua/AI/AiProjects/i-terminal/iterminal/src-tauri && cargo test --lib 2>&1 | tail -5

echo ""
echo "=== 测试完成 ==="

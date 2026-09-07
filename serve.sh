#!/usr/bin/env bash
# AR 방탈출 로컬 서버
#
#   ./serve.sh          → http://localhost:8000
#   ./serve.sh 3000     → http://localhost:3000
#
# 카메라는 https:// 또는 localhost 에서만 동작합니다.
# 같은 와이파이의 태블릿에서 접속하려면 아래 "다른 기기에서 열기" 주소를 쓰되,
# 카메라까지 쓰려면 HTTPS 터널(ngrok, cloudflared 등)이 필요합니다.

set -euo pipefail
PORT="${1:-8000}"
cd "$(dirname "$0")"

IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '')"

echo ""
echo "  AR 방탈출 서버 실행 중"
echo "  ─────────────────────────────────────────────"
echo "  이 컴퓨터        http://localhost:${PORT}"
[ -n "$IP" ] && echo "  같은 와이파이     http://${IP}:${PORT}   (카메라는 HTTPS 필요)"
echo ""
echo "  제작 스튜디오     http://localhost:${PORT}/admin.html"
echo "  마커 만들기       http://localhost:${PORT}/markers.html"
echo "  ─────────────────────────────────────────────"
echo "  종료: Ctrl+C"
echo ""

python3 -m http.server "$PORT"

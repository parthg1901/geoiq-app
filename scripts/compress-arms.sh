#!/bin/bash
# Converts the cached arms PNGs to 240px WebP via a headless browser canvas (no image tools needed).
set -e
cd "$(dirname "$0")/.."
SRC=scripts/.cache/arms/png
cat > $SRC/conv.html <<'HTML'
<html><body><script>
async function conv(name, max) {
  const img = new Image(); img.src = name + '.png'; await img.decode();
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/webp', 0.82);
}
</script></body></html>
HTML
(cd $SRC && python3 -m http.server 8766 --bind 127.0.0.1 >/dev/null 2>&1 & echo $! > /tmp/arms-srv.pid); sleep 1
export PATH=~/.local/npm/bin:$PATH AGENT_BROWSER_SESSION=arms-compress
agent-browser --executable-path "$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-1228/*/headless_shell)" --args "--no-sandbox" open http://127.0.0.1:8766/conv.html >/dev/null
mkdir -p public/arms
for f in $SRC/*.png; do id=$(basename "$f" .png)
  agent-browser eval "conv('$id',240)" | tr -d '"' | sed 's/^data:image\/webp;base64,//' | base64 -d > "public/arms/$id.webp"; done
agent-browser close >/dev/null; kill "$(cat /tmp/arms-srv.pid)"
du -sh public/arms

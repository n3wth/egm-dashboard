#!/usr/bin/env bash
# Records a demo video of the dashboard. Needs a running dev server
# (npm --prefix egm-performance run dev), Playwright with Chromium, ffmpeg and python3.
# Usage: scripts/demo/build.sh [output.mp4]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export DEMO_DIR="${DEMO_DIR:-$here/.out}"
out="${1:-$DEMO_DIR/egm-demo.mp4}"
speed="${DEMO_SPEED:-1.5}"
mkdir -p "$DEMO_DIR"

node "$here/record.cjs"
node "$here/cards.cjs"

# Screencast frames arrive only when the page changes; hold each one until the next.
python3 - "$DEMO_DIR" <<'PY'
import json, os, sys
d = sys.argv[1]
data = json.load(open(os.path.join(d, 'frames.json')))
f = data['frames']
with open(os.path.join(d, 'concat.txt'), 'w') as o:
    for i, x in enumerate(f):
        nxt = f[i + 1]['t'] if i + 1 < len(f) else data['end']
        o.write(f"file '{x['file']}'\nduration {max(nxt - x['t'], 0.001):.4f}\n")
    o.write(f"file '{f[-1]['file']}'\n")
PY
ffmpeg -loglevel error -y -f concat -safe 0 -i "$DEMO_DIR/concat.txt" -vf "fps=30,format=yuv420p" \
  -c:v libx264 -crf 18 -preset medium "$DEMO_DIR/raw.mp4"

dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DEMO_DIR/raw.mp4")
o2=$(python3 -c "print(3 + $dur / $speed - 1.2)")
ffmpeg -loglevel error -y \
  -loop 1 -t 3 -framerate 30 -i "$DEMO_DIR/intro.png" -i "$DEMO_DIR/raw.mp4" -loop 1 -t 4 -framerate 30 -i "$DEMO_DIR/outro.png" \
  -filter_complex "[0]format=yuv420p,setsar=1[i];[1]setpts=PTS/$speed,fps=30,format=yuv420p,setsar=1[m];[2]format=yuv420p,setsar=1[o];[i][m]xfade=transition=fade:duration=0.6:offset=2.4[a];[a][o]xfade=transition=fade:duration=0.6:offset=$o2,fade=t=in:d=0.4,fade=t=out:st=$(python3 -c "print($o2 + 3.5)"):d=0.5[v]" \
  -map "[v]" -c:v libx264 -crf 20 -preset slow -profile:v high -pix_fmt yuv420p -movflags +faststart "$out"
echo "wrote $out"

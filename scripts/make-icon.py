# Regenerates build/icon.png + build/icon.ico from build/icon-source.png:
#   python scripts/make-icon.py build/icon-source.png build
import sys
from collections import deque
from PIL import Image, ImageFilter
src, out_dir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
px = im.load()

# 1) Background = near-black pixels connected to the four corners (flood fill, so dark
#    areas inside the artwork are never touched).
THRESH = 10
bg = bytearray(W * H)
q = deque([(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)])
while q:
    x, y = q.popleft()
    i = y * W + x
    if bg[i] or max(px[x, y]) > THRESH:
        continue
    bg[i] = 1
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < W and 0 <= ny < H and not bg[ny * W + nx]:
            q.append((nx, ny))
print('background pixels:', sum(bg), f'({sum(bg) / (W * H):.1%})')

# 2) Alpha mask with a soft (anti-aliased) edge.
mask = Image.frombytes('L', (W, H), bytes(0 if b else 255 for b in bg))
mask = mask.filter(ImageFilter.GaussianBlur(0.9))
# Keep the interior fully opaque: only the ~2px edge band is softened.
mask = mask.point(lambda v: 255 if v > 250 else v)

rgba = im.convert('RGBA')
rgba.putalpha(mask)
rgba.save(f'{out_dir}/icon.png')

# 3) Multi-size .ico — each size resampled from the 1024 master.
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [rgba.resize((s, s), Image.LANCZOS) for s in sizes]
frames[-1].save(f'{out_dir}/icon.ico', format='ICO', sizes=[(s, s) for s in sizes],
                append_images=frames[:-1])
print('wrote', out_dir)

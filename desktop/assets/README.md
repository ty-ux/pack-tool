# PackTool desktop icon

`pack-tool.png` is the generated source. `pack-tool.ico` contains 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 pixel images for Windows Explorer, the executable and the application window.

Generated with the built-in image generation tool. The artwork is included under this repository's MIT license. ICO conversion uses Pillow; no image-generation API key is needed to build or run PackTool.

## Generation prompt

Use case: logo-brand. Asset type: Windows desktop app icon for PackTool, a local developer app for building Android packages across Flutter, native Android, React Native and uni-app. Create one polished square 1024x1024 app icon, isolated on a genuinely transparent background. Subject: a single bold geometric package cube with an integrated upward build arrow, forming one coherent simple emblem, centered on a deep navy rounded-square tile with a restrained teal highlight. Clean crisp silhouette, broad flat planes, subtle dimensional depth, excellent legibility at 16px and 32px. Tile fills most of the canvas with a small transparent safety margin and rounded outer corners. No text, letters, logos of other companies, phones, tools, gears, tiny details, background scenery, or watermark. One icon only, front-facing, no contact sheet or mockup.

## Rebuild the ICO

With Pillow installed, run from the repository root:

```python
from PIL import Image

Image.open('desktop/assets/pack-tool.png').save(
    'desktop/assets/pack-tool.ico', format='ICO',
    sizes=[(size, size) for size in [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]],
)
```

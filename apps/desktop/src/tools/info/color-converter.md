# Color Converter

Converts a color between hex, RGB, HSL, and HSV, and reports the contrast ratios that decide whether text on it is readable.

## Accepted input

- Hex with 3, 4, 6, or 8 digits: `#39f`, `#3b82f6`, `#3b82f6cc`. The leading `#` is optional.
- `rgb()` / `rgba()`, with commas or spaces: `rgb(59, 130, 246)`, `rgb(59 130 246 / 0.8)`.
- `hsl()` / `hsla()`: `hsl(217, 91%, 60%)`.
- Common CSS color names: `tomato`, `teal`, `rebeccapurple`-era basics.

## Contrast

Ratios follow WCAG 2 relative luminance. The thresholds that matter:

- **4.5:1** — passes AA for body text.
- **3:1** — passes AA for large text (18pt, or 14pt bold) and for UI component boundaries.
- **7:1** — passes AAA for body text.

"Best text color" tells you whether black or white text sits more legibly on the color, and which level that pairing reaches.

## Note on alpha

An alpha channel is parsed and carried into the RGBA and 8-digit hex output, but contrast is computed on the opaque color. A translucent color's real contrast depends on whatever sits behind it, which this tool cannot know.

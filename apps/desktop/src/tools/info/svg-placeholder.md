# SVG Placeholder

Generates a placeholder image as inline SVG — a solid background with centered text, sized exactly as you set it. Handy for mocking up a layout before real images or assets exist.

If you leave the label empty, it defaults to the image's dimensions (`300×150`), the way most placeholder-image services behave.

## Tip

Because the output is SVG text, not a raster image, it scales to any size without blurring — copy it straight into a `<img src="data:image/svg+xml,...">` or save it as a `.svg` file.

# Future Tool Ideas

Tools identified during Phase 2 testing. Build when needed.

## place_image
Generic image placement (not product-specific). For textures, backgrounds, UI screenshots, ad library references. Same pipeline as place_product but no auto-trim, no positioning presets. Just: read file → create frame → apply fill.

## create_container
Nested auto-layout frame for UI components (cards, pills, badges, notification bubbles). Parameters: padding, cornerRadius, fill, layoutMode, itemSpacing. Building block for borrowed interfaces. Higher-level than create_shape — includes auto-layout setup.

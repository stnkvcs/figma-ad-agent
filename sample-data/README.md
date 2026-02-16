# Sample Data

This directory contains sample brand data and a mini ad library so you can test the plugin without setting up your own brand.

## What's Included

### Brand: Feno SmartBrush
A real DTC oral health tech brand. Includes:
- **Brand overview** — Mission, market, competitive landscape
- **Product spec** — Features, benefits, target audience, pricing
- **Product image** — Reference photo for AI product generation
- **Concepts log** — One example ad concept already logged

### Ad Library (18 reference ads)
A small sample from the full 2,637-image library. 6 categories, 3 ads each:
- Bold, Comparison, IG Story, Simple Layout, Social Proof, Strong Copy

The SQLite database (`library.db`) contains metadata for all 18 images.

## How to Use

Point your `.env` at this directory:

```bash
BRAND_DATA_ROOT=/path/to/figma-ad-agent/sample-data/brands
AD_LIBRARY_ROOT=/path/to/figma-ad-agent/sample-data/ad-library
```

Then select "Feno - SmartBrush" in the plugin's brand dropdown.

## Creating Your Own Brand

Copy the Feno structure and replace with your brand's data:

```
brands/
  your-brand/
    brand/
      overview.md            # Brand voice, colors, positioning
    products/
      your-product/
        spec.md              # Product details and features
        assets/
          product.png        # Product reference image
    ads/
      concepts-log.md        # Starts empty, auto-updated by agent
```

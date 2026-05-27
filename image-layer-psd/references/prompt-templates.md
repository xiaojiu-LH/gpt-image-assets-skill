# Prompt Templates

Use these templates with the base image as image input whenever possible.

## Base Image

Generate one coherent base image matching the user's request. Avoid asking for layers in the base image prompt.

## Subject/Product Layer

Create a transparent-background PNG layer containing only the main subject/product from the reference image.

Requirements:

- keep subject identity, shape, color, texture, and lighting
- remove all background pixels
- preserve natural edge detail
- do not include text, logo, props, or background unless they are physically part of the subject

## Background Layer

Create a full-canvas background PNG with foreground subject removed.

Requirements:

- complete and inpaint the background behind the removed subject
- no holes, cutout silhouettes, subject residue, or transparent gaps
- no text or logo unless the layer contract explicitly requires them in background

## Text Layer

Create a transparent-background PNG containing only the visible text from the base image or requested design.

Requirements:

- no background
- no subject pixels
- preserve approximate position and color
- if exact text is unknown, leave this layer empty only when the layer is optional

## Logo Layer

Create a transparent-background PNG containing only logo or brand mark.

Requirements:

- no background
- no subject pixels except logo attached to packaging when required
- preserve approximate position and proportions

## Retry Prompt

When retrying a failed layer, append:

```text
Previous failed layer attempt:
{previous_failure}

Fix only this failure. Keep canvas size, composition alignment, and layer role unchanged.
```

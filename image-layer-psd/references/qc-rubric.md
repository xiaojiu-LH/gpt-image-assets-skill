# QC Rubric

Run QC after building the PSD. A passing delivery must satisfy these checks.

## File Checks

- PSD starts with `8BPS`.
- PSD layer count is at least the contract layer count.
- PSD layer names match the contract.
- Every layer PNG exists.
- Every layer PNG is 8-bit PNG and matches the canvas size.

## Layer Checks

- Foreground layers have useful transparency.
- Background layer is mostly opaque.
- Background layer has low transparent pixel ratio.
- Subject/product layer is not fully opaque.
- Text/logo layers may be empty only if the prompt did not require visible text/logo.

## Failure Reason Format

Use concise, layer-specific notes:

```text
subject: edge contains background pixels; background: transparent holes under product; logo: missing brand mark
```

Retry only the failed layer when the failure is isolated. Retry the full split if the base image or background completion caused multiple failures.

# Momentum animation

Original, script-free Rive scene authored for Boing. Colored signals gather and rebound around a central point, reflecting the product's different sources coming together. `scene.rml` and `rive.yaml` are the editable source; `momentum.riv` is the locally compiled runtime file. The `Momentum` artboard runs its `Momentum` state machine by default. `momentum.svg` is a matching static fallback.

Use the SVG when reduced motion is requested, when the runtime is unavailable, or until the local Rive file is loaded. Hide the canvas from assistive technology when it is decorative. Do not request a remote asset or rely on a third-party animation.

Validation: `rive . --verify`, `rive inspect . --summary`, `rive . --screenshot --advance=1s`.

# Load Order Plan

Pocket will move from a large `index.html` script stack to a small shell plus a boot pipeline.

Target `index.html`:

```html
<link rel="stylesheet" href="css/pocket.css">
<script src="js/boot/pocket-boot.js" defer></script>
```

Boot phases:

1. core
2. tree
3. commands
4. pe
5. health
6. legacy-transition

Rule: new work must belong to a named phase. Legacy files are temporary and should not gain
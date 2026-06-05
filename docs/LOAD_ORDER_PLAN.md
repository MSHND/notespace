# Load Order Plan

Pocket is moving from a large `index.html` script stack to a small shell plus a boot pipeline.

## Target

`index.html` should load CSS and one boot script:

```html
<link rel="stylesheet" href="css/pocket.css">
<script src="js/boot/pocket-boot.js" defer></script>
```

## Phases

1. core: state, metadata, storage.
2. tree: render and selection.
3. commands: keyboard, context menu, edit actions.
4. pe: item details route, window, save,
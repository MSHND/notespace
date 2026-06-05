# Load Order Plan

Pocket is moving from a large script-tag stack in `index.html` to a small shell plus an intentional boot pipeline.

## Goal

`index.html` should contain page markup, CSS, and one boot script only.

## Target

```html
<link rel="stylesheet" href="css/pocket.css">
<script src="js/boot/pocket-boot.js" defer></script>
```

## Phases

1. core: state, metadata, storage.
2. tree: render, selection, outline movement.
3. commands: keyboard,
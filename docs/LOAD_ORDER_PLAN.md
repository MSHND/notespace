# Load Order Plan

Pocket is moving from a large script-tag stack in `index.html` to a small page shell plus an intentional boot pipeline.

## Goal

`index.html` should become boring and stable: page markup, CSS, and one boot script.

The boot layer should load JavaScript in named phases so ownership is visible and mods have a planned home.

## Target boot shape

```html
<link rel="stylesheet" href="css/pocket.css">
<script src="js/boot/pocket-boot.js" defer></script>
```

## Intended phases

1. core
   - state
   - metadata
   - storage
   - import/export

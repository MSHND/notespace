# Pocket architecture map

Pocket is moving from layered patch behaviour to named ownership.

This file is the repo source of truth for where behaviour belongs.

## Standing rule

Prefer purpose-built plumbing over wrappers. If a bug survives one or two patch attempts, stop and replace the relevant plumbing cleanly.

## Target owners

- App state
- Tree rendering
- Command routing
- PE route
- Metadata
- Storage
- Health checks

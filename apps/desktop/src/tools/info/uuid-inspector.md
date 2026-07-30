# UUID Inspector

Decodes a UUID's version, variant, and — for the versions that carry one — the timestamp it embeds.

## Accepted input

Bare, braced (`{...}`), and `urn:uuid:` forms all work, and casing doesn't matter.

## What each version reveals

- **v1** — timestamp, 14-bit clock sequence, and node ID. This build always generates v1 with a random multicast node rather than a real MAC address, and flags that on inspection.
- **v6** — the same fields as v1, reordered so the timestamp sorts correctly as plain text.
- **v7** — a Unix-millisecond timestamp in the leading bits, plus random bits after.
- **v4** — no embedded data. It's 122 bits of randomness; there is nothing to recover.
- **v3 / v5** — deterministic hashes of a namespace + name (MD5 for v3, SHA-1 for v5). Nothing about the original input is recoverable from the UUID alone.

The all-zero and all-one UUIDs are called out by name (nil and max) rather than parsed as a numbered version, since neither carries a version nibble that means anything.

## Tip

Only trust the recovered timestamp on v1, v6, and v7 — a v4 UUID has no creation time embedded, no matter how it looks.

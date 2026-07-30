# Chmod Calculator

Converts Unix file permissions between octal (`755`) and symbolic (`rwxr-xr-x`) notation, in either direction — type whichever form you have.

## Reading the output

Each of the three permission triads (owner, group, other) is broken into read/write/execute. The **special bits** — setuid, setgid, and the sticky bit — show up as a 4th leading octal digit, and in symbolic form they replace the execute character in that triad:

| Symbol | Meaning |
|---|---|
| `s` | special bit set **and** execute on |
| `S` | special bit set, execute **off** |
| `t` | sticky bit set **and** execute on (final triad only) |
| `T` | sticky bit set, execute off |

## Tip

A leading `0` on an octal mode (`0755`) is accepted and treated the same as `755` — both mean no special bits set.

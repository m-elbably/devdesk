# ISO 8601 Duration

Converts between ISO 8601 durations, plain English, and raw seconds — the format that turns up in Kubernetes manifests, JSON Schema, XML, cron tooling, and API `retry-after` style fields.

## Accepted input

- **ISO 8601**: `PT1H30M`, `P1DT6H`, `P2W`, and the signed extension `-PT30M`.
- **Shorthand**: `1h 30m`, `90 minutes`, `2 days`.
- **Bare seconds**: `5400`.

## Output

ISO 8601 form, a readable breakdown, totals in seconds/minutes/hours/days, milliseconds, and the wall-clock time that far from now.

## Why years and months are approximate

A month is 28–31 days and a year is 365 or 366, so neither converts to a fixed number of seconds. On input, `P1Y` is treated as 365 days and `P1M` as 30 days. Output never emits `Y` or `M` — it stops at days, which are unambiguous.

If you need exact calendar arithmetic, use the **Date Calculator**, which works in real months and years against a specific date.

# .env ↔ JSON

Converts between dotenv files and JSON in either direction.

## .env → JSON

Comments (`#`) and blank lines are dropped, and a leading `export ` is stripped from each line. Only double-quoted values interpret backslash escapes (`\n`, `\"`, `\\`) — the same rule a shell applies; single-quoted and bare values are taken literally.

## JSON → .env

The JSON must be a plain object. Values that need quoting (containing whitespace, `#`, quotes, or a backslash) are wrapped in double quotes with those characters escaped; everything else is written bare. Nested objects and arrays have no dotenv equivalent, so they're written back as JSON text on the right-hand side.

# JSON ↔ JSON Lines

Converts JSON arrays to and from JSON Lines, also known as JSONL or NDJSON.

Each non-empty JSON Lines row contains one complete JSON value. This format is common for logs, streaming pipelines, and large datasets that are processed one record at a time.

## Directions

- **JSON → JSON Lines** requires a top-level array and writes one compact value per line.
- **JSON Lines → JSON** parses each non-empty line and returns one formatted JSON array.

## Privacy

Conversion runs entirely on this device.

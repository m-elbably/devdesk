# JSON ↔ CSV

Converts a JSON array of objects to CSV, or a CSV document with a header row to JSON.

## JSON → CSV

Object keys become columns. The converter collects keys from every record, leaves missing values blank, and correctly quotes commas, quotes, and line breaks. Nested arrays and objects are stored as JSON text inside their CSV cell.

## CSV → JSON

The first row supplies the property names. CSV values remain strings because CSV carries no reliable type information; convert numbers and booleans in your application when its schema is known.

Duplicate or empty headers are rejected because they would lose data in a JSON object.

## Privacy

Conversion runs entirely on this device.

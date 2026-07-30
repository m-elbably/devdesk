# XML ↔ JSON

Converts between XML and JSON in either direction, using a convention that round-trips cleanly:

- An element's attributes become `@name` keys.
- Text mixed with child elements becomes a `#text` key.
- Repeated child elements with the same tag collapse into a JSON array.

## Going JSON → XML

The JSON must be an object with exactly one top-level key — that key becomes the XML root element. An array or an object with several top-level keys has no single obvious root, so it's rejected with an error rather than guessed at.

## Limits

Namespace prefixes (`xmlns:foo`) are kept verbatim rather than resolved, and DTD entity declarations are not expanded — both are rare enough in hand-edited XML that supporting them wasn't worth the complexity here.

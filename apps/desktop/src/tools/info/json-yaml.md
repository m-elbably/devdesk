# JSON ↔ YAML

Converts structured data between JSON and YAML while keeping arrays, objects, numbers, booleans, strings, and null values intact.

## Directions

- **JSON → YAML** parses JSON and produces readable YAML.
- **YAML → JSON** parses YAML and produces indented JSON.

## Notes

- YAML comments and original formatting cannot survive conversion because JSON has no equivalent representation.
- YAML anchors are resolved into ordinary JSON values.
- Always review configuration files after conversion when exact scalar types matter.

## Privacy

Conversion runs entirely on this device.

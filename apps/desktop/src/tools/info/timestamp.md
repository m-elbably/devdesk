# Timestamp Converter

Converts Unix timestamps and date strings into common machine-readable and human-readable forms, plus the calendar detail you would otherwise go looking up.

## Accepted input

- `now` for the current instant, or `today` / `tomorrow` / `yesterday` for local midnight.
- An offset from now: `+2d`, `-90m`, `+1w`. Units are `ms`, `s`, `m`, `h`, `d`, `w`.
- Unix seconds, such as `1710000000`.
- Unix milliseconds, such as `1710000000000`.
- An ISO 8601 date containing a time zone or UTC offset.

Numeric values below one trillion are interpreted as seconds; larger values as milliseconds.

## Output

ISO 8601 in both UTC and local form, a full local date, the HTTP/RFC date, Unix seconds and milliseconds, and the calendar detail: day of week, day of year, ISO week number, quarter, your time zone and offset, and whether it is a leap year. A relative row ("3 hours ago") updates every second.

The **ISO week** is the ISO-8601 one: weeks start Monday and week 1 is the week containing the first Thursday, so the first days of January sometimes belong to the previous year's week 52 or 53.

## Tip

Include `Z` or an explicit offset such as `+02:00` in date strings to avoid local-time ambiguity.

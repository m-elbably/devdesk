# Time Zone Converter

Shows one instant across several [IANA time zones](https://www.iana.org/time-zones) at once — `Africa/Cairo`, `Europe/London`, `America/New_York`, and as many more as you list.

List zones comma-separated. Your own zone is always shown first, so you can read a meeting slot off the table without doing the arithmetic yourself. Each row carries that zone's UTC offset **at that instant**, which accounts for whether it happens to be in daylight saving.

## Accepted input

- `now`, `today`, `tomorrow`, `yesterday`
- An offset from now, such as `+2d` or `-90m`
- Unix seconds or milliseconds
- An ISO 8601 date

## Important

- Time-zone rules include daylight-saving and historical changes supplied by the operating environment.
- Use an ISO input with `Z` or an explicit UTC offset so the source instant is unambiguous.
- Fixed abbreviations such as `CST` are ambiguous; use an IANA name instead.
- Offsets move across the year. A meeting that is 09:00→17:00 in March may be an hour off in November, because the two zones change clocks on different dates.

## Privacy

Conversion runs entirely on this device.

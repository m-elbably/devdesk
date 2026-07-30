# Duration Calculator

Calculates the elapsed time between two date/time values, in both clock units and calendar units.

## What the rows mean

- **Duration** — exact elapsed time as days/hours/minutes/seconds, where a day is exactly 24 hours.
- **Calendar** — the same span counted the way a person counts it (`1y 2mo 3d`), which is what you want for ages and anniversaries. It drops the leftover hours.
- **Business days** — whole Monday–Friday days in the range.
- **Totals** — the whole span expressed in one unit at a time.

The two top rows can disagree, and both are right: a calendar month is 28–31 days, so "1 month" is not a fixed number of hours.

## Date handling

- `now`, `today`, `tomorrow`, `yesterday`, offsets like `+2d`, Unix timestamps, and ISO 8601 dates are all accepted.
- If the end precedes the start, the result says so and shows the absolute duration.
- Business days count weekends out only. Public holidays are jurisdiction-specific and are not modelled — check your own calendar for those.

Include `Z` or an explicit UTC offset in both inputs when daylight-saving transitions or users in different local time zones are involved.

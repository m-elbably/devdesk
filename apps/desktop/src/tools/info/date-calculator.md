# Date Calculator

Adds or subtracts a span of time from a date and reports the result in every common format.

## Accepted input

The **From** field takes the same vocabulary as every date tool here:

- `now`, `today`, `tomorrow`, `yesterday`
- An offset from now, such as `+2d` or `-90m`
- Unix seconds or milliseconds
- An ISO 8601 date

## Units

`years`, `months`, `weeks`, `days`, `hours`, `minutes`, `seconds`, and `business days`.

## Edge cases it handles

- **Month-end clamping.** One month after 31 January is 28 February (29 in a leap year), not 3 March. Adding a month then subtracting it again will not always return you to the original date — that is inherent to calendar arithmetic, not a bug here.
- **Daylight saving.** Steps of a day or larger keep the wall-clock time, so "+1 day" from 09:00 is 09:00 the next morning even when that day is 23 or 25 hours long. Hour, minute, and second steps add exact elapsed time instead, which is what those units mean.
- **Business days** skip Saturday and Sunday. Public holidays vary by country and employer and are not modelled.

## Tip

Use it for deadlines: "invoice due 30 business days from today" or "trial ends `+14d`".

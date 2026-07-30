# IP Range ⇄ CIDR

Converts between an arbitrary address range and the CIDR blocks that cover it. One field, both directions — a dash means a range to summarise, anything else is a block to expand.

## Range → blocks

Firewalls, security groups and allowlists take CIDR blocks; humans think in ranges. An arbitrary range almost never maps onto a single block, because a block has to start on an aligned boundary and be a power of two long.

`192.168.1.5 – 192.168.1.100` needs eight blocks:

```
192.168.1.5/32    192.168.1.6/31    192.168.1.8/29
192.168.1.16/28   192.168.1.32/27   192.168.1.64/27
192.168.1.96/30   192.168.1.100/32
```

That set is minimal and exact — it covers every address in the range and not one extra. The temptation to "round it up" to `192.168.1.0/24` is how an allowlist quietly grows by 156 addresses you never meant to admit.

## Blocks → range

Given a block, you get its first and last address, the total count, and the RFC scope it belongs to. Useful when reading someone else's firewall rule and wondering what `100.64.0.0/10` actually spans.

## Reading the map

The bar draws the blocks to scale. Sizes differ by orders of magnitude in a summarised range — a `/32` next to a `/27` — so small blocks are drawn at a minimum width and the tooltip carries the exact numbers. Dashed segments are gaps: addresses inside the span that no block covers.

## Privacy

Runs entirely on this device and makes no network requests.

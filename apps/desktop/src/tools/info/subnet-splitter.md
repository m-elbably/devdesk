# Subnet Splitter

Carves a network into equal-sized subnets and shows how the address space is used.

Give it a parent network and the prefix you want to split into. `10.0.0.0/24` into `/26` gives four subnets of 62 usable hosts each.

## Reading the map

The bar above the table is the parent network drawn to scale, one segment per subnet. Because every subnet here is the same size, the segments tile evenly — the map earns its keep when you compare it against the block map produced by **IP Range ⇄ CIDR**, where sizes vary wildly.

## Picking a prefix

Each extra bit halves the subnet and doubles the count.

| Prefix | Subnets of a /24 | Usable hosts each |
|---|---|---|
| `/25` | 2 | 126 |
| `/26` | 4 | 62 |
| `/27` | 8 | 30 |
| `/28` | 16 | 14 |
| `/30` | 64 | 2 |

Usable counts exclude the network and broadcast address. `/31` (point-to-point links) and `/32` (a single host) keep both, per RFC 3021.

## Notes

- Splitting is equal-size only. Variable-length allocation (VLSM) means running the tool once per tier — split the parent into the largest tier first, then split one of those results again.
- The listing stops at 1024 subnets; past that the table is a wall, not an answer.
- Cloud VPCs reserve extra addresses per subnet — AWS takes five, Azure five, GCP four — so subtract those from the usable count when planning against a real provider.

## Privacy

Runs entirely on this device and makes no network requests.

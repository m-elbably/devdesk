# CIDR Calculator

Calculates the IPv4 network represented by an address and CIDR prefix, such as `192.168.1.10/24`.

## Accepted input

- CIDR notation: `192.168.1.10/24`
- Address and dotted netmask: `192.168.1.10 255.255.255.0`
- A bare address, which reads as `/32`

A netmask whose bits are not one contiguous run of `1`s is rejected — that is a typo, not a mask.

## Results

- **Network** is the first address in the subnet.
- **Broadcast** is the final address in the subnet.
- **Netmask** identifies the network bits; **Wildcard** is its inverse (what Cisco ACLs and OSPF want).
- **Usable range** excludes network and broadcast addresses for `/0` through `/30`.
- `/31` networks keep both addresses because they are commonly used for point-to-point links; `/32` represents one host.
- **Scope** names the IANA special-purpose block the address belongs to, if any.
- **Reverse DNS** is the `in-addr.arpa` name a `PTR` record lives at.
- **Integer range** is the pair of unsigned integers the network spans — the form to use in a database `BETWEEN` query.

## Scope, and why it is usually the answer

- `169.254.x.x` — link-local. On a host that expects DHCP, this means DHCP failed.
- `100.64.x.x` — carrier-grade NAT. Your ISP is NATing you as well as your own router.
- `192.0.2.x`, `198.51.100.x`, `203.0.113.x` — documentation ranges. In production traffic, someone copy-pasted an example.
- `10.x`, `172.16–31.x`, `192.168.x` — private (RFC 1918), never routed on the internet.

## The bit ruler

The graphic above the table shows all 32 bits, coloured to split network from host. It is the fastest way to see why `/26` and `/27` behave differently, which the dotted form hides.

## Examples

| Input | Network | Usable range |
|---|---|---|
| `192.168.1.10/24` | `192.168.1.0/24` | `192.168.1.1 – 192.168.1.254` |
| `10.0.0.4/30` | `10.0.0.4/30` | `10.0.0.5 – 10.0.0.6` |
| `203.0.113.8/32` | `203.0.113.8/32` | `203.0.113.8 – 203.0.113.8` |

## Privacy

The calculation runs entirely on this device and makes no network requests.

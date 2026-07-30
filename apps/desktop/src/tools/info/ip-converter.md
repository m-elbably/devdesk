# IP Address Converter

Converts an address between every representation it has. IPv4 and IPv6 both work — a colon in the input selects IPv6.

## Accepted input

| Family | Examples |
|---|---|
| IPv4 | `192.168.1.1` |
| Unsigned integer | `3232235777` |
| Hexadecimal | `0xC0A80101` |
| IPv6 | `2001:db8::1`, `fe80::1%eth0`, `[::1]`, `::ffff:192.0.2.1` |

Brackets and a `%zone` suffix are stripped. An IPv6 address ending in a dotted quad is read as the two hextets it stands for.

## IPv4 output

Dotted-decimal, integer, hex, binary (32 bits, leading zeroes kept), and octal per octet — plus the address **scope**, its `in-addr.arpa` reverse-DNS name, and the `::ffff:` IPv4-mapped IPv6 form.

## IPv6 output

Both the fully expanded form and the RFC 5952 canonical compressed form — lowercase, no leading zeroes, the longest run of zero groups replaced by `::` (leftmost run on a tie). Config files and log lines disagree about this constantly; the canonical form is the one to compare against. You also get the scope, the 128-bit integer, the `ip6.arpa` name, and the bracketed form a URL needs.

## Scope

Every address carries a scope from the IANA special-purpose registries — private, loopback, link-local, CGNAT, documentation, multicast, or globally routable. It answers "should this thing be reachable from the internet?" without a lookup.

`169.254.x.x` on a host that expects DHCP means DHCP failed. `100.64.x.x` means your ISP is running carrier-grade NAT in front of you. `192.0.2.x`, `198.51.100.x` and `203.0.113.x` are documentation ranges — if one shows up in production traffic, someone copy-pasted an example.

## Common uses

- Reading IP values stored as integers in databases or logs.
- Normalising IPv6 addresses before comparing them.
- Building reverse-DNS (`PTR`) zone entries.
- Inspecting the individual bits of an address.

## Privacy

Conversion runs entirely on this device and makes no network requests.

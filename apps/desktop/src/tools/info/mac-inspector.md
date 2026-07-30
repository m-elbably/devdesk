# MAC Address Inspector

Decodes a 48-bit MAC address. Any separator works — colons, hyphens, Cisco dots, or none at all.

## The two bits that matter

A MAC's first byte carries two flags:

- **U/L bit** (`0x02`) — *universally* or *locally* administered. Universal means the first three bytes are an OUI assigned to a vendor by the IEEE. Local means software set the address.
- **I/G bit** (`0x01`) — *individual* (unicast) or *group* (multicast). `FF:FF:FF:FF:FF:FF` is broadcast.

A locally administered address is not suspicious. Since iOS 14 and Android 10, phones randomise their MAC per network by default, and every Docker container and VM gets a synthetic one. Seeing a randomised MAC on your wireless network is the expected case.

## EUI-64 and link-local

IPv6 stateless autoconfiguration historically derived an interface identifier from the MAC (RFC 4291): split the address in half, insert `FF:FE` in the middle, and flip the U/L bit. Prefixed with `fe80::`, that gives the link-local address the interface would have used.

This is worth knowing because it *leaked the hardware address into every packet*, which is why RFC 8981 privacy extensions — random, rotating interface identifiers — are now the default. If you see an EUI-64-shaped address in a capture, something old is generating it.

## Vendor names

Not looked up here. Mapping an OUI to a company name requires the IEEE registry, a database that has to be shipped and kept current; this tool stays offline and dependency-free instead. The OUI is shown so you can paste it into a registry lookup if you need the name.

## Privacy

Runs entirely on this device and makes no network requests.

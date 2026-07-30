# MAC Address Generator

Generates random MAC addresses for development, testing, and disposable virtual interfaces.

## Address type

With no OUI prefix, the first byte is adjusted so that:

- The multicast bit is `0`, making the address unicast.
- The local bit is `1`, marking it **locally administered** rather than vendor-assigned.

This avoids pretending that a random address belongs to a real hardware vendor. It does not guarantee uniqueness, so check for collisions before assigning generated addresses on the same network.

## OUI prefix

Give a prefix (`00:1A:2B`, or any whole number of hex bytes) and the generated addresses start with it, with the rest randomised. The local/unicast bits are left alone in this mode — you asked for that vendor's space, so overriding the flags would defeat the point.

This is what you want when testing something that filters by vendor: a MAC allowlist, a DHCP reservation pool, or a NAC policy that treats one manufacturer differently.

## Formatting

Colon, hyphen, Cisco dotted (`001a.2b3c.4d5e`), or compact, in upper or lower case. Cisco and HP gear use the dotted form in their configs exclusively.

To decode an address rather than make one, use the **MAC Address Inspector**.

## Privacy

Addresses are generated with the browser's cryptographically secure random-number generator and never leave this device.

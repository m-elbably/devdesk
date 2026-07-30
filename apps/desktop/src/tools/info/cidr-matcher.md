# IP / CIDR Matcher

Answers the question a firewall rule, a security group, or a routing table is really asking: **does this address fall inside this block?**

Paste addresses on the left (one per line, or comma-separated) and CIDR blocks on the right. Each address gets a verdict.

## Longest prefix wins

When several blocks match, they are all listed but the **longest prefix comes first** — the same rule a routing table and most ACL engines use to pick a winner. Given:

```
10.0.0.0/8
10.0.5.0/24
```

the address `10.0.5.20` matches both, and `10.0.5.0/24` is the one that decides its fate.

## Overlap warnings

Rows at the bottom flag blocks that overlap each other. Overlaps are not errors by themselves — a specific exception inside a broad allow is a normal pattern — but they are the usual reason a rule "does nothing": something broader and earlier in the list already matched.

## What this is for

- Checking whether an alert's source IP was inside a range you thought you had blocked.
- Verifying a bastion's address really is covered by the security group you wrote.
- Finding out why two VPCs refuse to peer (their CIDRs overlap).
- Sanity-checking a generated allowlist before it ships.

## Notes

- IPv4 only. IPv6 block matching follows the same idea but needs 128-bit arithmetic that this tool does not do yet.
- Blocks accept a dotted netmask (`10.0.0.0 255.0.0.0`) or a bare address, which reads as `/32`.

## Privacy

Runs entirely on this device and makes no network requests. Nothing you paste is sent anywhere.

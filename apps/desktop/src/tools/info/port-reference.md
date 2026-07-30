# Port Reference

Looks up what commonly runs on a TCP or UDP port. Search by number, by service name (`postgres`, `redis`), or by keyword (`mail`, `vpn`). An empty search lists everything.

## Port ranges

Typing a bare number also reports which IANA range it falls in, which is usually the other half of the question:

| Range | Name | Why it matters |
|---|---|---|
| 0–1023 | System / well-known | Binding needs root on Unix — the reason `:80` fails and `:8080` doesn't |
| 1024–49151 | User / registered | Where your services should live |
| 49152–65535 | Dynamic / ephemeral | Outbound source ports and passive-mode data connections |

An unexpected high-numbered port in a connection log is usually just the client side of a normal connection, not an intrusion.

## Caveats

- A port number is a convention, not a guarantee. Anything can listen anywhere; `nmap -sV` or `ss -tlnp` tells you what is *actually* there.
- This is a curated list of what you meet in practice, not the full IANA registry of several thousand assignments.
- Ports flagged as dangerous to expose (`445`, `2375`, `6379`, `11211`) are the ones that show up in incident reports — most were designed for trusted networks and authenticate weakly or not at all.

## Privacy

A static local lookup table. No network requests, and nothing you type leaves this device.

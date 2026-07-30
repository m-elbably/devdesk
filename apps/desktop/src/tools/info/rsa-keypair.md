# RSA Key Pair Generator

Generate a random **RSA public/private key pair** using the browser's native **Web Crypto API** and export both as **PEM**-encoded text.

---

## How It Works

```mermaid
flowchart LR
    A["Bits (256–16384)"] --> B["crypto.subtle.generateKey"]
    B --> C["Public key (SPKI)"]
    B --> D["Private key (PKCS8)"]
    C --> E["PEM"]
    D --> E
```

The key pair is generated entirely **client-side** using `RSASSA-PKCS1-v1_5` with a 65537 public exponent. Keys are exported as:

- **Public key** — SPKI format, `-----BEGIN PUBLIC KEY-----`
- **Private key** — PKCS8 format, `-----BEGIN PRIVATE KEY-----`

This is the modern PEM format understood by OpenSSL, SSH tooling, Node's `crypto` module, and most languages' standard crypto libraries.

> Note: this differs from the legacy `-----BEGIN RSA PRIVATE KEY-----` (PKCS1) header some older tools produce. PKCS8 carries the same key material — most tools accept it directly, or convert with `openssl pkey -in key.pem -out key-pkcs1.pem -traditional`.

---

## Bits

Key size in bits, from **256 to 16384**, must be a **multiple of 8**. Larger keys are more secure but slower to generate — sizes above 4096 can take several seconds, and very large sizes (8192+) can take much longer in a browser.

| Bits | Use |
|-----:|-----|
| 512–1024 | Insecure — legacy/testing only |
| 2048 | Common minimum for real-world use |
| 3072–4096 | Recommended for long-term security |
| 8192+ | Rarely needed; slow to generate |

Most crypto engines (including this one) refuse to generate keys smaller than ~512 bits even though the field allows less.

---

## Security Notes

- Keys are generated **entirely in your browser/app** — nothing is sent anywhere.
- The private key is sensitive. This tool never saves it to history.
- Use **Export** to save either key as a `.pem` file, or **Copy** to put it on the clipboard.

---

## Tips

- Click **Refresh key-pair** to generate a brand-new pair at any time — this tool never regenerates automatically.
- Use the public key to verify signatures or encrypt data for the holder of the private key; keep the private key secret.

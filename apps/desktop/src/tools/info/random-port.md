# Random Port

Picks a random TCP port between the Min and Max you set — useful for choosing a dev-server or local-service port that's unlikely to collide with something else already running.

## Note

This only picks a number; it doesn't check whether the port is actually free on your machine. The default range (1024–65535) avoids the well-known ports below 1024, which need elevated privileges on most systems to bind.

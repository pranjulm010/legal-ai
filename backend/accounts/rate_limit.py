from django.core.cache import cache


def rate_limit_exceeded(key: str, limit: int, window_seconds: int) -> bool:
    """
    Simple cache-backed fixed-window throttle. Not distributed-safe (fine
    for the default LocMemCache in a single-process dev/small deployment) -
    swap for a Redis-backed cache in production for multi-worker accuracy.
    """
    count = cache.get(key, 0)

    if count >= limit:
        return True

    cache.set(key, count + 1, window_seconds)
    return False


def client_ip(request) -> str:
    return request.META.get("REMOTE_ADDR", "unknown")

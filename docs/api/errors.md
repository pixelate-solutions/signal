# API error envelope

Every non-2xx response uses:

```json
{
  "error": {
    "code": "CONNECTION_REQUIRED",
    "message": "Connect Google before this task can continue.",
    "retryable": false,
    "correlation_id": "corr_..."
  }
}
```

Stable codes include `INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `STALE_ACTION`, `CONNECTION_REQUIRED`, `POLICY_DENIED`, `PROVIDER_RESTRICTED`, `RATE_LIMITED`, `TEMPORARILY_UNAVAILABLE`, and `INTERNAL_ERROR`.

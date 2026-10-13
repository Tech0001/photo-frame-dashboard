# OpenRouter credits

The OpenRouter card in **Agents → Usage** shows **Account credits left** and
**Key allowance left** separately, alongside the key's daily, weekly, monthly
and lifetime spending.

- Account credits left are `total_credits - total_usage`, from OpenRouter's
  read-only [credits endpoint](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits).
  They are shared account funds, not a private balance reserved for one key.
- Key allowance left is `limit_remaining` from the
  [current-key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).
  No cap means that key has no spending cap; it does not mean unlimited credits.
- The saved server credential is reused. No credentials reach the frame and no
  model requests, purchases, or key-management actions are made.
- If the account balance cannot be read, it shows unavailable while preserving
  current key usage. A missing balance never becomes zero or an old fresh-looking
  balance. A real zero or negative balance stays distinguishable.

The documented credits endpoint requires management-key access. The household's
already-saved key successfully read it during setup; other installations may
not have that capability. No broader key is created automatically.

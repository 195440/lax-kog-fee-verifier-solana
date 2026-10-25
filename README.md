# lax-kog-fee-verifier-solana

Pure TypeScript helper for KOG fee verification over x402 on Solana. The caller supplies an already parsed transaction (SPL Token 2022 transfers). No RPC, no network, no chain SDK.

## API

```ts
verifyKogFee({ tx, quote, payee, mint, seen?, now? }) -> { ok: boolean, reason: string }
```

### `tx`

```ts
{
  signature: string;
  transfers: Array<{
    mint: string;
    to: string;
    amount: number | string | bigint; // smallest units
  }>;
}
```

### `quote`

```ts
{
  minAmount: number | string | bigint; // smallest units
  expiresAt: number; // epoch ms
}
```

`payee` and `mint` are required strings passed separately.

### `seen` and `now`

- `seen`: optional `Set<string>` of transaction signatures already accepted. When omitted, a module-level default set is used.
- `now`: optional clock override (defaults to `Date.now()`).

## Check order and reason strings

Checks run in this fixed order. The `reason` field is always one of:

1. **malformed transaction** - missing `tx`, empty `signature`, `transfers` not a non-empty array, missing `quote` / `payee` / `mint`, non-finite `quote.expiresAt`, or any amount not parseable as a non-negative integer `BigInt`.
2. **expired quote** - `now` is greater than `quote.expiresAt`.
3. **replayed signature** - `seen` already contains `tx.signature`.
4. **wrong mint** - no transfer with `mint` equal to the required mint.
5. **wrong payee** - among transfers with the required mint, none with `to` equal to `payee`.
6. **short fee** - among transfers matching mint and payee, the maximum amount is strictly less than `quote.minAmount`.
7. **ok** - all checks passed.

Amount comparisons use `BigInt` for exact smallest-unit math.

## Replay semantics

A signature is added to `seen` only after a fully successful verification. Failed attempts never consume a signature, so the same transaction can verify later if the underlying data is corrected.

## Tests

Recorded-style JSON fixtures live under `test/fixtures/`.

```bash
npm install
npm test
npm run test:coverage
npm run typecheck
```

Fixtures use fake identifiers such as `MINT_KOG_TEST` and `PAYEE_TEST`, not real on-chain addresses.

## License

MIT

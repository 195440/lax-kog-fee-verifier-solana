/**
 * KOG fee verification over x402 on Solana.
 *
 * Pure function checks on an already parsed transaction (SPL Token 2022 transfers).
 * Deterministic check order; never throws on bad input.
 */

export interface Transfer {
  mint: string;
  to: string;
  amount: number | string | bigint;
}

export interface ParsedTx {
  signature: string;
  transfers: Transfer[];
}

export interface Quote {
  minAmount: number | string | bigint;
  expiresAt: number;
}

export type VerifyReason =
  | "ok"
  | "malformed transaction"
  | "expired quote"
  | "replayed signature"
  | "wrong mint"
  | "wrong payee"
  | "short fee";

export interface VerifyKogFeeInput {
  tx: ParsedTx;
  quote: Quote;
  payee: string;
  mint: string;
  seen?: Set<string>;
  now?: number;
}

export interface VerifyKogFeeResult {
  ok: boolean;
  reason: VerifyReason;
}

const defaultSeenSignatures = new Set<string>();

function parseNonNegativeIntegerAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value < 0n ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return null;
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.includes(".") || trimmed.startsWith("-")) {
      return null;
    }
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function isMalformed(input: VerifyKogFeeInput): boolean {
  const { tx, quote, payee, mint } = input;
  if (!tx || typeof tx !== "object") {
    return true;
  }
  if (!tx.signature || typeof tx.signature !== "string") {
    return true;
  }
  if (!Array.isArray(tx.transfers) || tx.transfers.length === 0) {
    return true;
  }
  if (!quote || typeof quote !== "object") {
    return true;
  }
  if (!Number.isFinite(quote.expiresAt)) {
    return true;
  }
  if (parseNonNegativeIntegerAmount(quote.minAmount) === null) {
    return true;
  }
  if (!payee || typeof payee !== "string") {
    return true;
  }
  if (!mint || typeof mint !== "string") {
    return true;
  }
  for (const transfer of tx.transfers) {
    if (!transfer || typeof transfer !== "object") {
      return true;
    }
    if (typeof transfer.mint !== "string" || typeof transfer.to !== "string") {
      return true;
    }
    if (parseNonNegativeIntegerAmount(transfer.amount) === null) {
      return true;
    }
  }
  return false;
}

/**
 * Verifies a parsed Solana transaction pays at least quote.minAmount of mint to payee
 * before quote.expiresAt, with replay protection on tx.signature.
 *
 * Check order: malformed, expired quote, replayed signature, wrong mint, wrong payee, short fee.
 */
export function verifyKogFee(input: VerifyKogFeeInput): VerifyKogFeeResult {
  try {
    if (isMalformed(input)) {
      return { ok: false, reason: "malformed transaction" };
    }

    const now = input.now ?? Date.now();
    const { tx, quote, payee, mint } = input;
    const seen = input.seen ?? defaultSeenSignatures;

    if (now > quote.expiresAt) {
      return { ok: false, reason: "expired quote" };
    }
    if (seen.has(tx.signature)) {
      return { ok: false, reason: "replayed signature" };
    }

    const minAmount = parseNonNegativeIntegerAmount(quote.minAmount)!;

    const withMint = tx.transfers.filter((t) => t.mint === mint);
    if (withMint.length === 0) {
      return { ok: false, reason: "wrong mint" };
    }

    const withMintAndPayee = withMint.filter((t) => t.to === payee);
    if (withMintAndPayee.length === 0) {
      return { ok: false, reason: "wrong payee" };
    }

    let maxPaid = 0n;
    for (const transfer of withMintAndPayee) {
      const amount = parseNonNegativeIntegerAmount(transfer.amount)!;
      if (amount > maxPaid) {
        maxPaid = amount;
      }
    }

    if (maxPaid < minAmount) {
      return { ok: false, reason: "short fee" };
    }

    seen.add(tx.signature);
    return { ok: true, reason: "ok" };
  } catch {
    return { ok: false, reason: "malformed transaction" };
  }
}

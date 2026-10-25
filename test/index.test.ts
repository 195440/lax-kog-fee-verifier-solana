import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { verifyKogFee, type ParsedTx, type Quote } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

interface FixtureCase {
  payee: string;
  mint: string;
  quote: Quote;
  now: number;
  tx: ParsedTx;
  expected: { ok: boolean; reason: string };
  preseedSignature?: string;
}

function loadFixture(name: string): FixtureCase {
  const raw = readFileSync(join(here, "fixtures", `${name}.json`), "utf8");
  return JSON.parse(raw) as FixtureCase;
}

const PAYEE = "PAYEE_TEST";
const MINT = "MINT_KOG_TEST";
const EXPIRES = 1_800_000_000_000;
const NOW_VALID = EXPIRES - 1_000;

function baseQuote(minAmount: number | string | bigint = "1000"): Quote {
  return { minAmount, expiresAt: EXPIRES };
}

function baseTx(
  signature: string,
  overrides: Partial<ParsedTx["transfers"][0]> & { amount?: number | string | bigint } = {},
): ParsedTx {
  return {
    signature,
    transfers: [
      {
        mint: MINT,
        to: PAYEE,
        amount: "2000",
        ...overrides,
      },
    ],
  };
}

describe("recorded transaction fixtures", () => {
  for (const name of [
    "right-fee",
    "short-fee",
    "wrong-mint",
    "wrong-payee",
    "expired-quote",
    "replay",
  ]) {
    it(name.replace(/-/g, " "), () => {
      const fx = loadFixture(name);
      const seen = new Set<string>();
      if (fx.preseedSignature) {
        seen.add(fx.preseedSignature);
      }
      const result = verifyKogFee({
        tx: fx.tx,
        quote: fx.quote,
        payee: fx.payee,
        mint: fx.mint,
        now: fx.now,
        seen,
      });
      expect(result).toEqual(fx.expected);
    });
  }
});

describe("fee amount rules", () => {
  it("accepts exact minAmount", () => {
    const seen = new Set<string>();
    const result = verifyKogFee({
      tx: baseTx("SIG_EXACT_MIN", { amount: "1000" }),
      quote: baseQuote("1000"),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
      seen,
    });
    expect(result).toEqual({ ok: true, reason: "ok" });
  });

  it("accepts amount above minAmount", () => {
    const seen = new Set<string>();
    const result = verifyKogFee({
      tx: baseTx("SIG_ABOVE_MIN", { amount: 5000 }),
      quote: baseQuote(1000),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
      seen,
    });
    expect(result).toEqual({ ok: true, reason: "ok" });
  });

  it("uses the maximum matching transfer when several pay the payee", () => {
    const seen = new Set<string>();
    const result = verifyKogFee({
      tx: {
        signature: "SIG_MULTI_TRANSFER",
        transfers: [
          { mint: MINT, to: PAYEE, amount: "500" },
          { mint: MINT, to: PAYEE, amount: "1200" },
          { mint: MINT, to: "PAYEE_OTHER_TEST", amount: "99999" },
        ],
      },
      quote: baseQuote("1000"),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
      seen,
    });
    expect(result).toEqual({ ok: true, reason: "ok" });
  });

  it("compares large smallest-unit amounts with BigInt", () => {
    const seen = new Set<string>();
    const large = "18446744073709551615";
    const result = verifyKogFee({
      tx: baseTx("SIG_BIGINT_LARGE", { amount: large }),
      quote: baseQuote(large),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
      seen,
    });
    expect(result).toEqual({ ok: true, reason: "ok" });
  });

  it("accepts bigint and number amount forms", () => {
    const seen = new Set<string>();
    expect(
      verifyKogFee({
        tx: baseTx("SIG_BIGINT_AMT", { amount: 2000n }),
        quote: baseQuote("1000"),
        payee: PAYEE,
        mint: MINT,
        now: NOW_VALID,
        seen,
      }),
    ).toEqual({ ok: true, reason: "ok" });

    const seen2 = new Set<string>();
    expect(
      verifyKogFee({
        tx: baseTx("SIG_NUMBER_AMT", { amount: 2000 }),
        quote: baseQuote(1000),
        payee: PAYEE,
        mint: MINT,
        now: NOW_VALID,
        seen: seen2,
      }),
    ).toEqual({ ok: true, reason: "ok" });
  });
});

describe("replay semantics", () => {
  it("does not record signature on failed verification", () => {
    const seen = new Set<string>();
    const tx = baseTx("SIG_FAIL_THEN_OK", { amount: "100" });
    const input = {
      tx,
      quote: baseQuote("1000"),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
      seen,
    };
    expect(verifyKogFee(input)).toEqual({ ok: false, reason: "short fee" });
    expect(seen.has("SIG_FAIL_THEN_OK")).toBe(false);

    tx.transfers[0]!.amount = "2000";
    expect(verifyKogFee(input)).toEqual({ ok: true, reason: "ok" });
    expect(seen.has("SIG_FAIL_THEN_OK")).toBe(true);

    expect(verifyKogFee(input)).toEqual({ ok: false, reason: "replayed signature" });
  });

  it("uses injected seen set", () => {
    const seen = new Set<string>();
    const args = {
      tx: baseTx("SIG_INJECTED_SEEN"),
      quote: baseQuote(),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
      seen,
    };
    expect(verifyKogFee(args)).toEqual({ ok: true, reason: "ok" });
    expect(verifyKogFee(args)).toEqual({ ok: false, reason: "replayed signature" });
  });

  it("uses module default seen when omitted", async () => {
    vi.resetModules();
    const { verifyKogFee: verifyFresh } = await import("../src/index.js");
    const args = {
      tx: baseTx("SIG_DEFAULT_SEEN_MODULE"),
      quote: baseQuote(),
      payee: PAYEE,
      mint: MINT,
      now: NOW_VALID,
    };
    expect(verifyFresh(args)).toEqual({ ok: true, reason: "ok" });
    expect(verifyFresh(args)).toEqual({ ok: false, reason: "replayed signature" });
  });
});

describe("malformed transaction", () => {
  const valid = {
    tx: baseTx("SIG_MALFORM_BASE"),
    quote: baseQuote(),
    payee: PAYEE,
    mint: MINT,
    now: NOW_VALID,
    seen: new Set<string>(),
  };

  it("rejects missing or empty signature", () => {
    expect(
      verifyKogFee({ ...valid, tx: { signature: "", transfers: valid.tx.transfers } }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("rejects empty transfers", () => {
    expect(
      verifyKogFee({ ...valid, tx: { signature: "SIG_EMPTY_XFERS", transfers: [] } }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("rejects missing payee or mint", () => {
    expect(verifyKogFee({ ...valid, payee: "" })).toEqual({
      ok: false,
      reason: "malformed transaction",
    });
    expect(verifyKogFee({ ...valid, mint: "" })).toEqual({
      ok: false,
      reason: "malformed transaction",
    });
  });

  it("rejects bad quote or amounts", () => {
    expect(verifyKogFee({ ...valid, quote: { minAmount: "-1", expiresAt: EXPIRES } })).toEqual({
      ok: false,
      reason: "malformed transaction",
    });
    expect(verifyKogFee({ ...valid, quote: { minAmount: "1.5", expiresAt: EXPIRES } })).toEqual({
      ok: false,
      reason: "malformed transaction",
    });
    expect(verifyKogFee({ ...valid, quote: { minAmount: "1000", expiresAt: NaN } })).toEqual({
      ok: false,
      reason: "malformed transaction",
    });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_BAD_AMT",
          transfers: [{ mint: MINT, to: PAYEE, amount: -1 }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_FLOAT_AMT",
          transfers: [{ mint: MINT, to: PAYEE, amount: 1.5 }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("rejects invalid string amounts and non-numeric types", () => {
    expect(
      verifyKogFee({
        ...valid,
        quote: { minAmount: "not-a-number", expiresAt: EXPIRES },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_OBJ_AMT",
          transfers: [{ mint: MINT, to: PAYEE, amount: {} as unknown as number }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_NEG_BIGINT",
          transfers: [{ mint: MINT, to: PAYEE, amount: -1n }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_BLANK_AMT",
          transfers: [{ mint: MINT, to: PAYEE, amount: "   " }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("rejects null quote and non-string signature", () => {
    expect(
      verifyKogFee({
        ...valid,
        quote: null as unknown as Quote,
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: { signature: 123 as unknown as string, transfers: valid.tx.transfers },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_BAD_TO",
          transfers: [{ mint: MINT, to: 1 as unknown as string, amount: "1" }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("rejects null tx and invalid transfer rows", () => {
    expect(
      verifyKogFee({
        ...valid,
        tx: null as unknown as ParsedTx,
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_BAD_ROW",
          transfers: [null as unknown as ParsedTx["transfers"][0]],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
    expect(
      verifyKogFee({
        ...valid,
        tx: {
          signature: "SIG_BAD_MINT_TYPE",
          transfers: [{ mint: 1 as unknown as string, to: PAYEE, amount: "1" }],
        },
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("returns malformed when seen.add throws", () => {
    const throwingSeen = {
      has: () => false,
      add: () => {
        throw new Error("seen failure");
      },
    } as unknown as Set<string>;
    expect(
      verifyKogFee({
        tx: baseTx("SIG_THROW_ON_ADD"),
        quote: baseQuote(),
        payee: PAYEE,
        mint: MINT,
        now: NOW_VALID,
        seen: throwingSeen,
      }),
    ).toEqual({ ok: false, reason: "malformed transaction" });
  });

  it("accepts quote expiry exactly at now", () => {
    const seen = new Set<string>();
    expect(
      verifyKogFee({
        tx: baseTx("SIG_AT_EXPIRY"),
        quote: baseQuote(),
        payee: PAYEE,
        mint: MINT,
        now: EXPIRES,
        seen,
      }),
    ).toEqual({ ok: true, reason: "ok" });
  });

  it("defaults now to Date.now when omitted", () => {
    const seen = new Set<string>();
    const futureExpiry = Date.now() + 60_000;
    expect(
      verifyKogFee({
        tx: baseTx("SIG_DEFAULT_NOW"),
        quote: { minAmount: "1000", expiresAt: futureExpiry },
        payee: PAYEE,
        mint: MINT,
        seen,
      }),
    ).toEqual({ ok: true, reason: "ok" });
  });
});

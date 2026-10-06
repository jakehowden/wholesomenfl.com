import { describe, expect, it } from "vitest";
import { decryptBriefing, deriveKey } from "./crypto";
import tsFixture from "../../../pipeline/tests/fixtures/briefing_ts.json";
import pyFixture from "../../../pipeline/tests/fixtures/briefing_py.json";

const PASS = "correct horse";
const BRIEF = {
  week: 5,
  generated_at: "2026-10-06T14:00:00+00:00",
  situation: "3-1, chasing the 2 seed",
  moves: [{ kind: "hold", title: "Hold", detail: "Stay put", player_ids: ["4046"] }],
  reasoning: "Because.",
};

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** Encrypts the way pipeline/crypto.py does, using Node's Web Crypto. */
async function encryptBriefing(obj: unknown, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj))),
  );
  return JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

describe("decryptBriefing", () => {
  it("round-trips a Web Crypto envelope", async () => {
    const blob = await encryptBriefing(BRIEF, PASS);
    expect(blob).not.toContain("chasing");
    expect(await decryptBriefing(blob, PASS)).toEqual(BRIEF);
  });

  it("rejects a wrong passphrase", async () => {
    const blob = await encryptBriefing(BRIEF, PASS);
    await expect(decryptBriefing(blob, "battery staple")).rejects.toThrow();
  });

  it("decrypts the TS-format fixture that pytest also checks", async () => {
    expect(await decryptBriefing(JSON.stringify(tsFixture), PASS)).toEqual(BRIEF);
  });

  it("decrypts a fixture written by pipeline/crypto.py", async () => {
    expect(await decryptBriefing(JSON.stringify(pyFixture), PASS)).toEqual(BRIEF);
  });
});

import {
  decodeInstructionArgs,
  decodeInstructionArgsAsJson,
} from "../src/lib/helper/dex_aggregator_decode.ts";

// Test 1: short padded b64 ({"": ""})
const b64 = "e30=";
const bytes1 = decodeInstructionArgs(b64, "test");
console.log("e30= -> bytes:", bytes1.length, Array.from(bytes1));
console.log("expected [123, 125] ({}):", bytes1.length === 2 && bytes1[0] === 123 && bytes1[1] === 125);

// Test 2: padded b64 with known value
const b64b = "eyJyZWNlaXZlcl9pZCI6ImRleC5pbnRlYXIubmVhciIsImFtb3VudCI6IjEwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCJ9";
const bytes2 = decodeInstructionArgs(b64b, "test");
console.log("longer -> bytes:", bytes2.length, "matches JSON text length:", bytes2.length === 84);
const r2 = decodeInstructionArgsAsJson(b64b, "test");
console.log("helper returns:", typeof r2, "keys:", Object.keys(r2 as object));

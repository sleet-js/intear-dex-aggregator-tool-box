// Test TextDecoder with fatal: true on the actual decoded bytes.
import { decodeInstructionArgs } from "../src/lib/helper/dex_aggregator_decode.ts";

const b64 =
  "eyJyZWNlaXZlcl9pZCI6ImRleC5pbnRlYXIubmVhciIsImFtb3VudCI6IjEwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCIsIm1zZyI6IntcIm9wZXJhdGlvbnNcIjpbe1wiU3dhcFNpbXBsZVwiOntcImRleF9pZFwiOlwic2xpbWVkcmFnb24ubmVhci94eWtcIixcIm1lc3NhZ2VcIjpcIkt3QUFBQT09XCIsXCJhc3NldF9pblwiOlwibmVwMTQxOnNoaXQtMTE3MC5tZW1lLWNvb2tpbmcubmVhclwiLFwiYXNzZXRfb3V0XCI6XCJuZWFyXCIsXCJhbW91bnRcIjp7XCJBbW91bnRcIjp7XCJFeGFjdEluXCI6XCIxMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBcIn19LFwiY29uc3RyYWludFwiOlwiMzA1Nzg3OTQ5MTc4NzA0NzYxMDQzMjA5XCJ9fSx7XCJXaXRoZHJhd1wiOntcImFzc2V0X2lkXCI6XCJuZWFyXCIsXCJhbW91bnRcIjp7XCJGdWxsXCI6e1wiYXRfbGVhc3RcIjpcIjMwNTc4Nzk0OTE3ODcwNDc2MTA0MzIwOVwifX0sXCJ0b1wiOm51bGwsXCJyZXNjdWVfYWRkcmVzc1wiOm51bGx9fV0sXCJyZWZlcnJlclwiOlwicmVmLmh1Z2dpZXMubmVhclwifSJ9";

const bytes = decodeInstructionArgs(b64, "test");
console.log("bytes:", bytes.length);

// Test fatal:true TextDecoder
try {
  const t = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  console.log("OK fatal:true length:", t.length, "first:", JSON.stringify(t.slice(0, 60)));
  const parsed = JSON.parse(t);
  console.log("parsed keys:", Object.keys(parsed));
} catch (e) {
  console.log("FAIL:", (e as Error).message);
}

// Test the helper's actual behavior
import { decodeInstructionArgsAsJson } from "../src/lib/helper/dex_aggregator_decode.ts";
const r = decodeInstructionArgsAsJson(b64, "test");
console.log("helper return type:", r instanceof Uint8Array ? "Uint8Array" : "object");
console.log("helper length:", r instanceof Uint8Array ? r.length : "n/a");

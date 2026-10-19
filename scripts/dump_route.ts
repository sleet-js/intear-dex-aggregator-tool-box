// Dump the actual 4-leg route the router returns for ai_god.near + shit-1170
import {
  DexAggregatorClient,
  amountIn,
  withReferrerId,
  withTraderAccountId,
} from "../src/index.ts";

const client = new DexAggregatorClient();
const params = withTraderAccountId(
  withReferrerId(
    amountIn("wrap.near", "shit-1170.meme-cooking.near", "100000000000000000000000"),
    "ref.huggies.near",
  ),
  "ai_god.near",
);

const routes = await client.getRoutes(params);
console.log("got", routes.length, "routes");

for (const r of routes) {
  console.log("\n=== route", r.dex_id, "===");
  console.log("  estimated:", r.estimated_amount);
  console.log("  worst:", r.worst_case_amount);
  console.log("  instructions:", r.execution_instructions.length);
  for (let i = 0; i < r.execution_instructions.length; i++) {
    const tx = r.execution_instructions[i]!.NearTransaction;
    console.log(
      `  [${i}] receiver=${tx.receiver_id}`,
      `actions=${tx.actions.length}`,
      `fee_tx=${tx.is_fee_transaction ?? tx.continue_if_failed}`,
    );
    for (let j = 0; j < tx.actions.length; j++) {
      const fc = tx.actions[j]!.FunctionCall;
      console.log(`     action ${j}: ${fc.method_name}  gas=${fc.gas}  deposit=${fc.deposit}`);
    }
  }
}

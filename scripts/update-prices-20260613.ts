import { updatePricesFor20260613 } from '../src/firebase';

async function main() {
  const result = await updatePricesFor20260613();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

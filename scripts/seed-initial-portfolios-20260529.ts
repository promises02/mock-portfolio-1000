import {
  INITIAL_PORTFOLIO_SEED_LOGICAL_NAME,
  seedInitialPortfolios20260529,
} from '../src/firebase';

async function main() {
  const result = await seedInitialPortfolios20260529();
  console.log(JSON.stringify({ logicalName: INITIAL_PORTFOLIO_SEED_LOGICAL_NAME, ...result }, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

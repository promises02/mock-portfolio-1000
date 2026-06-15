import { apply529ReferencePricesToPortfolios } from '../src/firebase';

async function main() {
  const result = await apply529ReferencePricesToPortfolios(['AI', '이현지']);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

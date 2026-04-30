import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({
  chain: base,
  transport: http()
});

async function main() {
  const hash = '0x0c384d5314db55649f8322d01c59065c1258cdbf1b263bb750fa36eab2521cde';
  try {
    const tx = await client.getTransactionReceipt({ hash });
    const block = await client.getBlock({ blockNumber: tx.blockNumber });
    console.log("Tx Hash:", hash);
    console.log("Block Number:", tx.blockNumber);
    const date = new Date(Number(block.timestamp) * 1000);
    console.log("On-chain UTC Time:", date.toUTCString());
    console.log("On-chain Local Time:", date.toLocaleString());
  } catch (e) {
    console.error(e);
  }
}
main();

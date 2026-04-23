import { config } from 'dotenv';
config();
async function main() {
  const accountInfo = await fetch("https://tweetcattips-dev.ribencong.workers.dev/ads/executor/version", { method: 'GET'});
  console.log(await accountInfo.text());
}
main();

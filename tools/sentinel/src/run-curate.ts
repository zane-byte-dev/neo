import { runCurator } from './lib/tools/curator.js';

async function main() {
    const output = await runCurator();
    console.log(output);
}

main().catch(err => {
    console.error('❌ Fatal Error:', err);
    process.exit(1);
});

import { runMaintenance } from './lib/tools/butler.js';

async function main() {
    const output = await runMaintenance();
    console.log(output);
}

main().catch(err => {
    console.error('❌ Fatal Error:', err);
    process.exit(1);
});

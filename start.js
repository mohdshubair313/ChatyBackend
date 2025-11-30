import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting Server and Worker...');

const serverProcess = fork(path.join(__dirname, 'index.js'));
const workerProcess = fork(path.join(__dirname, 'worker.js'));

serverProcess.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    workerProcess.kill();
    process.exit(code);
});

workerProcess.on('exit', (code) => {
    console.log(`Worker process exited with code ${code}`);
    serverProcess.kill();
    process.exit(code);
});

// Handle termination signals
process.on('SIGINT', () => {
    serverProcess.kill();
    workerProcess.kill();
    process.exit();
});

process.on('SIGTERM', () => {
    serverProcess.kill();
    workerProcess.kill();
    process.exit();
});

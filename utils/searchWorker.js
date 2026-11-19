const { parentPort, workerData } = require('worker_threads');
const yts = require('yt-search');

async function run() {
    try {
        const { query, options } = workerData;
        const result = await yts(query || options);
        // Loại bỏ các hàm/methods (như toString) để tránh lỗi structured clone khi gửi qua parentPort
        const cleanResult = JSON.parse(JSON.stringify(result));
        parentPort.postMessage({ success: true, result: cleanResult });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
}

run();

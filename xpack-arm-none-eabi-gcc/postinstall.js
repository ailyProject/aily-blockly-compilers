const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');

// 确保 __dirname 有值，如果没有则使用当前工作目录
const srcDir = __dirname || "";
// 确保目标目录有值，空字符串会导致解压到当前目录
const destDir = process.env.AILY_COMPILERS_PATH || "";
const _7zaPath = process.env.AILY_7ZA_PATH || "";
const zipDownloadBaseUrl = process.env.AILY_ZIP_URL + '/compilers';


// 重试函数封装
async function withRetry(fn, maxRetries = 3, retryDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.log(`操作失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`);

            if (attempt < maxRetries) {
                console.log(`等待 ${retryDelay / 1000} 秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    throw new Error(`经过 ${maxRetries} 次尝试后操作仍然失败: ${lastError.message}`);
}


function getZipFileName() {
    // 读取package.json文件，获取name和version
    const prefix = "@aily-project/compiler-";
    const packageJson = require('./package.json');
    const packageName = packageJson.name.replace(prefix, "");
    const packageVersion = packageJson.version;
    return `${packageName}@${packageVersion}.7z`;
}


function getZipFile() {
    const zipFileName = getZipFileName();
    const downloadUrl = `${zipDownloadBaseUrl}/${zipFileName}`;

    return new Promise((resolve, reject) => {
        console.log(`正在下载: ${downloadUrl}`);
        const filePath = path.join(__dirname, zipFileName);

        if (fs.existsSync(filePath)) {
            console.log(`文件已存在: ${zipFileName}`);
            resolve(zipFileName);
            return;
        }

        const fileStream = fs.createWriteStream(filePath);

        https.get(downloadUrl, (response) => {
            if (response.statusCode !== 200) {
                fileStream.close();
                fs.unlink(filePath, () => { });
                reject(new Error(`下载失败: 状态码 ${response.statusCode}`));
                return;
            }

            // 获取文件总大小
            const totalSize = parseInt(response.headers['content-length'] || 0, 10);
            let downloadedSize = 0;
            let lastPercentage = -1;

            // 设置下载进度显示
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;

                // 计算下载百分比
                if (totalSize > 0) {
                    const percentage = Math.floor((downloadedSize / totalSize) * 100);

                    // 每增加1%才更新进度，避免过多输出
                    if (percentage > lastPercentage) {
                        lastPercentage = percentage;
                        const downloadSizeMB = (downloadedSize / (1024 * 1024)).toFixed(2);
                        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
                        process.stdout.write(`\r下载进度: ${percentage}% (${downloadSizeMB}MB / ${totalSizeMB}MB)`);
                    }
                }
            });

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                // 输出换行，确保后续日志正常显示
                if (totalSize > 0) {
                    console.log('');
                }
                console.log(`成功下载 ${zipFileName}`);
                resolve(zipFileName);
            });

            fileStream.on('error', (err) => {
                fs.unlink(filePath, () => { });
                reject(err);
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => { });
            reject(err);
        });
    });
}


// 使用传统的回调式 API 并用 Promise 包装
function readdir(dir) {
    return new Promise((resolve, reject) => {
        fs.readdir(dir, (err, files) => {
            if (err) reject(err);
            else resolve(files);
        });
    });
}

// 使用 Promise 和 async/await 简化异步操作
async function extractArchives() {
    try {
        // 确保源目录存在
        if (!fs.existsSync(srcDir)) {
            console.error(`源目录不存在: ${srcDir}`);
            return;
        }

        // 确保目标目录存在
        if (!destDir) {
            console.error('未设置目标目录');
            return;
        }

        // 确保 7za.exe 存在
        if (!fs.existsSync(_7zaPath)) {
            console.error(`7za.exe 不存在: ${_7zaPath}`);
            return;
        }

        if (!fs.existsSync(destDir)) {
            console.log(`目标目录不存在，创建: ${destDir}`);
            fs.mkdirSync(destDir, { recursive: true });
        }

        // 确保 ZIP URL 已设置
        if (!process.env.AILY_ZIP_URL) {
            throw new Error('未设置下载基础 URL (AILY_ZIP_URL 环境变量未设置)');
        }

        if (!fs.existsSync(destDir)) {
            console.log(`目标目录不存在，创建: ${destDir}`);
            try {
                fs.mkdirSync(destDir, { recursive: true });
            } catch (mkdirErr) {
                throw new Error(`无法创建目标目录: ${destDir}, 错误: ${mkdirErr.message}`);
            }
        }

        // 下载zip文件
        let fileName;
        try {
            fileName = await withRetry(getZipFile, 3, 2000);
            console.log(`已下载文件: ${fileName}`);
        } catch (downloadErr) {
            throw new Error(`无法下载zip文件: ${downloadErr.message}`);
        }

        // 检查下载的文件是否存在和大小是否正常
        const zipFilePath = path.join(__dirname, fileName);
        try {
            const stats = fs.statSync(zipFilePath);
            if (stats.size < 1048576) { // 1MB = 1024 * 1024 bytes
                throw new Error(`下载的文件异常小 (${stats.size} 字节)，可能下载不完整或被截断`);
            }
            console.log(`文件大小: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);
        } catch (statErr) {
            if (statErr.code === 'ENOENT') {
                throw new Error(`下载的文件不存在: ${zipFilePath}`);
            } else {
                throw new Error(`检查文件失败: ${statErr.message}`);
            }
        }

        // 解压zip文件
        try {
            await withRetry(async () => {
                await unpack(zipFilePath, destDir);
            }, 3, 2000); // 最多重试3次，每次间隔2秒
            console.log(`已解压 ${fileName} 到 ${destDir}`);

            // 解压成功后可以删除压缩文件
            // fs.unlinkSync(zipFilePath);
            // console.log(`已删除临时文件: ${fileName}`);
        } catch (unpackErr) {
            throw new Error(`解压失败: ${unpackErr.message}`);
        }
    } catch (err) {
        console.error('无法读取目录:', err);
        process.exit(1);
    }
}

// 使用 Promise 封装解压函数
function unpack(archivePath, destination) {
    return new Promise((resolve, reject) => {
        if (!archivePath) {
            return reject(new Error('压缩文件路径不能为空'));
        }
        if (!destination) {
            return reject(new Error('目标目录不能为空'));
        }

        const args = ['x', archivePath, '-y', '-o' + destination];
        console.log(`执行命令: ${_7zaPath} ${args.join(' ')}`);

        const proc = spawn(_7zaPath, args, { windowsHide: true });

        let output = '';

        proc.stdout.on('data', function (chunk) {
            output += chunk.toString();
        });
        proc.stderr.on('data', function (chunk) {
            output += chunk.toString();
        });

        proc.on('error', function (err) {
            console.error('7-zip 错误:', err);
            reject(err);
        });

        proc.on('exit', function (code) {
            if (code === 0) {
                resolve();
            } else {
                const error = new Error(`7-zip 退出码 ${code}\n${output}`);
                reject(error);
            }
        });
    });
}

// 执行主函数
extractArchives().catch(function (err) {
    console.error('执行失败:', err);
});
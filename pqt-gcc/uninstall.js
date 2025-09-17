/**
 * uninstall.js
 * 
 * 卸载脚本 - 负责清理编译器下载和解压后的文件
 * 会移除本地下载的压缩包和目标目录中的编译器文件
 */

const fs = require('fs');
const path = require('path');

// 基本配置
const srcDir = __dirname;
const destDir = process.env.AILY_COMPILERS_PATH || "";
const prefix = "@aily-project/compiler-";
const packageJson = require('./package.json');
const packageName = packageJson.name.replace(prefix, "");
const packageVersion = packageJson.version;
const zipFileName = `${packageName}@${packageVersion}.7z`;
const zipFilePath = path.join(srcDir, zipFileName);
// 编译器目录名应该与.7z文件名一致（不包含扩展名）
const compilerDirName = `${packageName}@${packageVersion}`;
const compilerPath = destDir ? path.join(destDir, compilerDirName) : "";

/**
 * 删除文件函数
 * @param {string} filePath - 要删除的文件路径
 * @returns {Promise} - 删除操作的Promise
 */
function removeFile(filePath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(filePath)) {
            console.log(`文件不存在，无需删除: ${filePath}`);
            resolve();
            return;
        }

        try {
            fs.unlinkSync(filePath);
            console.log(`已成功删除文件: ${filePath}`);
            resolve();
        } catch (err) {
            console.warn(`删除文件失败: ${filePath}, 错误: ${err.message}`);
            resolve(); // 继续执行，不中断流程
        }
    });
}

/**
 * 递归删除目录函数
 * @param {string} dirPath - 要删除的目录路径
 * @returns {Promise} - 删除操作的Promise
 */
function removeDirectory(dirPath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(dirPath)) {
            console.log(`目录不存在，无需删除: ${dirPath}`);
            resolve();
            return;
        }

        try {
            // 检查Node.js版本支持的API
            if (fs.rmSync) {
                fs.rmSync(dirPath, { recursive: true, force: true });
            } else if (fs.rmdirSync) {
                fs.rmdirSync(dirPath, { recursive: true });
            } else {
                throw new Error('当前Node.js版本不支持递归删除目录');
            }
            console.log(`已成功删除目录: ${dirPath}`);
            resolve();
        } catch (err) {
            console.warn(`删除目录失败: ${dirPath}, 错误: ${err.message}`);
            resolve(); // 继续执行，不中断流程
        }
    });
}

/**
 * 主卸载函数 - 清理所有编译器相关文件
 */
async function uninstall() {
    console.log(`
=========================================
开始卸载编译器: ${packageName} v${packageVersion}
=========================================`);

    // 1. 删除下载的压缩包
    console.log('\n[步骤1] 清理下载的压缩文件');
    await removeFile(zipFilePath);
    
    // 2. 删除编译器目录
    if (!destDir) {
        console.log('\n[步骤2] 未设置目标目录环境变量 AILY_COMPILERS_PATH，跳过编译器目录清理');
    } else {
        console.log(`\n[步骤2] 清理编译器目录: ${compilerPath}`);
        await removeDirectory(compilerPath);
    }

    console.log(`
=========================================
卸载完成: ${packageName}
=========================================`);
}

// 如果直接运行此脚本，则执行卸载程序
if (require.main === module) {
    uninstall().catch(err => {
        console.error(`卸载过程中发生错误: ${err.message}`);
        process.exit(1);
    });
}

// 导出卸载函数，以便其他脚本调用
module.exports = { uninstall };

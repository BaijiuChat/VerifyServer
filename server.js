const grpc = require('@grpc/grpc-js')
const crypto = require('crypto');
const message_proto = require('./proto')
const const_module = require('./const')
const redis_module = require('./redis')
const emailModule = require('./email')

// 服务状态
let serverStatus = {
    isRunning: false,
    server: null,
    healthCheckInterval: null
};

/**
 * 生成6位数字验证码
 * @returns {string} 6位数字验证码
 */
function generateSixDigitCode() {
    return crypto.randomInt(0, 999999).toString().padStart(6, '0');
}

/**
 * 执行健康检查
 */
async function performHealthCheck() {
    try {
        const redisHealth = await redis_module.HealthCheck();
        console.log(`健康检查: Redis ${redisHealth ? '正常' : '异常'}`);
        
        if (!redisHealth && serverStatus.isRunning) {
            console.log("Redis服务异常，但系统仍在运行...");
            // 可以在这里添加重启Redis连接的逻辑或发送警报
        }
    } catch (error) {
        console.log("执行健康检查时出错:", error);
    }
}

/**
 * 优雅关闭服务
 */
async function gracefulShutdown() {
    console.log("开始优雅关闭服务...");
    
    // 避免重复关闭
    if (!serverStatus.isRunning) {
        console.log("服务已经处于关闭状态");
        process.exit(0);
        return;
    }
    
    // 标记服务状态
    serverStatus.isRunning = false;
    
    // 清除健康检查定时器
    if (serverStatus.healthCheckInterval) {
        clearInterval(serverStatus.healthCheckInterval);
        serverStatus.healthCheckInterval = null;
    }
    
    // 优雅关闭gRPC服务器
    if (serverStatus.server) {
        console.log("正在关闭gRPC服务器...");
        try {
            await new Promise((resolve, reject) => {
                serverStatus.server.tryShutdown((error) => {
                    if (error) {
                        console.log("gRPC服务器关闭错误:", error);
                        reject(error);
                    } else {
                        console.log("gRPC服务器已正常关闭");
                        resolve();
                    }
                });
                
                // 设置超时，避免长时间等待
                setTimeout(() => {
                    console.log("gRPC服务器关闭超时，强制关闭");
                    serverStatus.server.forceShutdown();
                    resolve();
                }, 5000);
            });
        } catch (error) {
            console.log("关闭gRPC服务器过程中出错:", error);
        }
    }
    
    // 关闭Redis连接
    console.log("正在关闭Redis连接...");
    try {
        await redis_module.Quit();
    } catch (error) {
        console.log("关闭Redis连接时出错:", error);
    }
    
    console.log("所有服务已关闭，退出进程");
    process.exit(0);
}

/**
 * 处理验证码请求
 * @param {*} call gRPC调用对象
 * @param {*} callback 回调函数
 */
async function GetVerifyCode(call, callback) {
    console.log("GetVerifyCode被调用，邮箱为:", call.request.email);
    
    // 验证邮箱格式
    if (!call.request.email || !validateEmail(call.request.email)) {
        console.log("邮箱格式无效:", call.request.email);
        callback(null, { 
            email: call.request.email,
            error: const_module.Errors.Exception
        });
        return;
    }
    
    try {
        // 先检查Redis连接状态
        if (!redis_module.isRedisConnected()) {
            console.log("Redis未连接，无法处理验证码请求");
            callback(null, { 
                email: call.request.email,
                error: const_module.Errors.RedisErr
            });
            return;
        }
        
        // 检查该邮箱是否已有未过期的验证码
        let query_res = await redis_module.QueryRedis(const_module.code_prefix + call.request.email);
        console.log("查询结果:", query_res);
        
        // 如果已存在验证码且未过期，可以选择不再发送新验证码
        // 这里我们仍然生成新验证码，但实际应用中可能需要限制发送频率
        
        // 生成验证码
        const uniqueId = generateSixDigitCode();
        const redisKey = const_module.code_prefix + call.request.email;
        
        // 设置验证码，有效期5分钟(300秒)
        const bres = await redis_module.SetRedisExpire(redisKey, uniqueId, 300);
        if (!bres) {
            console.log("设置Redis失败");
            callback(null, { 
                email: call.request.email,
                error: const_module.Errors.RedisErr
            });
            return;
        }
        
        console.log("验证码是:", uniqueId);
        
        // 构造邮件内容
        let text_str = `您的验证码如下:\n<b><font size="6">${uniqueId}</font></b>\n使用该验证码验证您的邮箱并完成你的注册。\n验证码有效期为5分钟。\n如果您并没有请求验证码，请无视该邮件。\n\n白久无瑕团队敬上`;
        
        // 发送邮件
        let mailOptions = {
            from: 'baijiuwuhu@163.com',
            to: call.request.email,
            subject: '白久Chat验证码',
            text: text_str,
        };
        
        // 调用email.js中的SendMail函数发送邮件
        let send_res = await emailModule.SendMail(mailOptions);
        console.log("邮件发送结果:", send_res);
        
        // 返回成功响应
        callback(null, { 
            email: call.request.email,
            error: const_module.Errors.Success
        });
    } catch (error) {
        console.log("GetVerifyCode处理过程中出错:", error);
        callback(null, { 
            email: call.request.email,
            error: const_module.Errors.Exception
        });
    }
}

/**
 * 验证邮箱格式
 * @param {string} email 
 * @returns {boolean}
 */
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * 主函数
 */
async function main() {
    try {
        // 创建gRPC服务器
        const server = new grpc.Server();
        server.addService(message_proto.VerifyService.service, { GetVerifyCode: GetVerifyCode });
        
        // 绑定地址和端口
        await new Promise((resolve, reject) => {
            server.bindAsync('127.0.0.1:50051', grpc.ServerCredentials.createInsecure(), (err, port) => {
                if (err) {
                    console.error("服务器绑定失败:", err);
                    reject(err);
                    return;
                }
                console.log('gRPC服务器运行在端口', port);
                resolve(port);
            });
        });
        
        // 更新服务状态
        serverStatus.server = server;
        serverStatus.isRunning = true;
        
        // 设置健康检查
        serverStatus.healthCheckInterval = setInterval(performHealthCheck, 30000);
        
        console.log("服务器启动完成");
        
        // 执行初始健康检查
        await performHealthCheck();
    } catch (error) {
        console.error("服务器启动失败:", error);
        process.exit(1);
    }
}

// 设置信号处理程序
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (error) => {
    console.error("未捕获的异常:", error);
    gracefulShutdown();
});

// 启动服务器
main().catch(error => {
    console.error("main函数执行失败:", error);
    process.exit(1);
});
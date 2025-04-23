const config_module = require("./config")
const Redis = require("ioredis")

// 创建Redis客户端实例
const RedisCli = new Redis({
    host: config_module.redis_host,       // Redis服务器主机名
    port: config_module.redis_port,        // Redis服务器端口号
    password: config_module.redis_passwd, // Redis密码
    reconnectOnError: function(err) {
        console.log("Redis重连触发条件检查:", err);
        // 如果返回true/1/2，ioredis将重新连接
        return true;
    },
    retryStrategy: function(times) {
        console.log(`Redis尝试重连 (${times})`);
        // 返回重试等待时间（毫秒）
        return Math.min(times * 100, 3000);
    },
    maxRetriesPerRequest: 3
});

// 连接状态管理
let isConnected = false;

/**
 * 监听连接成功事件
 */
RedisCli.on("connect", () => {
    console.log("Redis连接成功");
    isConnected = true;
});

/**
 * 监听错误信息
 */
RedisCli.on("error", function (err) {
    console.log("Redis连接错误:", err);
    isConnected = false;
    // 不立即退出，让重连机制工作
});

/**
 * 监听重连事件
 */
RedisCli.on("reconnecting", function() {
    console.log("正在尝试重新连接Redis...");
});

/**
 * 监听连接关闭事件
 */
RedisCli.on("end", () => {
    console.log("Redis连接已关闭");
    isConnected = false;
});

/**
 * 封装安全的Redis操作
 * @param {Function} operation Redis操作函数
 * @returns {Promise} 操作结果
 */
async function safeRedisOperation(operation) {
    if (!isConnected) {
        console.log("Redis未连接，等待连接恢复...");
        return null;
    }
    try {
        return await operation();
    } catch (error) {
        console.log("Redis操作错误:", error);
        return null;
    }
}

/**
 * 根据key获取value
 * @param {*} key 
 * @returns 
 */
async function GetRedis(key) {
    return safeRedisOperation(async () => {
        const result = await RedisCli.get(key);
        if(result === null){
            console.log('result:','<'+result+'>', 'This key cannot be found...');
            return null;
        }
        console.log('Result:','<'+result+'>','Get key success!...');
        return result;
    });
}

/**
 * 根据key查询redis中是否存在key
 * @param {*} key 
 * @returns 
 */
async function QueryRedis(key) {
    return safeRedisOperation(async () => {
        const result = await RedisCli.exists(key);
        //  判断该值是否为空 如果为空返回null
        if (result === 0) {
            console.log('result:<','<'+result+'>','This key is null...');
            return null;
        }
        console.log('Result:','<'+result+'>','With this value!...');
        return result;
    });
}

/**
 * 设置key和value，并过期时间
 * @param {*} key 
 * @param {*} value 
 * @param {*} exptime 
 * @returns 
 */
async function SetRedisExpire(key, value, exptime){
    return safeRedisOperation(async () => {
        // 设置键和值
        await RedisCli.set(key, value);
        // 设置过期时间（以秒为单位）
        await RedisCli.expire(key, exptime);
        return true;
    });
}

/**
 * 执行健康检查
 * @returns {Promise<boolean>} 健康状态
 */
async function HealthCheck() {
    try {
        if (!isConnected) {
            return false;
        }
        const pingResult = await RedisCli.ping();
        return pingResult === 'PONG';
    } catch (error) {
        console.log("Redis健康检查失败:", error);
        return false;
    }
}

/**
 * 优雅退出函数
 * @returns {Promise} 退出结果
 */
async function Quit(){
    return new Promise((resolve) => {
        if (!isConnected) {
            console.log("Redis已断开，无需关闭");
            resolve();
            return;
        }
        
        console.log("正在关闭Redis连接...");
        RedisCli.quit().then(() => {
            console.log("Redis连接已正常关闭");
            isConnected = false;
            resolve();
        }).catch(err => {
            console.log("关闭Redis连接时出错:", err);
            // 强制断开连接
            RedisCli.disconnect();
            isConnected = false;
            resolve();
        });
    });
}

module.exports = {
    GetRedis,
    QueryRedis,
    Quit,
    SetRedisExpire,
    HealthCheck,
    isRedisConnected: () => isConnected
}